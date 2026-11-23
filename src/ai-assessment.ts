import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import type { MetadataPack } from './metadata.js';
import { OpenAiCompatibleHttpError, requestOpenAiCompatibleChat, requestOpenAiCompatibleChatWithTools, type OpenAiChatMessage, type OpenAiToolDefinition, type OpenAiToolHandler } from './ai-remote.js';

// Gateway tool capability is stable per endpoint/model during an extension-host
// session. Remember a tools rejection so later authoring requests do not pay the
// same failed negotiation round-trip again. This cache contains no credentials.
const unsupportedToolProfiles = new Set<string>();
function toolProfileKey(endpoint: string, model: string): string { return `${endpoint.replace(/\/$/, '')}\u0000${model.trim()}`; }

export interface AiAssessmentOptions {
  /** Persisted per-endpoint/model capability result from the extension host. */
  skipTools?: boolean;
  onToolsRejected?: () => void | Promise<void>;
  /** Optional local transport. The transport owns authentication and must return provider text only. */
  request?: (messages: OpenAiChatMessage[], timeoutMs: number) => Promise<string>;
}

export interface AiAssessmentInput {
  ruleId: string;
  title: string;
  checkText: string;
  platform?: string;
  ruleYaml?: string;
  availableConditions?: Array<{ name: string; assessment: string; title?: string; version?: string | number }>;
  /** When present, the provider independently reviews this candidate instead of starting from nothing. */
  candidateYaml?: string;
  reviewMode?: boolean;
}

export interface AiAssessmentCoverage {
  applicability: 'implemented' | 'not-needed' | 'not-representable';
  procedureSteps: Array<{ summary: string; represented: boolean; tests?: string[] }>;
  pathPatterns: Array<{ pattern: string; represented: boolean; strategy?: string }>;
}

export interface AiAssessmentDraft {
  generatedMode: 'automated' | 'manual-only';
  automationClass?: 'fully-automated' | 'organizational-input' | 'manual';
  confidence: 'high' | 'medium' | 'low';
  yaml: string;
  document?: any;
  diagnostics: string[];
  assumptions: string[];
  unresolved: string[];
  citations: string[];
  rationale?: string;
  coverage?: AiAssessmentCoverage;
  method: 'configured-ai';
  /** Provider provenance is display-only; credentials and full endpoints are never retained. */
  provider?: string;
  model?: string;
  generatedAt?: string;
  /** Whether the model name opted into local pinned-pack tools for this request. */
  toolMode?: 'local-pinned-pack' | 'fallback-no-tools' | 'not-requested';
  toolWarning?: string;
  /** End-to-end elapsed time for this provider attempt, including bounded repair/fallback. */
  durationMs?: number;
}

function compactMapping(value: any) {
  const native = value?.native ?? {};
  return {
    capability: value?.capability,
    source: value?.source,
    native: {
      field_datatypes: native.field_datatypes,
      state_field_datatypes: native.state_field_datatypes,
      object_selector_alternatives: native.object_selector_alternatives,
      selector_map: native.selector_map,
      state_field_map: native.state_field_map,
      selector_value_enums: native.selector_value_enums,
      state_value_enums: native.state_value_enums,
      selector_source_operations: native.selector_source_operations,
      collection_parameter_source_operations: native.collection_parameter_source_operations,
      uses_file_traversal: native.uses_file_traversal
    },
    semantic_validator_rules: value?.semantic_validator_rules
  };
}

function boundedText(value: unknown, limit = 360): unknown {
  if (typeof value !== 'string') return value;
  return value.length > limit ? value.slice(0, limit) + '…' : value;
}

function schemaSummary(value: any, depth = 0): any {
  if (!value || typeof value !== 'object') return value;
  // Nested schema branches are represented by their refs/types. Expanding every
  // allOf/oneOf branch makes the prompt enormous without adding authoring value.
  if (depth > 1) return {
    $ref: value.$ref,
    type: value.type,
    enum: Array.isArray(value.enum) ? value.enum.slice(0, 40) : undefined,
    const: value.const,
    title: boundedText(value.title, 180)
  };
  const result: Record<string, any> = {};
  for (const key of ['$id', '$ref', 'title', 'description', 'type', 'required', 'enum', 'const', 'pattern', 'minItems', 'maxItems', 'additionalProperties']) {
    if (value[key] !== undefined) result[key] = key === 'description' || key === 'pattern' ? boundedText(value[key]) : Array.isArray(value[key]) ? value[key].slice(0, 40) : value[key];
  }
  for (const key of ['properties', 'patternProperties']) {
    if (value[key] && typeof value[key] === 'object') {
      result[key] = Object.fromEntries(Object.entries(value[key]).map(([name, child]) => [name, schemaSummary(child, depth + 1)]));
    }
  }
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(value[key])) result[key] = value[key].slice(0, 24).map((child: any) => schemaSummary(child, depth + 1));
  }
  return result;
}

function sourceSummary(value: any): any {
  if (!value || typeof value !== 'object') return boundedText(value, 240);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, boundedText(entry, 240)]));
}

function resource(pack: MetadataPack, suffix: string): any | undefined {
  const uri = pack.manifest.resources.find((item: any) => item.kind === 'schema' && item.uri.endsWith('/' + suffix))?.uri;
  if (!uri) return undefined;
  try { return pack.resource(uri); } catch { return undefined; }
}

function mappingEntries(pack: MetadataPack): any[] {
  return pack.manifest.resources.filter((item: any) => item.kind === 'mapping').flatMap((item: any) => {
    try { return [pack.resource(item.uri)]; } catch { return []; }
  });
}

function aiToolDefinitions(): OpenAiToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'scap_ng_search_capabilities',
        description: 'Search the pinned SCAP-NG 0.4.1 capability mappings for a procedure or platform signal. This is local pack data, not a network lookup.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: { query: { type: 'string' }, platform: { type: 'string' } }, required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'scap_ng_get_capability',
        description: 'Retrieve the pinned mapping and compact Object/State schema for one exact SCAP-NG capability.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: { capability: { type: 'string' } }, required: ['capability']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'scap_ng_validate_assessment',
        description: 'Validate a proposed native SCAP-NG 0.4.1 Assessment locally and return concise schema diagnostics. Do not claim runtime proof.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: { yaml: { type: 'string' } }, required: ['yaml']
        }
      }
    }
  ];
}

function aiToolHandler(pack: MetadataPack): OpenAiToolHandler {
  return (name, args) => {
    if (name === 'scap_ng_search_capabilities') {
      const query = String(args.query ?? '');
      const platform = String(args.platform ?? '');
      const selected = selectedMappings(pack, `${query} ${platform}`, platform);
      const entries = selected.catalog.filter(entry => Number(entry.score) > 0).slice(0, 20);
      return { schema_version: pack.pin.schemaVersion, source_commit: pack.pin.sourceCommit, results: entries.length ? entries : selected.catalog.slice(0, 20) };
    }
    if (name === 'scap_ng_get_capability') {
      const capability = String(args.capability ?? '');
      const mapping = mappingEntries(pack).find(value => value?.capability === capability);
      const pin = pack.manifest.capabilities?.[capability];
      if (!mapping || !pin?.schema_uri) return { error: `Unknown pinned capability: ${capability}` };
      const schema: any = pack.resource(pin.schema_uri);
      return {
        schema_version: pack.pin.schemaVersion,
        source_commit: pack.pin.sourceCommit,
        capability,
        mapping: compactMapping(mapping),
        schema: {
          id: schema.$id,
          object: schemaSummary(schema.$defs?.object),
          state_predicate: schemaSummary(schema.$defs?.state_predicate),
          test: schemaSummary(schema.$defs?.test)
        }
      };
    }
    if (name === 'scap_ng_validate_assessment') {
      const yaml = String(args.yaml ?? '');
      const document = parseDocument(yaml, { uniqueKeys: true });
      if (document.errors.length) return { valid: false, diagnostics: document.errors.map(error => error.message).slice(0, 18) };
      let value: any;
      try { value = document.toJS({ maxAliasCount: 50 }); }
      catch (error) { return { valid: false, diagnostics: [error instanceof Error ? error.message : String(error)] }; }
      const schemaUri = pack.manifest.resources.find((item: any) => item.kind === 'schema' && item.uri.endsWith('/assessment.schema.json'))?.uri;
      const diagnostics = schemaUri ? schemaValidationDiagnostics(pack, schemaUri, value) : ['Pinned Assessment schema is unavailable.'];
      return { valid: diagnostics.length === 0, diagnostics: diagnostics.slice(0, 18) };
    }
    return { error: `Unknown local tool: ${name}` };
  };
}

function normalizedWords(value: string): string[] {
  return value.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
}

function capabilityScore(capability: string, source: string, text: string, platform: string): number {
  const haystack = `${capability} ${source}`.toLocaleLowerCase();
  const words = new Set(normalizedWords(text));
  let score = normalizedWords(capability).reduce((total, word) => total + (words.has(word) ? 8 : 0), 0);
  const context = `${text} ${platform}`.toLocaleLowerCase();
  for (const [family, hints] of [
    ['windows', ['windows', 'registry', 'hkey', 'auditpol', 'secedit', 'powershell', 'service']],
    ['linux', ['linux', 'rhel', 'red hat', 'rpm', 'yum', 'dnf', 'dpkg', 'apt', 'package', 'installed', 'systemctl', 'selinux']],
    ['unix', ['unix', 'linux', '/etc/', 'grep', 'passwd', 'shadow', 'chmod', 'ownership']],
    ['macos', ['macos', 'os x', 'plist', 'launchctl']],
    ['independent', ['command', 'shell', 'text file', 'configuration', 'regex']]
  ] as const) {
    if (haystack.startsWith(family + '.') && hints.some(hint => context.includes(hint))) score += 10;
  }
  if (haystack.startsWith('independent.') && /command|shell|text|file|regex|output|configuration|directive|\.conf\b|\/etc\//i.test(context)) score += 4;
  // Keep the two generic independent collectors available when a procedure
  // describes a concrete configuration file or command without naming the
  // capability. This selects knowledge only; it never authors a Test.
  if (capability === 'independent.textfilecontent' && /(?:\/etc\/|\/usr\/local\/etc\/|\.conf\b)/i.test(context) && /configuration|config|directive|line|content|file|pattern|server/i.test(context)) score += 32;
  // Capability-specific vocabulary keeps native mappings in the bounded
  // prompt for dynamic population checks. This is mapping selection only; it
  // does not create content-specific Tests or fallbacks.
  for (const [mappedCapability, hints] of [
    ['unix.password', ['passwd', 'password file', 'uid', 'gid', 'login shell', 'interactive user', 'home directory']],
    ['unix.file', ['file permission', 'file mode', 'directory', 'ownership', 'owner', 'group', 'chmod', 'stat', 'home directory', 'initialization files']],
    ['unix.interface', ['network interface', 'promiscuous', 'ip link', 'interface']],
    ['linux.rpminfo', ['rpm package', 'yum', 'dnf', 'rpm -', 'rpm database']]
  ] as const) {
    if (capability === mappedCapability && hints.some(hint => context.includes(hint))) score += 24;
  }
  return score;
}

function selectedMappings(pack: MetadataPack, text: string, platform = ''): { catalog: any[]; relevant: any[] } {
  const entries = mappingEntries(pack).map(value => ({ value, score: capabilityScore(String(value?.capability ?? ''), String(value?.source ?? ''), text, platform) }));
  entries.sort((a, b) => b.score - a.score || String(a.value?.capability).localeCompare(String(b.value?.capability)));
  const relevant = entries.filter(entry => entry.score > 0).slice(0, 14).map(entry => compactMapping(entry.value));
  // The full source metadata is already retained in relevant_capability_mappings.
  // Keep the all-capability index compact so every request does not spend model
  // context and inference time repeating long source descriptors.
  const catalog = entries.map(entry => ({ capability: entry.value?.capability, score: entry.score }));
  return { catalog, relevant };
}

function readKnowledgeDocument(root: string, name: string, limit = 7000): string | undefined {
  try {
    const value = readFileSync(join(root, 'docs', name), 'utf8');
    return value.length > limit ? value.slice(0, limit) + '\n[document excerpt truncated]' : value;
  } catch { return undefined; }
}

export interface AiKnowledgeOptions {
  platform?: string;
  checkText?: string;
  maxDocumentChars?: number;
}

/**
 * Build a bounded, provenance-labelled SCAP-NG knowledge context for the model.
 * The complete pack stays local and authoritative; only compact schema summaries
 * and procedure-relevant capability mappings are sent to the provider. This
 * avoids overflowing model context with every generated schema while retaining
 * the exact pin, vocabulary, selectors, operators and authoring guidance.
 */
export function buildScapNgKnowledge(pack: MetadataPack, extensionRoot: string, options: AiKnowledgeOptions = {}): string {
  const schemaNames = ['assessment.schema.json', 'rule.schema.json', 'benchmark.schema.json', 'applicability.schema.json', 'assessment-language.schema.json', 'native-selector.schema.json', 'expression.schema.json', 'variable-expression.schema.json', 'capability-common.schema.json'];
  const schemaResources: Record<string, any> = Object.fromEntries(schemaNames.map(name => [name, resource(pack, name)]).filter(([, value]) => value));
  const schemas: Record<string, any> = {};
  for (const [name, value] of Object.entries(schemaResources)) {
    if (name === 'assessment-language.schema.json' && value?.$defs) {
      const names = ['test', 'canonical_all_items_requirement', 'canonical_field_predicate', 'canonical_inherited_condition', 'object_selector_predicate', 'field_predicate_body', 'scalar_field_predicate', 'existence_cardinality'];
      schemas[name] = { $id: value.$id, 'x-scap-ng-version': value['x-scap-ng-version'], required: value.required, properties: schemaSummary(value.properties), defs: Object.fromEntries(names.filter(name => value.$defs[name]).map(name => [name, schemaSummary(value.$defs[name])])) };
    } else if (name === 'native-selector.schema.json' && value?.$defs) {
      const { relevant } = selectedMappings(pack, `${options.checkText ?? ''} ${options.platform ?? ''}`, options.platform);
      const relevantNames = new Set(relevant.map(mapping => String(mapping.capability ?? '').replaceAll('.', '_')));
      const defs = Object.fromEntries(Object.entries(value.$defs).filter(([name]) => [...relevantNames].some(capability => name.includes(capability))).map(([name, schema]) => [name, schemaSummary(schema)]));
      schemas[name] = { $id: value.$id, 'x-scap-ng-version': value['x-scap-ng-version'], defs };
    } else if (name === 'variable-expression.schema.json' && value?.$defs) {
      schemas[name] = { $id: value.$id, 'x-scap-ng-version': value['x-scap-ng-version'], defs: Object.fromEntries(['declaration', 'expression'].filter(key => value.$defs[key]).map(key => [key, schemaSummary(value.$defs[key])])) };
    } else if (name === 'capability-common.schema.json' && value?.$defs) {
      const names = ['object_use', 'inline_object', 'object_entity_base', 'file_selection', 'file_traversal', 'foreach_binding', 'foreach_selector_binding', 'set_expression', 'set_operand', 'set_object_operand', 'set_nested_operand', 'variable_reference', 'input_reference', 'state_filter', 'record_predicate'];
      schemas[name] = { $id: value.$id, 'x-scap-ng-version': value['x-scap-ng-version'], defs: Object.fromEntries(names.filter(key => value.$defs[key]).map(key => [key, schemaSummary(value.$defs[key])])) };
    } else if (name === 'assessment.schema.json') {
      const summary = schemaSummary(value);
      // The Assessment input contract is an inline additionalProperties schema.
      // A normal depth-limited summary collapses it to `{type: object}`, which
      // caused provider-only requests to incorrectly claim that Inputs were
      // unavailable. Expand this small contract while keeping the rest bounded.
      const inputs = value?.properties?.assessment?.properties?.inputs;
      if (inputs && summary?.properties?.assessment?.properties) {
        summary.properties.assessment.properties.inputs = schemaSummary(inputs, 0);
      }
      schemas[name] = summary;
    } else {
      schemas[name] = schemaSummary(value);
    }
  }
  const mappings = selectedMappings(pack, options.checkText ?? '', options.platform);
  const vocabularyResource = pack.manifest.resources.find((item: any) => item.kind === 'vocabulary');
  let vocabulary: any;
  try { vocabulary = vocabularyResource ? pack.resource(vocabularyResource.uri) : undefined; } catch { vocabulary = undefined; }
  const documentLimit = options.maxDocumentChars ?? 6500;
  const documents = Object.fromEntries([
    ['SCAP-NG-PRIMER.md', readKnowledgeDocument(extensionRoot, 'SCAP-NG-PRIMER.md', documentLimit)],
    ['ASSISTED-ASSESSMENT-DRAFTS.md', readKnowledgeDocument(extensionRoot, 'ASSISTED-ASSESSMENT-DRAFTS.md', documentLimit)],
    ['P0-SCHEMA-GUIDED-AUTHORING.md', readKnowledgeDocument(extensionRoot, 'P0-SCHEMA-GUIDED-AUTHORING.md', documentLimit)],
    ['EDITOR-BLUEPRINT.md', readKnowledgeDocument(extensionRoot, 'EDITOR-BLUEPRINT.md', documentLimit)],
    ['SCAP-NG-YAML-ARCHITECTURE-REVIEW.md', readKnowledgeDocument(extensionRoot, 'SCAP-NG-YAML-ARCHITECTURE-REVIEW.md', documentLimit)],
    ['SCHEMA-VERSION-MIGRATION-PLAN.md', readKnowledgeDocument(extensionRoot, 'SCHEMA-VERSION-MIGRATION-PLAN.md', documentLimit)],
    ['AI-AUTHORING-PLAYBOOK.md', readKnowledgeDocument(extensionRoot, 'AI-AUTHORING-PLAYBOOK.md', documentLimit)]
  ].filter(([, value]) => value));
  return JSON.stringify({
    contract: {
      schema_version: pack.pin.schemaVersion,
      canonical_source_commit: pack.pin.sourceCommit,
      editor_pack_manifest_sha256: pack.pin.manifestSha256,
      resource_count: pack.manifest.resources.length,
      schema_is_authoritative: true,
      runtime_execution_proof: false,
      context_selection: 'Relevant mappings are selected from the complete pinned pack by procedure/platform signals; absence from this context does not make a capability invalid.'
    },
    schemas,
    capability_catalog: mappings.catalog,
    relevant_capability_mappings: mappings.relevant,
    vocabulary,
    editor_documents: documents,
    authoring_invariants: [
      'The pinned 0.4.1 JSON Schemas are normative; YAML must be a complete Assessment with specification.id scap-ng.pre-alpha.assessment and specification.version 0.4.1.',
      'A Test has capability, reported_elements, an Object (or approved Object reference), and structured require. Object selectors collect Items; require fields compare those Items.',
      'reported_elements is the scalar enum all or compared, or an array of explicit field names; do not serialize [all].',
      'Comparison require uses item_requirement.items_found/items_satisfying, then field_requirement.values_found/values_matching, then fields. Existence-only field predicates use fields.<name>.values_found: none and no comparison operator.',
      'Require logical and/or/one/xor children are inherited conditions: each child is {fields: {field_name: {one operator}}} or another logical group. Never repeat item_requirement inside a logical child; keep Item cardinality once on the enclosing require. Distinct field predicates are implicitly ANDed, while multiple operators on one field use an inherited logical group.',
      'Evaluate control flow is separate from Test require: use evaluate: {if: {test: gate-test}, then: {test: technical-test}, else: {not_applicable: {reason: population absent}}}. not_applicable is a leaf outcome with reason; never put if/then/else/and under not_applicable. Evaluate logical groups contain expression objects such as {test: id}, not bare IDs.',
      'Use only canonical Test requirement cardinalities: item items_found accepts none/exactly_one/one_or_more/zero_or_more; field values_found accepts none/exactly_one/one_or_more/every/zero_or_more; values_matching accepts none/exactly_one/one_or_more/every. Assessment Input declarations separately accept exactly_one, zero_or_one, one_or_more, or zero_or_more and require datatype, cardinality, and required. Do not emit OVAL spellings such as at_least_one.',
      'Do not invent numeric bounds that are absent from the procedure merely from a guessed implementation domain. Preserve every explicit bound exactly; if a value has an external implementation range, state it as an assumption/review item or use only the supplied schema/mapping evidence rather than silently adding a lower or upper bound.',
      'Do not collapse independent procedure checks merely to reduce Test count. If the procedure says a missing/unconfigured option on any member is a finding, retain the full parent population and require every member to satisfy the option predicate, or retain an explicit absence Test; a selector that matches only members containing the option cannot detect a mixed population where another member omits it.',
      'Before finalizing, perform an adversarial semantic review: identify the collected population and excluded members, then test omitted options, malformed values, negative or out-of-range values, duplicate directives, comments/inline comments, empty collections, and mixed compliant/noncompliant populations. A filter must not hide a member that the procedure says is a finding. When syntax or implementation validity is uncertain, do not silently accept it; state the assumption and preserve a finding/review condition.',
      "Regex escaping is layered: the outer JSON response escapes backslashes once, but the returned YAML scalar must contain the intended regex after YAML parsing. Prefer a single-quoted YAML regex scalar when backslashes are needed (for example, '^\\s*server'), and do not emit JSON-style double escaping into the YAML value. Verify the parsed regex semantics before returning.",
      'Object selectors are schema-authorized operator maps, not invented operation names: for linux.dpkginfo and linux.rpminfo use name: {equals: package} or name: {matches_regex: regex}; pattern_match is not a SCAP-NG operator. Use the exact selector names and operations in the relevant capability mapping.',
      'independent.shellcommand always creates one Item so empty stdout is a field absence condition, never item_requirement.items_found: zero_or_more.',
      'Object.pattern filters shellcommand stdout before field requirements; retain the pattern there and use a schema-valid field predicate for the resulting stdout_line.',
      'Evaluate references Test IDs with expression objects such as {test: id}; it may branch to test, not_applicable, or not_evaluated. Do not use a bare ID.',
      'Rule-local applicability uses internal population Tests and Evaluate. External applicability Assessments are reused only when supplied by the Benchmark; never invent a dependency ID.',
      'If a procedure says Not Applicable when a population is absent, create a population gate Test and a separate technical Test when needed: if population then technical else not_applicable. Do not collapse the gate and technical failure into one not_evaluated branch.',
      'An ISSO/ISSM/SA/AO approval or deviation does not make a known technical violation unknown. Preserve the pass/fail Test and record an approved deviation after evaluation. Use not_evaluated only when the technical check cannot run or required evidence is unavailable.',
      'When a procedure depends on an organization-defined value such as an authorized time server, declare an Assessment inputs contract and consume an input reference; never hard-code the value or invent a default. The author does not need to know the organization-approved addresses: the organization supplies them through the policy-layer binding. Do not add a default value. Input names must end in -input and each declaration includes datatype, cardinality (exactly_one, zero_or_one, one_or_more, or zero_or_more), and required. The only optional declaration members are description and constraints; there is no default property and no implicit default. Required Inputs use required: true. A missing required Input is an execution error with reason code missing_organizational_input, not Not Applicable or a fabricated technical failure; invalid or unsupported bindings use their corresponding input reason codes. Optional Input consumers require a direct input_provided guard.',
      'Never emit an empty Object, placeholder predicate, invented capability, scanner PASS/FAIL, or runtime-proof claim. Return manual-only when the objective predicate or complete population cannot be represented.',
      'Preserve every path, wildcard, conf.d directory, set, and per-user relationship; do not silently reduce a population to one example file. For dynamic populations, use only the supplied capability-common and variable-expression schemas for file_traversal, set_expression, foreach, and Variable references; do not claim manual-only merely because a population is dynamic when the pinned schemas represent it.',
      'Treat generated output as review-only until the author verifies selectors, predicates, applicability, exceptions, and target-platform behavior.'
    ],
    current_authoring_examples: {
      basic_assessment: 'assessment: { id: example-assessment, version: 1, assessment_title: Check a file, mode: automated, class: compliance, tests: { example-test: { test_title: Check a file, capability: unix.file, object: { filepath: { equals: /etc/example } }, require: { item_requirement: { items_found: one_or_more } } } } }',
      comparison_require: 'reported_elements: all; require: { item_requirement: { items_found: one_or_more, items_satisfying: every }, field_requirement: { values_found: one_or_more, values_matching: every }, fields: { value: { equals: expected } } }',
      shellcommand_existence: 'capability: independent.shellcommand; object: { shell: bash, command: command, error_if_exit_status_not_0: false, error_if_stderr_exists: false }; require: { item_requirement: { items_found: one_or_more, items_satisfying: every }, field_requirement: { values_found: none }, fields: { stdout_line: { values_found: none } } }; reported_elements: all',
      shellcommand_filtered_absence: 'For a filtered stdout absence check, put the regex in Object.pattern, keep shellcommand item_requirement.items_found: one_or_more because shellcommand always creates an Item, and use fields.stdout_line: { values_found: none }. Do not use item zero_or_more to model missing stdout.',
      applicability_boundary: 'For Rule-local conditions, use internal Tests plus evaluate if/then/else and not_applicable; use an external Assessment dependency only for a supplied reusable condition. A valid expression uses {test: sssd-active-test}, not a bare test ID.',
      internal_applicability: 'evaluate: {if: {test: service-active-test}, then: {if: {not: {test: excluded-provider-test}}, then: {test: protected-setting-test}, else: {not_applicable: {reason: excluded provider}}}, else: {not_applicable: {reason: service inactive}}}',
      applicability_gate_with_failure: 'When a population is N/A if absent but must fail when a violation exists: tests include population-present-test and technical-absence-test; evaluate: {if: {test: population-present-test}, then: {test: technical-absence-test}, else: {not_applicable: {reason: population absent}}}. An approval exception does not become not_evaluated.',
      manual_exception_branch: 'When the technical condition is automatable but an ISSO/owner exception cannot be verified, author the objective technical Test normally and let it produce its real pass/fail result. Do not convert a known failure into not_evaluated; an approved deviation is recorded after evaluation by the organization. Use not_evaluated only when the technical check itself cannot be performed or the required evidence is genuinely unavailable.',
      organizational_input: 'For an organization-approved value, declare inputs: {authorized-time-server-input: {datatype: string, cardinality: one_or_more, required: true}} and compare observed fields with {input: authorized-time-server-input}; do not put actual addresses in the Assessment. The Rule/Benchmark supplies the organization binding. Missing required input is runtime error missing_organizational_input.'
    }
  });
}
function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Providers sometimes wrap an otherwise valid JSON contract in a sentence or
 * a Markdown code fence. Extract only a complete JSON object and still send
 * it through the normal schema/coverage gates. This is tolerant parsing, not
 * acceptance of arbitrary prose or YAML.
 */
function parseProviderJson(raw: string): any {
  const candidates = [stripCodeFence(raw)];
  for (let start = raw.indexOf('{'); start >= 0; start = raw.indexOf('{', start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < raw.length; index++) {
      const character = raw[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') { quoted = true; continue; }
      if (character === '{') depth++;
      else if (character === '}' && --depth === 0) {
        candidates.push(raw.slice(start, index + 1));
        break;
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* Try the next bounded object candidate. */ }
  }
  throw new Error('No complete JSON object was found in the provider response.');
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean) : [];
}

function normalizeCoverage(value: unknown): AiAssessmentCoverage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as any;
  const applicability = source.applicability;
  if (applicability !== 'implemented' && applicability !== 'not-needed' && applicability !== 'not-representable') return undefined;
  const steps = Array.isArray(source.procedure_steps) ? source.procedure_steps : [];
  const paths = Array.isArray(source.path_patterns) ? source.path_patterns : [];
  const procedureSteps = steps.filter((step: any) => step && typeof step.summary === 'string' && typeof step.represented === 'boolean').map((step: any) => ({ summary: step.summary.trim(), represented: step.represented, tests: list(step.tests) }));
  const pathPatterns = paths.filter((path: any) => path && typeof path.pattern === 'string' && typeof path.represented === 'boolean').map((path: any) => ({ pattern: path.pattern.trim(), represented: path.represented, strategy: typeof path.strategy === 'string' ? path.strategy.trim() : undefined }));
  return { applicability, procedureSteps, pathPatterns };
}

function procedureNeedsApplicability(text: string): boolean {
  // A finding condition such as "if maxpoll is not configured, this is a
  // finding" is technical pass/fail logic, not applicability. Require an
  // explicit N/A/usage branch before demanding evaluate.not_applicable.
  return /not applicable|\bn\/a\b|not being utilized|not being used/i.test(text)
    || /if [^\n.]{0,180}\b(?:inactive|not installed|not configured)\b[^\n.]{0,180}\b(?:not applicable|n\/a)\b/i.test(text);
}

function procedureHasPathSet(text: string): boolean {
  return /\*|\[[^\]]+\]|\bconf\.d\b|\bfor each\b|\ball files?\b|\bany files?\b/i.test(text);
}

function expressionHasNotApplicable(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, 'not_applicable')) return true;
  return Object.values(value as Record<string, unknown>).some(expressionHasNotApplicable);
}

function expressionHasNotEvaluated(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, 'not_evaluated')) return true;
  return Object.values(value as Record<string, unknown>).some(expressionHasNotEvaluated);
}

function hasExternalApplicability(value: any): boolean {
  const assessment = value?.assessment;
  if (assessment?.applicability) return true;
  return Object.values(assessment?.dependencies ?? {}).some((dependency: any) => dependency?.purpose === 'applicability');
}

function procedureHasHumanException(text: string): boolean {
  return /\b(?:ISSO|ISSM|SA|AO|authorizing official|system owner|security administrator)\b|documented (?:exception|approval)|approved (?:exception|use)/i.test(text);
}

function coverageDiagnostics(input: AiAssessmentInput, payload: any, value: any): string[] {
  const coverage = normalizeCoverage(payload?.coverage);
  if (!coverage) return ['AI response omitted the required procedure coverage manifest; no draft was accepted.'];
  const diagnostics: string[] = [];
  if (procedureNeedsApplicability(input.checkText) && coverage.applicability !== 'implemented') diagnostics.push('The procedure contains a Not Applicable/conditional branch, but the AI did not implement that branch in Assessment logic.');
  if (procedureNeedsApplicability(input.checkText) && !expressionHasNotApplicable(value?.assessment?.evaluate) && !hasExternalApplicability(value)) diagnostics.push('Applicability is not represented. Use an internal evaluate branch with not_applicable for a Rule-local gate, or an explicit reusable applicability Assessment dependency.');
  if (coverage.procedureSteps.some(step => !step.represented)) diagnostics.push('The AI coverage manifest identifies one or more procedure steps that are not represented; partial automation is not linkable.');
  if (procedureHasPathSet(input.checkText) && (!coverage.pathPatterns.length || coverage.pathPatterns.some(path => !path.represented))) diagnostics.push('The procedure names a path set, wildcard, or multiple files, but the AI did not represent the complete population.');
  if (!coverage.procedureSteps.length) diagnostics.push('The AI coverage manifest contains no procedure steps.');
  const unresolvedCritical = list(payload?.unresolved_questions).filter(item => /applicability|not applicable|partial|wildcard|additional file|path set|cannot be represented|not represent|not managed/i.test(item));
  if (unresolvedCritical.length && !expressionHasNotEvaluated(value?.assessment?.evaluate)) diagnostics.push('The AI reports unresolved semantic coverage gaps; represent the technical check completely or return manual-only.');
  if (procedureHasHumanException(input.checkText) && expressionHasNotEvaluated(value?.assessment?.evaluate)) diagnostics.push('A known technical failure must remain a pass/fail Test. Do not use not_evaluated for an ISSO/owner deviation; record the approved deviation after evaluation.');
  if (value?.assessment?.mode === 'automated' && !value?.assessment?.evaluate && coverage.procedureSteps.length > 1) diagnostics.push('Multiple procedure steps require explicit evaluate logic; the draft has no evaluate expression.');
  for (const [testId, test] of Object.entries(value?.assessment?.tests ?? {}) as Array<[string, any]>) {
    if (test?.capability === 'independent.shellcommand' && test?.require?.item_requirement?.items_found === 'zero_or_more') diagnostics.push(`Shellcommand Test ${testId} uses items_found: zero_or_more, but shellcommand always creates an Item; use field values_found: none for empty stdout/stderr.`);
  }
  return diagnostics;
}

function normalizedAssessmentId(ruleId: string): string {
  const raw = ruleId.replace(/-rule$/, '-assessment').toLowerCase();
  const normalized = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-') || 'assisted-assessment';
  const suffix = '-assessment';
  if (normalized.endsWith(suffix) && normalized.length > 64) return normalized.slice(0, 64 - suffix.length).replace(/-+$/, '') + suffix;
  return normalized.slice(0, 64).replace(/-+$/, '');
}

function normalizeProviderAssessmentIdentity(value: any, input: AiAssessmentInput): { value: any; yamlChanged: boolean; note?: string } {
  const assessment = value?.assessment;
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) return { value, yamlChanged: false };
  const id = typeof assessment.id === 'string' ? assessment.id : '';
  const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length >= 1 && id.length <= 64;
  if (valid) return { value, yamlChanged: false };
  const replacement = normalizedAssessmentId(input.ruleId);
  if (id === replacement) return { value, yamlChanged: false };
  const next = { ...value, assessment: { ...assessment, id: replacement } };
  return { value: next, yamlChanged: true, note: `The provider Assessment ID '${id || '(missing)'}' was normalized to '${replacement}' to satisfy the pinned 0.4.1 identity limit.` };
}

function schemaValidationDiagnostics(pack: MetadataPack, schemaUri: string, value: any): string[] {
  const errors = pack.validateDetailed(schemaUri, value) as Array<{ instancePath?: string; keyword?: string; params?: Record<string, any>; message?: string }>;
  const diagnostics: string[] = [];
  const seen = new Set<string>();
  const path = (error: any) => error.instancePath || '/';
  const add = (message: string) => { if (!seen.has(message)) { seen.add(message); diagnostics.push(message); } };
  for (const error of errors) {
    const location = path(error);
    const params = error.params ?? {};
    switch (error.keyword) {
      case 'required':
        add(`${location}: missing required property '${params.missingProperty}'.`);
        break;
      case 'additionalProperties':
        add(`${location}: remove unsupported property '${params.additionalProperty}'.`);
        break;
      case 'oneOf':
        add(`${location}: choose exactly one schema form. For a comparison Test use item_requirement (items_found/items_satisfying), field_requirement (values_found/values_matching), then fields; for existence-only use item_requirement only.`);
        break;
      case 'not':
        add(`${location}: legacy or conflicting Test/Require shape is not allowed by the pinned 0.4.1 schema.`);
        break;
      case 'const':
      case 'enum':
      case 'type':
      case 'pattern':
      case 'minProperties':
      case 'minItems':
        add(`${location}: ${error.message ?? 'value is not valid for the pinned 0.4.1 schema'}.`);
        break;
      default:
        if (error.message) add(`${location}: ${error.message}.`);
        break;
    }
  }
  const text = diagnostics.join('\n');
  if (/reported_elements/.test(text)) add('reported_elements guidance: use the scalar `all` or `compared`, or an array of explicit field names; `[all]` is invalid.');
  if (/\/require\/fields\//.test(text) || /\/require$/.test(text)) add('Require guidance: a field predicate is never {values_found: one_or_more}; use a comparison operator such as matches_regex/equals, or use {values_found: none} only inside fields.<field> for confirmed absence.');
  if (/field_requirement/.test(text)) add('Field requirement guidance: values_found: none is not valid under require.field_requirement; comparison Tests need values_found: one_or_more and values_matching: every as a pair.');
  return diagnostics.slice(0, 18);
}

function draftFromFailure(message: string, assumptions: string[] = []): AiAssessmentDraft {
  return { generatedMode: 'manual-only', confidence: 'low', yaml: '', diagnostics: [message], document: undefined, assumptions, unresolved: [message], citations: [], method: 'configured-ai' };
}

export function modelUsesPinnedTools(model: string): boolean {
  // GenAI model IDs use a `withtools` token. Treat separators as token
  // boundaries so versioned IDs such as `...-withtools-v2` work, while a
  // similarly named model such as `withouttools` does not opt in by accident.
  return /(?:^|[-_.])withtools(?:$|[-_.])/i.test(model.trim());
}

function providerLabel(endpoint: string): string {
  if (endpoint === 'codex-local') return 'local Codex CLI';
  try { return new URL(endpoint).hostname || 'configured endpoint'; }
  catch { return 'configured endpoint'; }
}

function provenanceComment(pack: MetadataPack, endpoint: string, model: string, generatedAt: string, toolMode: 'local-pinned-pack' | 'fallback-no-tools' | 'not-requested', durationMs: number): string {
  return [
    '# SCAP-NG editor provenance:',
    '#   generation_method: configured-ai',
    `#   provider_endpoint: ${providerLabel(endpoint)}`,
    `#   model: ${model.replace(/[\r\n]+/g, ' ')}`,
    `#   tool_mode: ${toolMode}`,
    '#   tool_execution: provider-dependent; runtime qualification not established',
    `#   generated_at: ${generatedAt}`,
    `#   duration_ms: ${durationMs}`,
    `#   schema_version: ${pack.pin.schemaVersion}`,
    `#   canonical_source_commit: ${pack.pin.sourceCommit}`,
    `#   editor_pack_manifest_sha256: ${pack.pin.manifestSha256}`,
    '#   runtime_qualification: not-established',
    ''
  ].join('\n');
}

function withProviderProvenance(pack: MetadataPack, endpoint: string, model: string, draft: AiAssessmentDraft, toolMode: 'local-pinned-pack' | 'fallback-no-tools' | 'not-requested', toolWarning?: string, durationMs = 0): AiAssessmentDraft {
  const generatedAt = new Date().toISOString();
  return {
    ...draft,
    provider: providerLabel(endpoint),
    model,
    generatedAt,
    toolMode,
    toolWarning,
    durationMs,
    yaml: draft.yaml ? provenanceComment(pack, endpoint, model, generatedAt, toolMode, durationMs) + draft.yaml : draft.yaml
  };
}

function providerAssessmentYaml(payload: any): string {
  if (typeof payload?.assessment_yaml === 'string') return stripCodeFence(payload.assessment_yaml);
  if (typeof payload?.assessment === 'string') return stripCodeFence(payload.assessment);
  if (!payload?.assessment || typeof payload.assessment !== 'object' || Array.isArray(payload.assessment)) return '';
  // A few providers return the Assessment object itself instead of the
  // requested assessment_yaml string. Preserve the native root shape when it
  // is already present; wrap an inner Assessment object before validation.
  if (Object.hasOwn(payload.assessment, 'assessment')) return stringify(payload.assessment);
  if (Object.hasOwn(payload.assessment, 'mode') || Object.hasOwn(payload.assessment, 'id')) return stringify({ assessment: payload.assessment });
  return stringify(payload.assessment);
}

function inferProviderGeneratedMode(payload: any): { mode?: 'automated' | 'manual-only'; inferred?: string } {
  // The JSON contract asks for generated_mode, but some otherwise capable
  // OpenAI-compatible models omit that protocol field while returning a
  // complete Assessment. Recover only when the Assessment itself explicitly
  // declares mode: automated; never infer manual-only from an incomplete
  // response and never accept a YAML draft whose mode is ambiguous.
  if (payload?.generated_mode === 'automated' || payload?.generated_mode === 'manual-only') return { mode: payload.generated_mode };
  if (payload?.generatedMode === 'automated' || payload?.generatedMode === 'manual-only') return { mode: payload.generatedMode, inferred: 'The provider used generatedMode instead of generated_mode; the equivalent protocol field was accepted.' };
  let candidate: any;
  try {
    const yamlText = providerAssessmentYaml(payload);
    if (yamlText) {
      const document = parseDocument(yamlText, { uniqueKeys: true });
      if (!document.errors.length) candidate = document.toJS({ maxAliasCount: 50 });
    }
  } catch { /* The normal YAML/schema diagnostics provide the useful failure. */ }
  if (candidate?.assessment?.mode === 'automated') return { mode: 'automated', inferred: 'The provider omitted generated_mode; automated mode was inferred from assessment.mode: automated and still passed the local protocol/schema checks.' };
  return {};
}

function automationClassForAssessment(value: any, generatedMode: 'automated' | 'manual-only'): 'fully-automated' | 'organizational-input' | 'manual' {
  if (generatedMode === 'manual-only') return 'manual';
  return value?.assessment?.inputs && typeof value.assessment.inputs === 'object' && !Array.isArray(value.assessment.inputs) && Object.keys(value.assessment.inputs).length
    ? 'organizational-input'
    : 'fully-automated';
}

function parseAiAssessmentResponse(pack: MetadataPack, input: AiAssessmentInput, raw: string): AiAssessmentDraft {
  let payload: any;
  try { payload = parseProviderJson(raw); }
  catch { return draftFromFailure(`The AI response was not valid JSON (received ${raw.length} characters); no complete JSON object was found; no draft was accepted.`); }
  const assumptions = list(payload?.assumptions);
  const unresolved = list(payload?.unresolved_questions);
  const citations = list(payload?.citations);
  const rationale = typeof payload?.rationale === 'string' ? payload.rationale.trim() : undefined;
  const coverage = normalizeCoverage(payload?.coverage);
  const confidence = payload?.confidence === 'high' || payload?.confidence === 'medium' ? payload.confidence : 'low';
  const generated = inferProviderGeneratedMode(payload);
  if (generated.inferred) assumptions.push(generated.inferred);
  if (generated.mode === 'manual-only') return { generatedMode: 'manual-only', automationClass: 'manual', confidence, yaml: '', diagnostics: [], document: undefined, assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
  if (generated.mode !== 'automated') return draftFromFailure('The AI response did not declare generated_mode as automated or manual-only.', assumptions);
  let yamlText = providerAssessmentYaml(payload);
  if (!yamlText) return draftFromFailure('The AI response did not contain assessment_yaml.', assumptions);
  const document = parseDocument(yamlText, { uniqueKeys: true });
  if (document.errors.length) return { generatedMode: 'automated', confidence: 'low', yaml: yamlText, diagnostics: document.errors.map(error => error.message), assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
  let value: any;
  try { value = document.toJS({ maxAliasCount: 50 }); } catch (error) { return { generatedMode: 'automated', confidence: 'low', yaml: yamlText, diagnostics: [error instanceof Error ? error.message : String(error)], assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' }; }
  const identity = normalizeProviderAssessmentIdentity(value, input);
  if (identity.yamlChanged) {
    value = identity.value;
    yamlText = stringify(value);
  }
  const schemaUri = pack.manifest.resources.find((item: any) => item.kind === 'schema' && item.uri.endsWith('/assessment.schema.json'))?.uri;
  const diagnostics = schemaUri ? schemaValidationDiagnostics(pack, schemaUri, value) : ['Pinned Assessment schema is unavailable.'];
  const semanticDiagnostics = coverageDiagnostics(input, payload, value);
  if (diagnostics.length) return { generatedMode: 'automated', confidence: 'low', yaml: yamlText, diagnostics: [...diagnostics, ...semanticDiagnostics], assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
  if (value?.assessment?.mode !== 'automated') diagnostics.push('AI draft must contain assessment.mode: automated.');
  if (identity.note) assumptions.push(identity.note);
  if (!value?.assessment?.id || value.assessment.id !== input.ruleId.replace(/-rule$/, '-assessment')) assumptions.push('Review the generated Assessment ID and its Rule linkage before saving.');
  diagnostics.push(...semanticDiagnostics);
  const effectiveConfidence = diagnostics.length ? 'low' : confidence;
  return { generatedMode: 'automated', automationClass: automationClassForAssessment(value, 'automated'), confidence: effectiveConfidence, yaml: yamlText, document: value, diagnostics, assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
}

export const AI_REQUEST_TOTAL_TIMEOUT_MS = 120_000;

export async function createAiAssessmentDraft(pack: MetadataPack, extensionRoot: string, endpoint: string, apiKey: string, model: string, input: AiAssessmentInput, options: AiAssessmentOptions = {}): Promise<AiAssessmentDraft> {
  const startedAt = Date.now();
  const deadline = startedAt + AI_REQUEST_TOTAL_TIMEOUT_MS;
  const profileKey = toolProfileKey(endpoint, model);
  const previouslyRejectedTools = options?.skipTools === true || unsupportedToolProfiles.has(profileKey);
  let useTools = modelUsesPinnedTools(model) && !previouslyRejectedTools;
  let toolMode: 'local-pinned-pack' | 'fallback-no-tools' | 'not-requested' = useTools ? 'local-pinned-pack' : previouslyRejectedTools ? 'fallback-no-tools' : 'not-requested';
  let toolWarning: string | undefined = previouslyRejectedTools ? 'The gateway previously rejected tools for this endpoint/model during this VS Code session; skipped the failed tools negotiation.' : undefined;
  const finalize = (draft: AiAssessmentDraft) => withProviderProvenance(pack, endpoint, model, draft, toolMode, toolWarning, Date.now() - startedAt);
  const remainingTimeout = () => Math.max(0, deadline - Date.now());
  // Bound user-controlled source before constructing a provider request. This
  // protects the authoring host and makes the exact outbound scope predictable.
  if (input.checkText.length > 60000) return finalize(draftFromFailure('The procedure text is larger than the AI authoring limit (60,000 characters); use a focused excerpt or the offline workflow.'));
  if ((input.ruleYaml?.length ?? 0) > 50000) return finalize(draftFromFailure('The Rule YAML is larger than the AI authoring limit (50,000 characters); remove unrelated context or use the offline workflow.'));
  if (input.title.length > 4000 || input.ruleId.length > 1000) return finalize(draftFromFailure('The Rule identity/title exceeds the AI authoring limit; shorten it before retrying.'));
  const knowledge = buildScapNgKnowledge(pack, extensionRoot, { platform: input.platform, checkText: input.checkText, maxDocumentChars: 4500 });
  const system = `You are a SCAP-NG 0.4.1 assessment-authoring specialist, not a generic novice assistant. Use ONLY the canonical knowledge pack below as the normative contract. Apply the included AI-AUTHORING-PLAYBOOK.md procedure method; it contains generic authoring reasoning, not hard-coded content. The schema and capability mappings are authoritative; do not invent fields, capabilities, operators, result semantics, applicability semantics, or scanner behavior. Do not invent numeric bounds absent from the procedure; preserve explicit inequalities and flag external implementation-range assumptions for review. Do not collapse independent procedure checks merely to reduce Test count: a pattern that selects only lines containing an option cannot detect another line that omits it; preserve a full-population predicate or explicit absence Test. Before finalizing, perform an adversarial semantic review: test omitted options, malformed values, negative or out-of-range values, duplicate directives, comments/inline comments, empty collections, and mixed compliant/noncompliant populations; a filter must not hide a member that the procedure says is a finding. When syntax or implementation validity is uncertain, state the assumption and preserve a finding/review condition. Regex escaping is layered: the outer JSON response escapes backslashes once, but the returned YAML scalar must contain the intended regex after YAML parsing; prefer a single-quoted YAML regex scalar when backslashes are needed and do not emit JSON-style double escaping into the YAML value. Verify the parsed regex semantics before returning. Prefer an existing mapped capability over a new one. Preserve the objective technical check and its real pass/fail result even when the procedure mentions an ISSO/ISSM/SA/AO exception; approved deviations are recorded after evaluation and must not be represented as not_evaluated. When a procedure requires an organization-defined value (for example, an authorized time server), declare a typed Assessment input and consume it through an input reference instead of hard-coding a value or inventing a default. The unknown organization-approved value is not a reason for manual-only; the policy-layer binding supplies it later. Do not invent a networked-system Input or applicability gate unless the supplied procedure explicitly defines that branch. Missing required input is a runtime error with reason code missing_organizational_input; optional consumers require an input_provided guard. Return manual-only only when no objective collector/predicate can be expressed or the check itself cannot be performed. For a Rule-local applicability branch, use internal Tests and evaluate if/then/else with an explicit not_applicable outcome. Use an external applicability Assessment only when a supplied reusable condition/dependency exists; never invent an external Assessment ID.

Do not copy any example's command, Test ID, selector, or predicate; examples are structural guidance only. Serialize reported_elements as scalar all/compared or an explicit field-name array, never [all]. In a fields map, use exactly one comparison operator (for example stdout_line: {matches_regex: regex}); values_matching belongs only to field_requirement. For confirmed absence, put values_found: none only in fields.<field>, while keeping the paired field_requirement above it. Require logical and/or/one/xor children are inherited conditions and must contain fields or nested logical groups only; never put item_requirement inside those children. Keep item_requirement once on the enclosing require. For two predicates on one field, use an inherited and group with children such as {fields: {subexpression: {datatype: integer, greater_than: 0}}} and {fields: {subexpression: {datatype: integer, less_than_or_equal: 600}}}. Evaluate control flow must use if/then/else siblings; not_applicable is only a leaf outcome with reason, never a container for and/else. Use only cardinalities none, exactly_one, one_or_more, zero_or_more, and every; never emit at_least_one. Object selectors must use exact schema operators, for example linux.dpkginfo uses name: {equals: ufw} or name: {matches_regex: regex}; never invent pattern_match or raw selector syntax. Derive every Test from the supplied procedure and current Rule context. The editor will reject invalid output; it will not synthesize a content-specific replacement after the provider responds. If a Candidate Assessment is supplied in the user context, perform an independent review: compare it against every source obligation, construct adversarial counterexamples for omitted/malformed/commented/negative/out-of-range values and mixed populations, then return a complete corrected Assessment or preserve it only if it passes. Do not return a prose verdict instead of the required JSON contract.

If local SCAP-NG tools are available, use them to search mappings, inspect capability schemas, and validate a proposed Assessment before finalizing. Tool results are authoritative for the pinned pack and do not prove RI execution. Apply the authoring invariants and examples in the knowledge pack, especially the distinction between a population/applicability gate and the technical Test. For an explicit Not Applicable population branch, use separate internal Tests and Evaluate if/then/else when the supplied procedure supports that distinction. For an ISSO/ISSM/SA/AO exception, keep the technical Test's real pass/fail semantics; do not use not_evaluated merely because a human may approve a deviation after failure.

Your task is to propose one Assessment for the supplied Rule and check procedure. Return ONLY a JSON object with these keys: generated_mode (automated or manual-only), confidence (high, medium, low), assessment_yaml (a YAML string when automated, empty when manual-only), assumptions (array of strings), unresolved_questions (array of strings), citations (array of short knowledge-pack pointers), rationale (short string), and coverage ({applicability: implemented|not-needed|not-representable, procedure_steps: [{summary, represented, tests}], path_patterns: [{pattern, represented, strategy}]}). Do not return Markdown or code fences, compliance PASS/FAIL, or a claim of runtime/scanner proof. The assessment_yaml must be a complete native SCAP-NG 0.4.1 Assessment and must validate against the supplied assessment schema: include specification, evaluate, test_title, reported_elements, and Test IDs ending in -test. Use explicit serialized values; never rely on presentation defaults. Decompose every command/check into an appropriate Test and connect them with explicit evaluate if/then/else logic. A Not Applicable branch must be represented with not_applicable or an existing applicability Assessment dependency; do not merely mention it in unresolved_questions while returning automated. Preserve every file path and wildcard population using schema-authorized directory/filename/set/for_each constructs; never collapse a wildcard to one file. Return manual-only if any required branch, path population, or objective predicate cannot be represented completely. A human approval exception alone does not require manual-only: represent the objective technical Test and let a known violation fail. Do not add not_evaluated merely because an ISSO/owner exception is mentioned; record an approved deviation after evaluation. Use not_evaluated only when the technical check itself cannot be performed or required evidence is unavailable. Automated plus a partial coverage manifest is invalid. Every Test must include a schema-valid test_title, capability, reported_elements, object and require. Object selectors must use operator maps such as full_path: {equals: /etc/example} and pattern: {matches_regex: regex}, never raw selector strings. For comparison requirements, use item_requirement.items_satisfying and field_requirement.values_matching only with schema cardinalities such as every; one_or_more belongs to items_found/values_found. For independent.shellcommand, an Item is always created even when stdout/stderr is empty; use field existence values_found: none on stdout_line/stderr_line for absence checks. Object.pattern filters stdout lines before field requirements. Do not infer Not Applicable from an absence test unless the procedure independently establishes the hardware/population branch; preserve unresolved ISSO exceptions as review notes while keeping the objective Test's pass/fail semantics; do not turn a known failure into not_evaluated.

Canonical SCAP-NG knowledge pack (provenance pinned):
${knowledge}`;
  const user = `Generate an AI-assisted draft for this source context. The user explicitly approved sending this bounded context to the configured provider.

Rule ID: ${input.ruleId}
Rule title: ${input.title}
Target platform context: ${input.platform || 'unknown; do not infer applicability solely from platform'}

Manual/check procedure text:
--- BEGIN PROCEDURE ---
${input.checkText}
--- END PROCEDURE ---

Current Rule YAML (context only; do not rewrite or mutate it):
--- BEGIN RULE YAML ---
${input.ruleYaml || '(not supplied)'}
--- END RULE YAML ---

${input.candidateYaml ? `Candidate Assessment for independent review (review-only input; do not assume schema validity):
--- BEGIN CANDIDATE ASSESSMENT ---
${input.candidateYaml.slice(0, 50000)}
--- END CANDIDATE ASSESSMENT ---
Review mode: ${input.reviewMode ? 'true' : 'false'}. Return the same structured JSON contract with a complete corrected Assessment when needed.` : ''}

Existing Benchmark applicability conditions (reference context only; do not invent IDs):
${JSON.stringify(input.availableConditions ?? [])}`;
  const messages: OpenAiChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const requestDraft = async (requestMessages: OpenAiChatMessage[], timeout: number): Promise<string> => {
    if (options.request) return options.request(requestMessages, timeout);
    if (!useTools) return requestOpenAiCompatibleChat(endpoint, apiKey, model, requestMessages, timeout);
    try {
      return await requestOpenAiCompatibleChatWithTools(endpoint, apiKey, model, requestMessages, aiToolDefinitions(), aiToolHandler(pack), timeout);
    } catch (error) {
      // Some OpenAI-compatible gateways expose a model whose name contains
      // `withtools` but reject the standard tools fields at the gateway. Keep
      // authoring usable: retry this bounded request once without tools and
      // make the downgrade explicit in the preview/provenance.
      if (!(error instanceof OpenAiCompatibleHttpError) || error.status !== 400) throw error;
      const firstError = error.message;
      unsupportedToolProfiles.add(profileKey);
      await options.onToolsRejected?.();
      useTools = false;
      toolMode = 'fallback-no-tools';
      toolWarning = `${firstError}; retried once without tools because the gateway rejected the tool request.`;
      try {
        return await requestOpenAiCompatibleChat(endpoint, apiKey, model, requestMessages, timeout);
      } catch (fallbackError) {
        throw new Error(`${firstError}; retry without tools also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
      }
    }
  };
  let raw: string;
  try {
    const timeout = remainingTimeout();
    if (!timeout) return finalize(draftFromFailure('The AI request exceeded the total authoring deadline before a response was received.'));
    raw = await requestDraft(messages, timeout);
  }
  catch (error) { return finalize(draftFromFailure(error instanceof Error ? error.message : String(error))); }
  const draft = parseAiAssessmentResponse(pack, input, raw);
  if (!draft.diagnostics.length) return finalize(draft);

  // One bounded repair pass gives a capable provider a chance to correct schema
  // and applicability mistakes using the local validator's exact diagnostics.
  // Do not resend the full schema/catalog prompt here: the first request already
  // supplied it, and repeating ~100 KB of context makes a failed response almost
  // twice as slow. The original procedure/rule remains in repairUser.
  const repairSystem = `You are repairing one SCAP-NG 0.4.1 Assessment-authoring response. Return ONLY one complete JSON object with generated_mode, confidence, assessment_yaml, assumptions, unresolved_questions, citations, rationale, and coverage. Do not return prose, Markdown, or a patch. Use the supplied local diagnostics as authoritative. The YAML must include specification id scap-ng.pre-alpha.assessment/version 0.4.1, scalar reported_elements all/compared (or explicit field names), and schema-valid Test-local require. If an organization-defined value is needed, declare assessment.inputs.<name-ending-in--input> with datatype, cardinality (exactly_one|zero_or_one|one_or_more|zero_or_more), and required, then use {input: <name>}; do not request or invent concrete organizational values. Input declarations have no default property; do not invent an applicability Input or gate unless the procedure explicitly requires it. Comparison require uses item_requirement items_found/items_satisfying, field_requirement values_found/values_matching, then fields. A field map contains exactly one operator; values_matching belongs only to field_requirement. Require logical and/or/one/xor children are inherited conditions containing fields or nested logical groups only; never put item_requirement inside a child. Keep item_requirement once on the enclosing require. To apply two predicates to one field, use an inherited and group with one fields child per predicate. Evaluate applicability must be shaped as evaluate.if with sibling then and else branches; not_applicable is a leaf containing only reason, not a container for and/else. Do not add numeric lower or upper bounds that the procedure does not state; preserve explicit inequalities and flag external implementation ranges for review. Do not collapse independent checks merely to reduce Test count; preserve full-population and omission/finding semantics. Regex escaping is layered: ensure the YAML regex contains the intended single backslashes after YAML parsing, not JSON-style double escaping; prefer single-quoted YAML regex scalars. Before finalizing, perform an adversarial semantic review of omitted options, malformed/negative/out-of-range values, duplicate directives, comments/inline comments, empty collections, and mixed compliant/noncompliant populations; a selector must not hide a member that the procedure says is a finding. When syntax or implementation validity is uncertain, state the assumption and preserve a finding/review condition. Regex escaping is layered: the outer JSON response escapes backslashes once, but the returned YAML scalar must contain the intended regex after YAML parsing; prefer a single-quoted YAML regex scalar when backslashes are needed and do not emit JSON-style double escaping into the YAML value. Verify the parsed regex semantics before returning. Use canonical Test requirement cardinalities only: none, exactly_one, one_or_more, zero_or_more, every; Assessment Input declarations additionally allow zero_or_one and require datatype/cardinality/required; never emit at_least_one. Object selectors must use exact mapping operators; linux.dpkginfo uses name: {equals: value} or name: {matches_regex: regex}, never pattern_match. For shellcommand, Items always exist; use fields.stdout_line/stderr_line values_found: none only for absence. Keep known technical failures as pass/fail; use not_applicable only for a real applicability branch and not_evaluated only when the technical check/evidence is unavailable. If the Assessment consumes a missing required organizational Input, preserve the input contract and let the runtime report error with reason code missing_organizational_input; do not turn it into Not Applicable or a guessed value. Do not ask the author for concrete organization-approved values merely to generate the Assessment. The correction response must include a nonempty coverage object even when the YAML is otherwise correct: coverage.applicability must be implemented, not-needed, or not-representable; procedure_steps must list every objective step with represented: true/false and test IDs; path_patterns must list every wildcard/path set or be []. Correct every diagnostic and return the complete replacement. If complete representation is impossible, return generated_mode: manual-only. If a Candidate Assessment is supplied, independently check every source obligation and adversarial counterexample before returning it or a corrected complete replacement; never return only a prose review.`;
  const repairTimeout = remainingTimeout();
  if (!repairTimeout) {
    draft.diagnostics.push('Automatic correction pass skipped because the total AI authoring deadline was reached.');
    return finalize(draft);
  }
  const repairUser = `${user}\n\nThe previous candidate was rejected by the local 0.4.1 validator. Diagnostics:\n${draft.diagnostics.slice(0, 30).join('\\n')}\n\nPrevious candidate (for correction only):\n${raw.slice(0, 30000)}`;
  try {
    const repairedRaw = await requestDraft([{ role: 'system', content: repairSystem }, { role: 'user', content: repairUser }], repairTimeout);
    const repaired = parseAiAssessmentResponse(pack, input, repairedRaw);
    if (repaired.diagnostics.length) repaired.diagnostics.unshift('The provider was given one automatic correction pass, but the replacement still requires author review.');
    return finalize(repaired);
  } catch (error) {
    draft.diagnostics.push(`Automatic correction pass failed: ${error instanceof Error ? error.message : String(error)}`);
    return finalize(draft);
  }
}
