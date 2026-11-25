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

export type AiAuthoringProgress =
  | 'sending-request'
  | 'waiting-provider'
  | 'received-response'
  | 'validating-response'
  | 'sending-correction'
  | 'waiting-correction'
  | 'received-correction'
  | 'validating-correction';

export interface AiAssessmentOptions {
  /** Persisted per-endpoint/model capability result from the extension host. */
  skipTools?: boolean;
  onToolsRejected?: () => void | Promise<void>;
  /** Optional local transport. The transport owns authentication and must return provider text only. */
  request?: (messages: OpenAiChatMessage[], timeoutMs: number, signal?: AbortSignal) => Promise<string>;
  /** Cancel an in-flight provider request without accepting partial output. */
  signal?: AbortSignal;
  /** The actual effort sent to Codex (automatic resolves to a concrete level first). */
  reasoningEffort?: string;
  /** Whether the actual effort was configured or selected by the local heuristic. */
  reasoningEffortSelection?: 'configured' | 'automatic';
  reasoningEffortReason?: string;
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
  /** Host/UI lifecycle callback; never serialized into the provider prompt. */
  progress?: (phase: AiAuthoringProgress) => void;
  /** Host cancellation signal; never serialized into the provider prompt. */
  signal?: AbortSignal;
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
  toolMode?: 'local-pinned-pack' | 'fallback-no-tools' | 'local-cli-readonly' | 'not-requested';
  toolWarning?: string;
  /** Codex per-request reasoning effort, when applicable. */
  reasoningEffort?: string;
  reasoningEffortSelection?: 'configured' | 'automatic';
  reasoningEffortReason?: string;
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
    ['linux.rpminfo', ['rpm package', 'yum', 'dnf', 'rpm -', 'rpm database']],
    ['windows.wuaupdatesearcher', ['patch', 'hotfix', 'windows update', 'update installed', 'kb']],
    ['windows.wmi.query', ['win32_operating_system', 'operating system version', 'powershell version', 'server version', 'os version', 'windows 2012', '2012 r2']]
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
  /** Omit broad reference material when the provider can inspect the pinned pack locally. */
  compact?: boolean;
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
      schemas[name] = { $id: value.$id, 'x-scap-ng-version': value['x-scap-ng-version'], required: value.required, properties: schemaSummary(value.properties, options.compact ? 1 : 0), defs: Object.fromEntries(names.filter(name => value.$defs[name]).map(name => [name, schemaSummary(value.$defs[name], options.compact ? 1 : 0)])) };
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
  const documentNames = options.compact
    ? ['SCAP-NG-PRIMER.md', 'ASSISTED-ASSESSMENT-DRAFTS.md', 'AI-AUTHORING-PLAYBOOK.md']
    : ['SCAP-NG-PRIMER.md', 'ASSISTED-ASSESSMENT-DRAFTS.md', 'P0-SCHEMA-GUIDED-AUTHORING.md', 'EDITOR-BLUEPRINT.md', 'SCAP-NG-YAML-ARCHITECTURE-REVIEW.md', 'SCHEMA-VERSION-MIGRATION-PLAN.md', 'AI-AUTHORING-PLAYBOOK.md'];
  const documents = Object.fromEntries(documentNames.map(name => [name, readKnowledgeDocument(extensionRoot, name, documentLimit)]).filter(([, value]) => value));
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
    ...(options.compact ? {} : { vocabulary }),
    editor_documents: documents,
    authoring_invariants: [
      'The pinned 0.4.1 JSON Schemas are normative; YAML must be a complete Assessment with specification.id scap-ng.pre-alpha.assessment and specification.version 0.4.1.',
      'A Test has capability, reported_elements, an Object (or approved Object reference), and structured require. Object selectors collect Items; require fields compare those Items.',
      'reported_elements is the scalar enum all or compared, or an array of explicit field names; do not serialize [all].',
      'Comparison require uses item_requirement.items_found/items_satisfying, then field_requirement.values_found/values_matching, then fields. Existence-only requires item_requirement.items_found only; do not add items_satisfying, field_requirement, or fields. For confirmed field absence, use fields.<name>.values_found: none and omit field_requirement entirely.',
      'Require logical and/or/one/xor children are inherited conditions: each child is {fields: {field_name: {one operator}}} or another logical group. Never repeat item_requirement inside a logical child; keep Item cardinality once on the enclosing require. Distinct field predicates are implicitly ANDed, while multiple operators on one field use an inherited logical group.',
      'Evaluate control flow is separate from Test require: use evaluate: {if: {test: gate-test}, then: {test: technical-test}, else: {not_applicable: {reason: population absent}}}. not_applicable is a leaf outcome with reason; never put if/then/else/and under not_applicable. Evaluate logical groups contain expression objects such as {test: id}, not bare IDs.',
      'Use only canonical Test requirement cardinalities: item items_found accepts none/exactly_one/one_or_more/zero_or_more; field values_found accepts none/exactly_one/one_or_more/every/zero_or_more; values_matching accepts none/exactly_one/one_or_more/every. Assessment Input declarations separately accept exactly_one, zero_or_one, one_or_more, or zero_or_more and require datatype, cardinality, and required. Do not emit OVAL spellings such as at_least_one.',
      'Do not invent numeric bounds that are absent from the procedure merely from a guessed implementation domain. Preserve every explicit bound exactly; if a value has an external implementation range, state it as an assumption/review item or use only the supplied schema/mapping evidence rather than silently adding a lower or upper bound.',
      'Do not collapse independent procedure checks merely to reduce Test count. If the procedure says a missing/unconfigured option on any member is a finding, retain the full parent population and require every member to satisfy the option predicate, or retain an explicit absence Test; a selector that matches only members containing the option cannot detect a mixed population where another member omits it.',
      'Before finalizing, perform an adversarial semantic review: identify the collected population and excluded members, then test omitted options, malformed values, negative or out-of-range values, duplicate directives, comments/inline comments, empty collections, and mixed compliant/noncompliant populations. A filter must not hide a member that the procedure says is a finding. When syntax or implementation validity is uncertain, do not silently accept it; state the assumption and preserve a finding/review condition.',
      "Regex escaping is layered: the outer JSON response escapes backslashes once, but the returned YAML scalar must contain the intended regex after YAML parsing. Prefer a single-quoted YAML regex scalar when backslashes are needed (for example, '^\\s*server'), and do not emit JSON-style double escaping into the YAML value. Verify the parsed regex semantics before returning.",
      'Object selectors are schema-authorized operator maps, not invented operation names: for linux.dpkginfo and linux.rpminfo use name: {equals: package} or name: {matches_regex: regex}; pattern_match is not a SCAP-NG operator. Use the exact selector names and operations in the relevant capability mapping.',
      "Never copy collected result/state fields into an Object selector. Use only the capability mapping's selector alternatives and the native-selector schema properties; if a recursive or dynamic population cannot be expressed with that exact Object shape, return manual-only rather than guessing unsupported directory/name/filesystem fields.",
      'An explicit HKEY_CURRENT_USER source is per-profile Windows user-hive data: use the pinned windows.ntuser capability, never windows.registry. For all logged-in profiles, serialize include_default: false and item_creation: every_ntuser unless the source explicitly requests a different population. The single-user windows.registry collector is not an equivalent substitute.',
      'independent.shellcommand always creates one Item so empty stdout is a field absence condition, never item_requirement.items_found: zero_or_more.',
      'Object.pattern filters shellcommand stdout before field requirements; retain the pattern there and use a schema-valid field predicate for the resulting stdout_line.',
      'Evaluate references Test IDs with expression objects such as {test: id}; it may branch to test, not_applicable, or not_evaluated. Do not use a bare ID.',
      'Rule-local applicability uses internal population Tests and Evaluate. External applicability Assessments are reused only when supplied by the Benchmark; never invent a dependency ID.',
      'If a procedure says Not Applicable when a population is absent, create a population gate Test and a separate technical Test when needed: if population then technical else not_applicable. Do not collapse the gate and technical failure into one not_evaluated branch.',
      'An ISSO/ISSM/SA/AO approval or deviation does not make a known technical violation unknown. Preserve the pass/fail Test and record an approved deviation after evaluation. Use not_evaluated only when the technical check cannot run or required evidence is unavailable.',
      'When a procedure depends on an organization-defined value or policy parameter, declare an Assessment inputs contract and consume an input reference; never hard-code the value or invent a default. The author does not need to know the organization-approved value: the organization supplies it through the policy-layer binding. Do not add a default value. Input names must end in -input and each declaration includes datatype, cardinality (exactly_one, zero_or_one, one_or_more, or zero_or_more), and required. The only optional declaration members are description and constraints; there is no default property and no implicit default. Required Inputs use required: true. A missing required Input is an execution error with reason code missing_organizational_input, not Not Applicable or a fabricated technical failure; invalid or unsupported bindings use their corresponding input reason codes. Optional Input consumers require a direct input_provided guard.',
      'Never emit an empty Object, placeholder predicate, invented capability, scanner PASS/FAIL, or runtime-proof claim. Return manual-only when the objective predicate or complete population cannot be represented.',
      'Preserve every path, wildcard, conf.d directory, set, and per-user relationship; do not silently reduce a population to one example file. For dynamic populations, use only the supplied capability-common and variable-expression schemas for file_traversal, set_expression, foreach, and Variable references; do not claim manual-only merely because a population is dynamic when the pinned schemas represent it.',
      'Treat generated output as review-only until the author verifies selectors, predicates, applicability, exceptions, and target-platform behavior.'
    ],
    current_authoring_examples: {
      basic_assessment: 'assessment: { id: example-assessment, version: 1, assessment_title: Check a file, mode: automated, class: compliance, tests: { example-test: { test_title: Check a file, capability: unix.file, object: { filepath: { equals: /etc/example } }, require: { item_requirement: { items_found: one_or_more } } } } }',
      comparison_require: 'reported_elements: all; require: { item_requirement: { items_found: one_or_more, items_satisfying: every }, field_requirement: { values_found: one_or_more, values_matching: every }, fields: { value: { equals: expected } } }',
      shellcommand_existence: 'capability: independent.shellcommand; object: { shell: bash, command: command, error_if_exit_status_not_0: false, error_if_stderr_exists: false }; require: { item_requirement: { items_found: one_or_more, items_satisfying: every }, fields: { stdout_line: { values_found: none } } }; reported_elements: all. For absence-only, omit field_requirement.',
      shellcommand_filtered_absence: 'For a filtered stdout absence check, put the regex in Object.pattern, keep shellcommand item_requirement.items_found: one_or_more because shellcommand always creates an Item, and use fields.stdout_line: { values_found: none }. Do not use item zero_or_more to model missing stdout.',
      applicability_boundary: 'For Rule-local conditions, use internal Tests plus evaluate if/then/else and not_applicable; use an external Assessment dependency only for a supplied reusable condition. A valid expression uses {test: sssd-active-test}, not a bare test ID.',
      internal_applicability: 'evaluate: {if: {test: service-active-test}, then: {if: {not: {test: excluded-provider-test}}, then: {test: protected-setting-test}, else: {not_applicable: {reason: excluded provider}}}, else: {not_applicable: {reason: service inactive}}}',
      applicability_gate_with_failure: 'When a population is N/A if absent but must fail when a violation exists: tests include population-present-test and technical-absence-test; evaluate: {if: {test: population-present-test}, then: {test: technical-absence-test}, else: {not_applicable: {reason: population absent}}}. An approval exception does not become not_evaluated.',
      manual_exception_branch: 'When the technical condition is automatable but an ISSO/owner exception cannot be verified, author the objective technical Test normally and let it produce its real pass/fail result. Do not convert a known failure into not_evaluated; an approved deviation is recorded after evaluation by the organization. Use not_evaluated only when the technical check itself cannot be performed or the required evidence is genuinely unavailable.',
      organizational_input: 'For an organization-approved value or policy parameter, declare an input such as organization-approved-value-input with datatype, cardinality, and required: true, then compare observed fields with {input: organization-approved-value-input}; do not put the actual organization value in the Assessment. The Rule/Benchmark supplies the organization binding. Missing required input is runtime error missing_organizational_input.'
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
  // A command wildcard (for example Get-ADUser -Filter *) is not a filesystem
  // population. Require path-shaped wildcard evidence before demanding a path
  // coverage manifest; retain the explicit prose/set signals as before.
  // Command switches such as AuditPol /category:* are not paths.
  return /(?:^|[\s\"'=:(])(?:[A-Za-z]:[\/\\][^\s]*\*|\/(?:[A-Za-z0-9_.-]+[\/\\])+[^\s]*\*)/i.test(text)
    || /\*[^ \n/\\]*\.(?:conf|cfg|ini|log|txt|yaml|yml|json|xml|key|crt|pem|p12|pfx)\b/i.test(text)
    || /\[[^\]]+\]|\bconf\.d\b|\bfor each\b|\ball files?\b|\bany files?\b/i.test(text);
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

function expressionHasTestReference(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Object.hasOwn(value, 'test')) return true;
  return Object.values(value as Record<string, unknown>).some(expressionHasTestReference);
}

function hasExternalApplicability(value: any): boolean {
  const assessment = value?.assessment;
  if (assessment?.applicability) return true;
  return Object.values(assessment?.dependencies ?? {}).some((dependency: any) => dependency?.purpose === 'applicability');
}

function procedureHasHumanException(text: string): boolean {
  return /\b(?:ISSO|ISSM|SA|AO|authorizing official|system owner|security administrator)\b|documented (?:exception|approval)|approved (?:exception|use)/i.test(text);
}

/**
 * Some procedures explicitly permit materially different notification channels
 * (for example email, a monitoring trap, or local/hardware indications). An
 * email-only candidate is not complete just because it has a valid Input and
 * compiles against the Assessment schema. Without a user-selected policy
 * branch, keep this source obligation in human review rather than silently
 * narrowing it to the first example in the procedure.
 */
function explicitObjectivePrompt(text: string): string {
  if (/(?:Registry\s+Hive|Registry\s+Path|Value\s+Name)[\s\S]{0,600}\bValue\s*:/i.test(text)) {
    return 'MANDATORY SOURCE DECISION: This procedure contains a concrete labeled registry Hive/Path/Value Name/Value predicate. It is technically representable with the mapped registry capability (and windows.ntuser for explicit HKCU). Return an automated Test using the supplied literal. A human exception, ISSO documentation, or post-evaluation approval is not a reason for manual-only; keep that as unresolved review text. Do not add an Assessment Input for the fixed literal. If the same procedure also names an exact prerequisite version, patch, update, or software condition, preserve it as a separate conditional Test when a pinned native capability or an explicit supported command can query it; do not downgrade the concrete registry Test to manual-only merely because the prerequisite requires branching.';
  }
  if (/(?:Get-CimInstance|Get-ADUser|AuditPol|w32tm)\b[\s\S]{0,600}(?:finding|must|verify|returned)/i.test(text)) {
    return 'MANDATORY SOURCE DECISION: This procedure contains an explicit command and objective finding predicate. Preserve that technical Test; a human review or exception step alone is not a reason for manual-only. When an executable query enumerates the target population and returns only violating records, represent a nonempty result as a finding and require no violating records. Do not infer an organization-defined population gap from a later GUI, sample-account, or default-container instruction when the authoritative command itself has no explicit scope restriction; treat that alternate procedure as corroborating review text. Require an organizational population Input only when the command explicitly requires a SearchBase/OU/domain or the source names a separate population that the command does not cover. Return manual-only only if the command output predicate or required population relationship is genuinely unrepresentable.';
  }
  return '';
}

function procedureHasAlternativeNotification(text: string): boolean {
  return /\b(?:email|mail)\b[\s\S]{0,220}\b(?:and\/or|or)\b[\s\S]{0,220}\b(?:monitoring system trap|trap|local (?:computer )?console|hardware indication|lights?)\b/i.test(text)
    || /\b(?:monitoring system trap|local (?:computer )?console|hardware indication|lights?)\b[\s\S]{0,220}\b(?:and\/or|or)\b[\s\S]{0,220}\b(?:email|mail)\b/i.test(text);
}

function assessmentRepresentsAlternativeNotification(value: any): boolean {
  const serialized = JSON.stringify(value?.assessment ?? {}).toLowerCase();
  return /\b(?:trap|snmp|monitoring[ _-]+system)\b/.test(serialized)
    && /\b(?:console|hardware|light|local[ _-]+indication)\b/.test(serialized);
}

/**
 * A provider must not silently turn a source procedure's unknown policy value
 * into a fully automated Assessment.  This is a source-obligation guard, not
 * a blanket ban on converting manual Rules: a valid Assessment Input can make
 * an otherwise objective check organizational-input automation.
 */
function procedureNeedsOrganizationalInput(input: AiAssessmentInput): boolean {
  const text = `${input.checkText}\n${input.ruleYaml ?? ''}`;
  // Converted STIG discussions retain XML metadata such as <VulnDiscussion>.
  // Those tags are transport markup, not authoring placeholders. Only treat an
  // angle-bracket token as a placeholder when its name explicitly describes an
  // organization/site/policy value, and never match closing XML tags.
  const explicitPlaceholder = /<(?!\/)(?:organization|org|site|customer|deployment|policy|approved|authorized)[^>]*>/i;
  const proseRequirement = /\b(?:organization(?:[-_ ](?:defined|approved)|al)|org[-_ ]approved|policy[-_ ](?:defined|approved)|(?:site|deployment|customer)[-_ ]specific|authorized\s+(?:source|value|setting|parameter|path|endpoint|account|service|channel)|(?:approved|permitted)\s+(?:value|source|setting|parameter|path|endpoint|account|service|channel)|(?:user|administrator)[-_ ]provided\s+(?:value|input))\b/i;
  return explicitPlaceholder.test(text) || proseRequirement.test(text);
}

function assessmentInputReferences(value: any): Set<string> {
  const references = new Set<string>();
  const visit = (node: any): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (typeof node.input === 'string') references.add(node.input);
    if (typeof node.input_provided === 'string') references.add(node.input_provided);
    Object.values(node).forEach(visit);
  };
  visit(value?.assessment);
  return references;
}

function procedureContainsConcreteRegistryValue(text: string): boolean {
  return /(?:^|\n)\s*Value\s*:\s*(?:0x[0-9a-f]+|-?\d+(?:\.\d+)?|enabled|disabled|true|false|yes|no|on|off)\s*(?:\([^\n]*\))?\s*$/im.test(text);
}
function concreteRegistryInputDiagnostics(input: AiAssessmentInput, value: any): string[] {
  if (!procedureContainsConcreteRegistryValue(input.checkText)) return [];
  const inputs = value?.assessment?.inputs;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || !Object.keys(inputs).length) return [];
  const references = assessmentInputReferences(value);
  const referenced = [...references].filter(name => Object.hasOwn(inputs, name));
  if (!referenced.length) return [];
  return [`The procedure supplies a concrete registry Value literal, but the candidate replaces it with Assessment Input(s): ${referenced.join(', ')}. Serialize the source literal directly; Inputs are only for explicitly unknown organization/site-defined values.`];
}

function organizationalInputDiagnostics(input: AiAssessmentInput, value: any): string[] {
  if (!procedureNeedsOrganizationalInput(input)) return [];
  const inputs = value?.assessment?.inputs;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || !Object.keys(inputs).length) {
    return ['The source procedure contains an organization-defined or placeholder value, but the automated draft declares no Assessment Input. It cannot be treated as fully automated; declare a required organizational input or return manual-only.'];
  }
  const references = assessmentInputReferences(value);
  const unconsumed = Object.keys(inputs).filter(name => !references.has(name));
  if (unconsumed.length) return [`The source procedure contains an organization-defined or placeholder value, but these Assessment Inputs are not consumed by any predicate or applicability expression: ${unconsumed.join(', ')}.`];
  return [];
}

function queryFindingStateDiagnostics(input: AiAssessmentInput, value: any): string[] {
  // A common provider error is to query only noncompliant records and then
  // require those same records to have the compliant value. This is a generic
  // query/result inversion, not a Rule-specific Windows fix. Reject it so the
  // correction pass must either require an empty finding-state result or query
  // the full eligible population and assert compliance for every member.
  const sourceMentionsFindingOutput = /\b(?:returned|output|result(?:s)?|records?)\b[\s\S]{0,220}\b(?:finding|violation|non[- ]?compliant)\b/i.test(input.checkText);
  if (!sourceMentionsFindingOutput) return [];
  const diagnostics: string[] = [];
  for (const [testId, test] of Object.entries(value?.assessment?.tests ?? {}) as Array<[string, any]>) {
    const query = typeof test?.object?.query === 'string' ? test.object.query : '';
    if (!query || !/\b(?:where|filter)\b/i.test(query)) continue;
    for (const match of query.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(true|false)\b/gi)) {
      const field = match[1];
      const selected = match[2].toLowerCase();
      if (selected !== 'false') continue;
      const predicate = test?.require?.fields?.[field.toLowerCase()] ?? test?.require?.fields?.[field] ?? test?.require?.fields?.[Object.keys(test?.require?.fields ?? {}).find(name => name.toLowerCase() === field.toLowerCase()) ?? ''];
      if (predicate && (predicate.equals === true || predicate.equals === 'true')) {
        diagnostics.push(`Test ${testId} filters query results to ${field}=False but requires ${field}=True; this inverts a finding-state query. Require no returned finding records or query the eligible population and require the compliant value for every member.`);
      }
    }
  }
  return diagnostics;
}

function currentUserCapabilityDiagnostics(input: AiAssessmentInput, value: any): string[] {
  if (!/\b(?:HKEY_CURRENT_USER|HKCU)\b/i.test(input.checkText)) return [];
  const violations: string[] = [];
  for (const [testId, test] of Object.entries(value?.assessment?.tests ?? {}) as Array<[string, any]>) {
    if (test?.capability === 'windows.registry') violations.push(testId);
  }
  return violations.length
    ? [`The source explicitly selects HKEY_CURRENT_USER, but Test${violations.length === 1 ? '' : 's'} ${violations.join(', ')} use windows.registry. Use windows.ntuser with include_default: false and item_creation: every_ntuser so all logged-in user profiles are collected.`]
    : [];
}

function coverageStepOutOfScope(input: AiAssessmentInput, summary: string): boolean {
  const platform = String(input.platform ?? '').toLowerCase();
  const text = summary.toLowerCase();
  // A source OCIL questionnaire/manual alternative is provenance and review
  // guidance, not an executable obligation of an automated Assessment. It is
  // intentionally not required in the automation coverage manifest when the
  // objective technical Test is represented. This applies generically to all
  // content; it is not a Rule-specific exemption.
  if (/\b(?:ocil|manual questionnaire|manual alternative)\b/.test(text)) return true;
  // An explicit Benchmark role is part of the authoring context. A procedure
  // may still include the alternate Domain Controller branch; that branch is
  // intentionally not an uncovered obligation for a Member Server target.
  // This is generic role-based coverage resolution, not Rule-specific content.
  return platform === 'windows_server_2012_member_server'
    && /\bdomain controllers?\b|\bactive directory\b|\bget-aduser\b/.test(text)
    && !/\bmember servers?\b|\bstandalone systems?\b|\blocal accounts?\b/.test(text);
}

function coverageDiagnostics(input: AiAssessmentInput, payload: any, value: any): string[] {
  const coverage = normalizeCoverage(payload?.coverage);
  if (!coverage) return ['AI response omitted the required procedure coverage manifest; no draft was accepted.'];
  const diagnostics: string[] = [];
  diagnostics.push(...organizationalInputDiagnostics(input, value));
  diagnostics.push(...concreteRegistryInputDiagnostics(input, value));
  diagnostics.push(...currentUserCapabilityDiagnostics(input, value));
  diagnostics.push(...queryFindingStateDiagnostics(input, value));
  if (procedureNeedsApplicability(input.checkText) && coverage.applicability !== 'implemented') diagnostics.push('The procedure contains a Not Applicable/conditional branch, but the AI did not implement that branch in Assessment logic.');
  if (procedureNeedsApplicability(input.checkText) && !expressionHasNotApplicable(value?.assessment?.evaluate) && !hasExternalApplicability(value)) diagnostics.push('Applicability is not represented. Use an internal evaluate branch with not_applicable for a Rule-local gate, or an explicit reusable applicability Assessment dependency.');
  const uncoveredSteps = coverage.procedureSteps.filter(step => !step.represented && !coverageStepOutOfScope(input, step.summary));
  if (uncoveredSteps.length) diagnostics.push('The AI coverage manifest identifies one or more procedure steps that are not represented; partial automation is not linkable.');
  const authoredTestIds = new Set(Object.keys(value?.assessment?.tests ?? {}));
  for (const step of coverage.procedureSteps) {
    const unknownTests = (step.tests ?? []).filter(testId => !authoredTestIds.has(testId));
    if (step.represented && unknownTests.length) diagnostics.push(`Coverage step '${step.summary}' references Test IDs not present in the Assessment: ${unknownTests.join(', ')}.`);
  }
  if (procedureHasPathSet(input.checkText) && (!coverage.pathPatterns.length || coverage.pathPatterns.some(path => !path.represented))) diagnostics.push('The procedure names a path set, wildcard, or multiple files, but the AI did not represent the complete population.');
  if (!coverage.procedureSteps.length) diagnostics.push('The AI coverage manifest contains no procedure steps.');
  const unresolvedCritical = list(payload?.unresolved_questions).filter(item => /applicability|not applicable|partial|wildcard|additional file|path set|cannot be represented|not represent|not managed/i.test(item));
  if (unresolvedCritical.length && !expressionHasNotEvaluated(value?.assessment?.evaluate)) diagnostics.push('The AI reports unresolved semantic coverage gaps; represent the technical check completely or return manual-only.');
  // A technical branch may legitimately use not_evaluated when command evidence
  // is unavailable or an unexpected state is observed. Reject it only when the
  // candidate has no technical Test reference at all, which indicates that the
  // provider converted an ISSO/owner decision into a non-evaluated outcome.
  if (procedureHasHumanException(input.checkText)
    && expressionHasNotEvaluated(value?.assessment?.evaluate)
    && !expressionHasTestReference(value?.assessment?.evaluate)) {
    diagnostics.push('A known technical failure must remain a pass/fail Test. Do not use not_evaluated for an ISSO/owner deviation; record the approved deviation after evaluation.');
  }
  if (procedureHasAlternativeNotification(input.checkText) && !assessmentRepresentsAlternativeNotification(value)) diagnostics.push('The source procedure explicitly permits multiple notification channels (such as email, monitoring traps, and local or hardware indications), but the candidate models only a narrower channel. Do not silently narrow the source obligation; model the supported alternatives or return manual-only for human policy selection.');
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

function schemaSafeTestId(raw: string, used: Set<string>): string {
  // Assessment Test map keys and expression references share the canonical
  // schema's lowercase-kebab `*-test` contract (max 64 characters). Providers
  // occasionally derive IDs from long titles or source prose. Normalize only
  // that identifier syntax; never alter selectors, predicates, or Test content.
  const base = raw.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .replace(/-test$/, '') || 'generated';
  const suffix = '-test';
  const maxBaseLength = 64 - suffix.length;
  let candidate = `${base.slice(0, maxBaseLength).replace(/-+$/, '')}${suffix}`;
  let ordinal = 2;
  while (used.has(candidate)) {
    const marker = `-${ordinal}`;
    const available = maxBaseLength - marker.length;
    candidate = `${base.slice(0, available).replace(/-+$/, '')}${marker}${suffix}`;
    ordinal++;
  }
  used.add(candidate);
  return candidate;
}

function normalizeProviderTestIds(value: any, payload: any): { value: any; payload: any; yamlChanged: boolean; note?: string } {
  const tests = value?.assessment?.tests;
  if (!tests || typeof tests !== 'object' || Array.isArray(tests)) return { value, payload, yamlChanged: false };
  const used = new Set<string>();
  const replacements = new Map<string, string>();
  const nextTests: Record<string, any> = {};
  let changed = false;
  for (const [testId, test] of Object.entries(tests) as Array<[string, any]>) {
    const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*-test$/.test(testId) && testId.length <= 64;
    const nextId = valid && !used.has(testId) ? testId : schemaSafeTestId(testId, used);
    if (nextId !== testId) { replacements.set(testId, nextId); changed = true; }
    else used.add(nextId);
    nextTests[nextId] = test;
  }
  if (!changed) return { value, payload, yamlChanged: false };
  const rewriteReferences = (node: any, parentKey = ''): any => {
    if (Array.isArray(node)) {
      return node.map(item => parentKey === 'tests' && typeof item === 'string' ? replacements.get(item) ?? item : rewriteReferences(item, parentKey));
    }
    if (!node || typeof node !== 'object') return node;
    const rewritten = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, rewriteReferences(child, key)]));
    if (typeof rewritten.test === 'string' && replacements.has(rewritten.test)) rewritten.test = replacements.get(rewritten.test);
    return rewritten;
  };
  const nextAssessment = rewriteReferences({ ...value.assessment, tests: nextTests });
  const nextPayload = rewriteReferences(payload);
  const renamed = [...replacements.entries()].map(([from, to]) => `${from} → ${to}`).join(', ');
  return {
    value: { ...value, assessment: nextAssessment },
    payload: nextPayload,
    yamlChanged: true,
    note: `Normalized provider Test ID${replacements.size === 1 ? '' : 's'} to the pinned lowercase kebab-case, -test, 64-character contract (${renamed}).`
  };
}

function normalizeProviderAssessmentEnvelope(value: any): { value: any; yamlChanged: boolean; note?: string } {
  // Some OpenAI-compatible models serialize the canonical Assessment metadata
  // beside the `assessment` document instead of inside it. This is a generic
  // provider-envelope mistake, not content-specific repair: move only the
  // known `specification` member when the nested Assessment lacks it, preserve
  // its exact value, and leave every other unexpected root member for the
  // pinned schema validator to reject.
  const assessment = value?.assessment;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !assessment || typeof assessment !== 'object' || Array.isArray(assessment)) return { value, yamlChanged: false };
  if (!Object.hasOwn(value, 'specification') || Object.hasOwn(assessment, 'specification')) return { value, yamlChanged: false };
  const rawSpecification = value.specification;
  let specification = rawSpecification;
  let scalarNote = '';
  if (typeof rawSpecification === 'string') {
    // A few models compress the canonical pair as `id/version`. Only accept
    // this unambiguous envelope shorthand; malformed or unrelated scalars
    // remain validator errors rather than being guessed or repaired.
    const separator = rawSpecification.indexOf('/');
    const id = separator > 0 ? rawSpecification.slice(0, separator).trim() : '';
    const version = separator > 0 ? rawSpecification.slice(separator + 1).trim() : '';
    if (!id || !version || version.includes('/')) return { value, yamlChanged: false };
    specification = { id, version };
    scalarNote = ' Converted the provider shorthand `specification: id/version` to the canonical object form.';
  } else if (!rawSpecification || typeof rawSpecification !== 'object' || Array.isArray(rawSpecification)) return { value, yamlChanged: false };
  const next = { ...value, assessment: { ...assessment, specification } };
  delete next.specification;
  return { value: next, yamlChanged: true, note: `The provider placed the Assessment specification beside the document root; normalized it into assessment.specification before pinned-schema validation.${scalarNote}` };
}

function normalizeProviderReportedElements(value: any): { value: any; yamlChanged: boolean; note?: string } {
  const tests = value?.assessment?.tests;
  if (!tests || typeof tests !== 'object' || Array.isArray(tests)) return { value, yamlChanged: false };
  const changed: string[] = [];
  const nextTests: Record<string, any> = { ...tests };
  for (const [testId, test] of Object.entries(tests) as Array<[string, any]>) {
    if (!test || typeof test !== 'object' || !Array.isArray(test.reported_elements) || test.reported_elements.length !== 1) continue;
    const token = test.reported_elements[0];
    // The canonical schema permits scalar `all`/`compared`; some providers
    // mechanically turn the enum into `[all]`/`[compared]`. This is an
    // unambiguous shape correction and does not invent a field selection.
    if (token !== 'all' && token !== 'compared') continue;
    nextTests[testId] = { ...test, reported_elements: token };
    changed.push(testId);
  }
  if (!changed.length) return { value, yamlChanged: false };
  return {
    value: { ...value, assessment: { ...value.assessment, tests: nextTests } },
    yamlChanged: true,
    note: `Normalized scalar reported_elements enum(s) accidentally returned as one-item arrays for ${changed.length} Test${changed.length === 1 ? '' : 's'} before pinned-schema validation.`
  };
}

function normalizeProviderAutomatedMetadata(value: any): { value: any; yamlChanged: boolean; note?: string } {
  const assessment = value?.assessment;
  if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment) || assessment.mode !== 'automated') {
    return { value, yamlChanged: false };
  }
  // The automated Assessment contract intentionally excludes manual OCIL
  // response/procedure metadata. Providers sometimes copy the source manual
  // Assessment into an otherwise usable automated candidate, which triggers
  // the schema's fail-closed mode guard and needlessly sends the job to retry.
  // The immutable source procedure is already retained in the generation input
  // and review UI; remove only these contract-forbidden metadata keys. Never
  // synthesize or rewrite Tests, Objects, predicates, or Evaluate semantics.
  const forbidden = ['procedure', 'response', 'references', 'evidence_guidance'] as const;
  const removed = forbidden.filter(key => Object.hasOwn(assessment, key));
  if (!removed.length) return { value, yamlChanged: false };
  const nextAssessment = { ...assessment };
  for (const key of removed) delete nextAssessment[key];
  return {
    value: { ...value, assessment: nextAssessment },
    yamlChanged: true,
    note: `Removed manual-only Assessment metadata (${removed.join(', ')}) from the automated candidate before pinned-schema validation; source procedure and provenance remain in the review input.`
  };
}

function normalizeProviderAssessmentInputs(value: any): { value: any; yamlChanged: boolean; note?: string } {
  const inputs = value?.assessment?.inputs;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return { value, yamlChanged: false };
  const names = Object.keys(inputs);
  const renames = new Map<string, string>();
  const used = new Set<string>();
  for (const original of names) {
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*-input$/.test(original)) { used.add(original); continue; }
    let normalized = original.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-');
    if (!normalized) normalized = 'organization';
    if (!normalized.endsWith('-input')) normalized += '-input';
    const base = normalized;
    let suffix = 2;
    while (used.has(normalized)) normalized = `${base.replace(/-input$/, '')}-${suffix++}-input`;
    used.add(normalized);
    renames.set(original, normalized);
  }
  if (!renames.size) return { value, yamlChanged: false };
  const nextInputs: Record<string, unknown> = {};
  for (const [original, definition] of Object.entries(inputs)) nextInputs[renames.get(original) ?? original] = definition;
  const visit = (node: any): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    for (const key of ['input', 'input_provided']) {
      if (typeof node[key] === 'string' && renames.has(node[key])) node[key] = renames.get(node[key]);
    }
    Object.values(node).forEach(visit);
  };
  value.assessment.inputs = nextInputs;
  visit(value.assessment);
  const changes = [...renames.entries()].map(([from, to]) => `'${from}' → '${to}'`).join(', ');
  return { value, yamlChanged: true, note: `The provider used Assessment Input name(s) that do not satisfy the pinned 0.4.1 input-name pattern; normalized ${changes} and updated their references.` };
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

function editorProvenance(extensionRoot: string): { version: string; build: string } {
  let version = 'unknown';
  let build = 'unknown';
  try {
    const packageJson = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'));
    if (typeof packageJson?.version === 'string' && packageJson.version.trim()) version = packageJson.version.trim();
  } catch { /* Tests and external callers may not provide an extension root. */ }
  try {
    const buildJson = JSON.parse(readFileSync(join(extensionRoot, 'dist', 'build-info.json'), 'utf8'));
    if (typeof buildJson?.buildId === 'string' && buildJson.buildId.trim()) build = buildJson.buildId.trim();
  } catch { /* A source checkout can still identify the extension version. */ }
  return { version, build };
}

function provenanceComment(pack: MetadataPack, extensionRoot: string, endpoint: string, model: string, generatedAt: string, toolMode: 'local-pinned-pack' | 'fallback-no-tools' | 'local-cli-readonly' | 'not-requested', durationMs: number, reasoningEffort?: string, reasoningEffortSelection?: 'configured' | 'automatic', reasoningEffortReason?: string): string {
  const editor = editorProvenance(extensionRoot);
  return [
    '# SCAP-NG editor provenance:',
    '#   generation_method: configured-ai',
    `#   provider_endpoint: ${providerLabel(endpoint)}`,
    `#   model: ${model.replace(/[\r\n]+/g, ' ')}`,
    `#   editor_version: ${editor.version}`,
    `#   editor_build: ${editor.build}`,
    ...(reasoningEffort ? [`#   reasoning_effort: ${reasoningEffort.replace(/[\r\n]+/g, ' ')}`] : []),
    ...(reasoningEffortSelection ? [`#   reasoning_effort_selection: ${reasoningEffortSelection}`] : []),
    ...(reasoningEffortReason ? [`#   reasoning_effort_reason: ${reasoningEffortReason.replace(/[\r\n]+/g, ' ')}`] : []),
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

function withProviderProvenance(pack: MetadataPack, extensionRoot: string, endpoint: string, model: string, draft: AiAssessmentDraft, toolMode: 'local-pinned-pack' | 'fallback-no-tools' | 'local-cli-readonly' | 'not-requested', toolWarning?: string, durationMs = 0, reasoningEffort?: string, reasoningEffortSelection?: 'configured' | 'automatic', reasoningEffortReason?: string): AiAssessmentDraft {
  const generatedAt = new Date().toISOString();
  return {
    ...draft,
    provider: providerLabel(endpoint),
    model,
    generatedAt,
    toolMode,
    toolWarning,
    reasoningEffort,
    reasoningEffortSelection,
    reasoningEffortReason,
    durationMs,
    yaml: draft.yaml ? provenanceComment(pack, extensionRoot, endpoint, model, generatedAt, toolMode, durationMs, reasoningEffort, reasoningEffortSelection, reasoningEffortReason) + draft.yaml : draft.yaml
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
  if (generated.mode === 'manual-only') {
    // A provider may over-apply a human exception and stop at manual-only even
    // though the source contains a concrete, mapped objective predicate. Give
    // it the same bounded correction opportunity as malformed YAML. This is a
    // generic source-shape challenge, not an offline Rule-specific replacement.
    const objective = explicitObjectivePrompt(input.checkText);
    const diagnostics = objective
      ? ['The provider returned manual-only despite a concrete objective collector/predicate in the source; preserve the technical Test and keep any human exception in unresolved_questions.']
      : [];
    return { generatedMode: 'manual-only', automationClass: 'manual', confidence, yaml: '', diagnostics, document: undefined, assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
  }
  if (generated.mode !== 'automated') return draftFromFailure('The AI response did not declare generated_mode as automated or manual-only.', assumptions);
  let yamlText = providerAssessmentYaml(payload);
  if (!yamlText) return draftFromFailure('The AI response did not contain assessment_yaml.', assumptions);
  const document = parseDocument(yamlText, { uniqueKeys: true });
  if (document.errors.length) return { generatedMode: 'automated', confidence: 'low', yaml: yamlText, diagnostics: document.errors.map(error => error.message), assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
  let value: any;
  try { value = document.toJS({ maxAliasCount: 50 }); } catch (error) { return { generatedMode: 'automated', confidence: 'low', yaml: yamlText, diagnostics: [error instanceof Error ? error.message : String(error)], assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' }; }
  const testIds = normalizeProviderTestIds(value, payload);
  if (testIds.yamlChanged) {
    value = testIds.value;
    payload = testIds.payload;
    yamlText = stringify(value);
  }
  const envelope = normalizeProviderAssessmentEnvelope(value);
  if (envelope.yamlChanged) {
    value = envelope.value;
    yamlText = stringify(value);
  }
  const identity = normalizeProviderAssessmentIdentity(value, input);
  if (identity.yamlChanged) {
    value = identity.value;
    yamlText = stringify(value);
  }
  const normalizedInputs = normalizeProviderAssessmentInputs(value);
  if (normalizedInputs.yamlChanged) {
    value = normalizedInputs.value;
    yamlText = stringify(value);
  }
  const normalizedAutomatedMetadata = normalizeProviderAutomatedMetadata(value);
  if (normalizedAutomatedMetadata.yamlChanged) {
    value = normalizedAutomatedMetadata.value;
    yamlText = stringify(value);
  }
  const normalizedReportedElements = normalizeProviderReportedElements(value);
  if (normalizedReportedElements.yamlChanged) {
    value = normalizedReportedElements.value;
    yamlText = stringify(value);
  }
  const schemaUri = pack.manifest.resources.find((item: any) => item.kind === 'schema' && item.uri.endsWith('/assessment.schema.json'))?.uri;
  const diagnostics = schemaUri ? schemaValidationDiagnostics(pack, schemaUri, value) : ['Pinned Assessment schema is unavailable.'];
  const semanticDiagnostics = coverageDiagnostics(input, payload, value);
  if (diagnostics.length) return { generatedMode: 'automated', confidence: 'low', yaml: yamlText, diagnostics: [...diagnostics, ...semanticDiagnostics], assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
  if (value?.assessment?.mode !== 'automated') diagnostics.push('AI draft must contain assessment.mode: automated.');
  if (envelope.note) assumptions.push(envelope.note);
  if (identity.note) assumptions.push(identity.note);
  if (testIds.note) assumptions.push(testIds.note);
  if (normalizedInputs.note) assumptions.push(normalizedInputs.note);
  if (normalizedAutomatedMetadata.note) assumptions.push(normalizedAutomatedMetadata.note);
  if (normalizedReportedElements.note) assumptions.push(normalizedReportedElements.note);
  if (!value?.assessment?.id || value.assessment.id !== input.ruleId.replace(/-rule$/, '-assessment')) assumptions.push('Review the generated Assessment ID and its Rule linkage before saving.');
  diagnostics.push(...semanticDiagnostics);
  const effectiveConfidence = diagnostics.length ? 'low' : confidence;
  return { generatedMode: 'automated', automationClass: automationClassForAssessment(value, 'automated'), confidence: effectiveConfidence, yaml: yamlText, document: value, diagnostics, assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
}

// Codex high-effort requests can take several minutes. Reserve a 240-second
// total deadline for the provider's required correction pass instead of
// returning the first invalid candidate at the deadline.
export const AI_REQUEST_TOTAL_TIMEOUT_MS = 240_000;

export async function createAiAssessmentDraft(pack: MetadataPack, extensionRoot: string, endpoint: string, apiKey: string, model: string, input: AiAssessmentInput, options: AiAssessmentOptions = {}): Promise<AiAssessmentDraft> {
  const startedAt = Date.now();
  const deadline = startedAt + AI_REQUEST_TOTAL_TIMEOUT_MS;
  const profileKey = toolProfileKey(endpoint, model);
  const previouslyRejectedTools = options?.skipTools === true || unsupportedToolProfiles.has(profileKey);
  let useTools = modelUsesPinnedTools(model) && !previouslyRejectedTools;
  let toolMode: 'local-pinned-pack' | 'fallback-no-tools' | 'local-cli-readonly' | 'not-requested' = endpoint === 'codex-local' ? 'local-cli-readonly' : useTools ? 'local-pinned-pack' : previouslyRejectedTools ? 'fallback-no-tools' : 'not-requested';
  let toolWarning: string | undefined = previouslyRejectedTools ? 'The gateway previously rejected tools for this endpoint/model during this VS Code session; skipped the failed tools negotiation.' : undefined;
  const finalize = (draft: AiAssessmentDraft) => withProviderProvenance(pack, extensionRoot, endpoint, model, draft, toolMode, toolWarning, Date.now() - startedAt, options.reasoningEffort, options.reasoningEffortSelection, options.reasoningEffortReason);
  const remainingTimeout = () => Math.max(0, deadline - Date.now());
  // Bound user-controlled source before constructing a provider request. This
  // protects the authoring host and makes the exact outbound scope predictable.
  if (input.checkText.length > 60000) return finalize(draftFromFailure('The procedure text is larger than the AI authoring limit (60,000 characters); use a focused excerpt or the offline workflow.'));
  if ((input.ruleYaml?.length ?? 0) > 50000) return finalize(draftFromFailure('The Rule YAML is larger than the AI authoring limit (50,000 characters); remove unrelated context or use the offline workflow.'));
  if (input.title.length > 4000 || input.ruleId.length > 1000) return finalize(draftFromFailure('The Rule identity/title exceeds the AI authoring limit; shorten it before retrying.'));
  // Keep the full pinned context for high-effort Codex requests: the extra schema
  // detail improves difficult semantic repairs. Compact context is reserved for
  // explicitly lower-effort local runs where latency is the primary concern.
  const compactCodexContext = endpoint === 'codex-local' && options.reasoningEffort !== 'high' && options.reasoningEffort !== 'xhigh' && options.reasoningEffort !== 'max';
  const knowledge = buildScapNgKnowledge(pack, extensionRoot, { platform: input.platform, checkText: input.checkText, maxDocumentChars: compactCodexContext ? 3600 : 4500, compact: compactCodexContext });
  const localCodexTools = endpoint === 'codex-local'
    ? `You are running through the local Codex CLI with read-only tools available. The prompt contains a compact extract of the pinned pack. Before drafting the Assessment, make at most two targeted read-only tool calls against authoritative files under ${pack.directory} (inspect schemas/assessment.schema.json and the one or two relevant capability mappings); do not scan the directory broadly or inspect unrelated documents. Use those results only to verify field names and requirement shape. Do not modify files. Tool availability is not proof of scanner/runtime execution; report only authoring validation.`
    : '';
  const system = `${localCodexTools}
You are a SCAP-NG 0.4.1 assessment-authoring specialist, not a generic novice assistant. Use ONLY the canonical knowledge pack below as the normative contract. Apply the included AI-AUTHORING-PLAYBOOK.md procedure method; it contains generic authoring reasoning, not hard-coded content. The schema and capability mappings are authoritative; do not invent fields, capabilities, operators, result semantics, applicability semantics, or scanner behavior. Do not invent numeric bounds absent from the procedure; preserve explicit inequalities and flag external implementation-range assumptions for review. A named prerequisite patch, update, software package, or version condition is not inherently manual: when exact identifiers are supplied and a pinned native capability or explicit supported command can query them, represent the prerequisite with separate Tests and the source's conditional Evaluate logic. Preserve the distinction between version branches (for example, patch required only for one version) and an unconditional OR; return manual-only only when the exact prerequisite cannot be collected or represented safely. Do not collapse independent procedure checks merely to reduce Test count: a pattern that selects only lines containing an option cannot detect another line that omits it; preserve a full-population predicate or explicit absence Test. Conversely, do not add a separate syntax/population Test solely to restate the selector or support another Test when the same selector already covers the source obligation; use one Test per independently stated objective unless an additional Test is required to prevent a finding from being hidden. Before finalizing, perform an adversarial semantic review: test omitted options, malformed values, negative or out-of-range values, duplicate directives, comments/inline comments, empty collections, and mixed compliant/noncompliant populations; a filter must not hide a member that the procedure says is a finding. When syntax or implementation validity is uncertain, state the assumption and preserve a finding/review condition. Regex escaping is layered: the outer JSON response escapes backslashes once, but the returned YAML scalar must contain the intended regex after YAML parsing; prefer a single-quoted YAML regex scalar when backslashes are needed and do not emit JSON-style double escaping into the YAML value. Verify the parsed regex semantics before returning. Prefer an existing mapped capability over a new one. Preserve the objective technical check and its real pass/fail result even when the procedure mentions an ISSO/ISSM/SA/AO exception; a human exception or documentation path alone is never a reason to return manual-only. This is a mandatory decision boundary: when a procedure contains a concrete registry Hive/Path/Name/Type/Value or another objective collector/predicate plus a human exception, return the objective automated Test and put the exception only in unresolved_questions; do not return manual-only. Approved deviations are recorded after evaluation and must not be represented as not_evaluated. When a procedure requires an organization-defined value or policy parameter, declare a typed Assessment input and consume it through an input reference instead of hard-coding a value or inventing a default. In a field predicate, serialize the reference as an operator operand plus a sibling value_match cardinality, for example fields: {subexpression: {equals: {input: organization-approved-value-input}, value_match: one_or_more}}; value_match is not field_requirement.values_matching. The unknown organization-approved value is not a reason for manual-only; the policy-layer binding supplies it later. Do not invent a networked-system Input or applicability gate unless the supplied procedure explicitly defines that branch. Missing required input is a runtime error with reason code missing_organizational_input; optional consumers require an input_provided guard. A concrete literal supplied by the procedure is never an organizational Input: do not replace a fixed Value literal (for example Value: 1), a fixed numeric/boolean/string value, or a fixed regex with an Input or add an allowed constraint. A fixed scalar remains a scalar (do not turn it into a one-element array); add value_match only when the operand is an array, Variable/Input reference, or the selected schema explicitly requires it. If a query filters records to an explicit violating value and the procedure says returned records are a finding, require an empty finding-state result or query the full eligible population and require the compliant value for every member; never assert the opposite value on the already-filtered finding set. Inputs are reserved for values the procedure explicitly leaves unknown or organization/site-defined; wrapping a known literal in an Input is an authoring error. Return manual-only only when no objective collector/predicate can be expressed or the check itself cannot be performed. If the procedure names an organization-approved value or policy parameter, prefer a valid automated Assessment Input contract; do not hard-code it or downgrade it to manual-only merely because the binding is supplied later. A candidate for such a procedure that has no assessment.inputs declaration is not fully automated and will be rejected locally; do not claim fully automated while comparing against a placeholder, guessed value, or prose assumption. During correction, recompute generated_mode: if the corrected YAML cannot be made complete and schema-valid, return manual-only with no assessment_yaml rather than returning an invalid automated candidate. For a Rule-local applicability branch, use internal Tests and evaluate if/then/else with an explicit not_applicable outcome. Use an external applicability Assessment only when a supplied reusable condition/dependency exists; never invent an external Assessment ID.

Do not copy any example's command, Test ID, selector, or predicate; examples are structural guidance only. Every Test map key and every {test: ...} reference must use lowercase kebab-case, end in -test, and be at most 64 characters; keep references consistent. Never copy collected result/state fields into an Object selector: use only the selector alternatives and properties in the relevant capability mapping/native-selector schema, and return manual-only rather than guessing an unsupported Object shape. Serialize reported_elements as scalar all/compared or an explicit field-name array, never [all]. In a fields map, use exactly one comparison operator (for example stdout_line: {matches_regex: regex}); values_matching belongs only to field_requirement. For confirmed absence, put values_found: none only in fields.<field> and omit field_requirement entirely; shellcommand still uses item_requirement.items_found: one_or_more because it always creates an Item. Existence-only Tests use item_requirement.items_found only and do not add items_satisfying, field_requirement, or fields. Require logical and/or/one/xor children are inherited conditions and must contain fields or nested logical groups only; never put item_requirement inside those children. Keep item_requirement once on the enclosing require. For two predicates on one field, use an inherited and group with children such as {fields: {subexpression: {datatype: integer, greater_than: 0}}} and {fields: {subexpression: {datatype: integer, less_than_or_equal: 600}}}. Evaluate control flow must use if/then/else siblings; not_applicable is only a leaf outcome with reason, never a container for and/else. Use only cardinalities none, exactly_one, one_or_more, zero_or_more, and every; never emit at_least_one. Object selectors must use exact schema operators, for example linux.dpkginfo uses name: {equals: ufw} or name: {matches_regex: regex}; never invent pattern_match or raw selector syntax. Derive every Test from the supplied procedure and current Rule context. The editor will reject invalid output; it will not synthesize a content-specific replacement after the provider responds. If a Candidate Assessment is supplied in the user context, perform an independent review: compare it against every source obligation, construct adversarial counterexamples for omitted/malformed/commented/negative/out-of-range values and mixed populations, then return a complete corrected Assessment or preserve it only if it passes. Do not return a prose verdict instead of the required JSON contract.

If local SCAP-NG tools are available, use them to search mappings, inspect capability schemas, and validate a proposed Assessment before finalizing. Tool results are authoritative for the pinned pack and do not prove RI execution. Apply the authoring invariants and examples in the knowledge pack, especially the distinction between a population/applicability gate and the technical Test. For an explicit Not Applicable population branch, use separate internal Tests and Evaluate if/then/else when the supplied procedure supports that distinction. For an ISSO/ISSM/SA/AO exception, keep the technical Test's real pass/fail semantics; do not use not_evaluated merely because a human may approve a deviation after failure. If the source explicitly permits alternative notification channels (email, monitoring traps, local consoles, or hardware indications), do not silently implement only email; represent the supported alternatives or return manual-only so a human can choose the organization's policy branch.

Your task is to propose one Assessment for the supplied Rule and check procedure. Return ONLY a JSON object with these keys: generated_mode (automated or manual-only), confidence (high, medium, low), assessment_yaml (a YAML string when automated, empty when manual-only), assumptions (array of strings), unresolved_questions (array of strings), citations (array of short knowledge-pack pointers), rationale (short string), and coverage ({applicability: implemented|not-needed|not-representable, procedure_steps: [{summary, represented, tests}], path_patterns: [{pattern, represented, strategy}]}). Confidence is an authoring-completeness signal, not scanner/runtime proof: use high when every objective obligation is represented by schema-valid native Tests, applicability/path coverage is complete, and no unresolved semantic assumption affects the predicate; use medium only when a bounded review item remains; use low when representation is incomplete or uncertain. Do not omit confidence. Do not return Markdown or code fences, compliance PASS/FAIL, or a claim of runtime/scanner proof. The assessment_yaml must be a complete native SCAP-NG 0.4.1 Assessment and must validate against the supplied assessment schema: include specification, evaluate, test_title, reported_elements, and Test IDs ending in -test. Use explicit serialized values; never rely on presentation defaults. Decompose every command/check into an appropriate Test and connect them with explicit evaluate if/then/else logic. A Not Applicable branch must be represented with not_applicable or an existing applicability Assessment dependency; do not merely mention it in unresolved_questions while returning automated. Preserve every file path and wildcard population using schema-authorized directory/filename/set/for_each constructs; never collapse a wildcard to one file. Return manual-only if any required branch, path population, or objective predicate cannot be represented completely. A human approval exception alone does not require manual-only: represent the objective technical Test and let a known violation fail. Do not add not_evaluated merely because an ISSO/owner exception is mentioned; record an approved deviation after evaluation. Use not_evaluated only when the technical check itself cannot be performed or required evidence is unavailable. Automated plus a partial coverage manifest is invalid. Every Test must include a schema-valid test_title, capability, reported_elements, object and require. Object selectors must use operator maps such as full_path: {equals: /etc/example} and pattern: {matches_regex: regex}, never raw selector strings. For comparison requirements, use item_requirement.items_satisfying and field_requirement.values_matching only with schema cardinalities such as every; one_or_more belongs to items_found/values_found. For independent.shellcommand, an Item is always created even when stdout/stderr is empty; use field existence values_found: none on stdout_line/stderr_line for absence checks. Object.pattern filters stdout lines before field requirements. Do not infer Not Applicable from an absence test unless the procedure independently establishes the hardware/population branch; preserve unresolved ISSO exceptions as review notes while keeping the objective Test's pass/fail semantics; do not turn a known failure into not_evaluated.

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
${JSON.stringify(input.availableConditions ?? [])}

${explicitObjectivePrompt(input.checkText)}`;
  const messages: OpenAiChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const reportProgress = (phase: AiAuthoringProgress) => {
    try { input.progress?.(phase); } catch { /* UI progress must never affect authoring. */ }
  };
  const requestWithTools = async (requestMessages: OpenAiChatMessage[], timeout: number): Promise<string> => {
    if (!useTools) return requestOpenAiCompatibleChat(endpoint, apiKey, model, requestMessages, timeout, options.signal);
    try {
      return await requestOpenAiCompatibleChatWithTools(endpoint, apiKey, model, requestMessages, aiToolDefinitions(), aiToolHandler(pack), timeout, options.signal);
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
        return await requestOpenAiCompatibleChat(endpoint, apiKey, model, requestMessages, timeout, options.signal);
      } catch (fallbackError) {
        throw new Error(`${firstError}; retry without tools also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
      }
    }
  };
  const requestDraft = async (requestMessages: OpenAiChatMessage[], timeout: number, correction = false): Promise<string> => {
    if (options.signal?.aborted) throw new Error('AI authoring was canceled.');
    reportProgress(correction ? 'sending-correction' : 'sending-request');
    reportProgress(correction ? 'waiting-correction' : 'waiting-provider');
    const response = options.request
      ? await options.request(requestMessages, timeout, options.signal)
      : await requestWithTools(requestMessages, timeout);
    if (options.signal?.aborted) throw new Error('AI authoring was canceled.');
    reportProgress(correction ? 'received-correction' : 'received-response');
    return response;
  };
  let raw: string;
  try {
    const timeout = remainingTimeout();
    if (!timeout) return finalize(draftFromFailure('The AI request exceeded the total authoring deadline before a response was received.'));
    raw = await requestDraft(messages, timeout);
  }
  catch (error) { return finalize(draftFromFailure(error instanceof Error ? error.message : String(error))); }
  reportProgress('validating-response');
  const draft = parseAiAssessmentResponse(pack, input, raw);
  if (!draft.diagnostics.length) return finalize(draft);

  // One bounded repair pass gives a capable provider a chance to correct schema
  // and applicability mistakes using the local validator's exact diagnostics.
  // Do not resend the full schema/catalog prompt here: the first request already
  // supplied it, and repeating ~100 KB of context makes a failed response almost
  // twice as slow. The original procedure/rule remains in repairUser.
  const repairSystem = `You are repairing one SCAP-NG 0.4.1 Assessment-authoring response. Return ONLY one complete JSON object with generated_mode, confidence, assessment_yaml, assumptions, unresolved_questions, citations, rationale, and coverage. Do not return prose, Markdown, or a patch. Confidence is an authoring-completeness signal, not scanner/runtime proof: use high only when all objective obligations and coverage are represented and locally clean; use medium for a bounded review item and low for uncertainty or incomplete representation. Use the supplied local diagnostics as authoritative. The YAML must include specification id scap-ng.pre-alpha.assessment/version 0.4.1, scalar reported_elements all/compared (or explicit field names), and schema-valid Test-local require. If an organization-defined value is needed, declare assessment.inputs.<name-ending-in--input> with datatype, cardinality (exactly_one|zero_or_one|one_or_more|zero_or_more), and required, then use {input: <name>}; If the source contains a concrete literal such as Value: 1 or Value: 2, use that literal directly as a scalar and declare no Input; never turn it into a one-element array or invent an organization binding for a fixed value. Add value_match only for arrays, Variable/Input references, or when the selected schema explicitly requires it. If a query filters records to an explicit violating value and the procedure says returned records are a finding, require an empty finding-state result or query the full eligible population and require the compliant value for every member; never assert the opposite value on the already-filtered finding set. For a field comparison, the complete shape is fields: {subexpression: {equals: {input: <name>}, value_match: one_or_more}}; value_match is a field-predicate sibling and must not be confused with field_requirement.values_matching; do not request or invent concrete organizational values. Input declarations have no default property; do not invent an applicability Input or gate unless the procedure explicitly requires it. Comparison require uses item_requirement items_found/items_satisfying, field_requirement values_found/values_matching, then fields. A field map contains exactly one operator; values_matching belongs only to field_requirement. Require logical and/or/one/xor children are inherited conditions containing fields or nested logical groups only; never put item_requirement inside a child. Keep item_requirement once on the enclosing require. To apply two predicates to one field, use an inherited and group with one fields child per predicate. Evaluate applicability must be shaped as evaluate.if with sibling then and else branches; not_applicable is a leaf containing only reason, not a container for and/else. Do not add numeric lower or upper bounds that the procedure does not state; preserve explicit inequalities and flag external implementation ranges for review. A named prerequisite patch, update, software package, or version condition is not inherently manual: when exact identifiers are supplied and a pinned native capability or explicit supported command can query them, preserve separate Tests and the source's conditional Evaluate logic. Do not turn a version-specific prerequisite into an unconditional OR. Do not collapse independent checks merely to reduce Test count; preserve full-population and omission/finding semantics. Do not add a separate syntax/population Test solely to restate a selector or support another Test when the same selector already covers the source obligation; use one Test per independently stated objective unless an extra Test is required to prevent a finding from being hidden. If the source explicitly permits alternative notification channels (email, monitoring traps, local consoles, or hardware indications), do not silently repair an email-only candidate into a complete result; represent the alternatives or return manual-only for human policy selection. A human exception or ISSO documentation requirement alone is never a manual-only reason when the objective technical Test is representable; preserve that Test and record the exception for post-evaluation review. Regex escaping is layered: ensure the YAML regex contains the intended single backslashes after YAML parsing, not JSON-style double escaping; prefer single-quoted YAML regex scalars. Before finalizing, perform an adversarial semantic review of omitted options, malformed/negative/out-of-range values, duplicate directives, comments/inline comments, empty collections, and mixed compliant/noncompliant populations; a selector must not hide a member that the procedure says is a finding. When syntax or implementation validity is uncertain, state the assumption and preserve a finding/review condition. Regex escaping is layered: the outer JSON response escapes backslashes once, but the returned YAML scalar must contain the intended regex after YAML parsing; prefer a single-quoted YAML regex scalar when backslashes are needed and do not emit JSON-style double escaping into the YAML value. Verify the parsed regex semantics before returning. Use canonical Test requirement cardinalities only: none, exactly_one, one_or_more, zero_or_more, every; Assessment Input declarations additionally allow zero_or_one and require datatype/cardinality/required; never emit at_least_one. Object selectors must use exact mapping operators; linux.dpkginfo uses name: {equals: value} or name: {matches_regex: regex}, never pattern_match. For shellcommand, Items always exist; use item_requirement.items_found: one_or_more and put fields.stdout_line/stderr_line values_found: none for absence, omitting field_requirement. Existence-only Tests use item_requirement.items_found only and omit items_satisfying, field_requirement, and fields. Keep known technical failures as pass/fail; use not_applicable only for a real applicability branch and not_evaluated only when the technical check/evidence is unavailable. If the Assessment consumes a missing required organizational Input, preserve the input contract and let the runtime report error with reason code missing_organizational_input; do not turn it into Not Applicable or a guessed value. Do not ask the author for concrete organization-approved values merely to generate the Assessment. The correction response must include a nonempty coverage object even when the YAML is otherwise correct. Preserve high confidence when the corrected candidate is complete and locally clean; do not downgrade a complete candidate merely because it requires human approval (approval is not runtime proof). coverage.applicability must be implemented, not-needed, or not-representable; procedure_steps must list every objective step with represented: true/false and test IDs; path_patterns must list every wildcard/path set or be []. Correct every diagnostic and return the complete replacement. If complete representation is impossible, return generated_mode: manual-only with an empty assessment_yaml; never return an invalid automated candidate just to preserve the first response's classification. If an organization-defined value is explicitly required, preserve it as a required Assessment Input and classify the result as organizational-input automation when the technical predicate is otherwise representable. Never classify a candidate as fully automated when the source contains a placeholder or organization-defined value but the candidate declares no assessment.inputs; return manual-only if the value cannot be represented safely. If a Candidate Assessment is supplied, independently check every source obligation and adversarial counterexample before returning it or a corrected complete replacement; never return only a prose review.`;
  const repairTimeout = remainingTimeout();
  if (!repairTimeout) {
    draft.diagnostics.push('Automatic correction pass skipped because the total AI authoring deadline was reached.');
    return finalize(draft);
  }
  const repairUser = `${user}\n\nThe previous candidate was rejected by the local 0.4.1 validator. Diagnostics:\n${draft.diagnostics.slice(0, 30).join('\\n')}\n\nPrevious candidate (for correction only):\n${raw.slice(0, 30000)}`;
  try {
    const repairedRaw = await requestDraft([{ role: 'system', content: repairSystem }, { role: 'user', content: repairUser }], repairTimeout, true);
    reportProgress('validating-correction');
    const repaired = parseAiAssessmentResponse(pack, input, repairedRaw);
    if (repaired.diagnostics.length) {
      repaired.diagnostics.unshift('The provider was given one automatic correction pass, but the replacement still requires author review.');
    }
    return finalize(repaired);
  } catch (error) {
    draft.diagnostics.push(`Automatic correction pass failed: ${error instanceof Error ? error.message : String(error)}`);
    return finalize(draft);
  }
}
