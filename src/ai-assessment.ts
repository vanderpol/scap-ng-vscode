import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import type { MetadataPack } from './metadata.js';
import { requestOpenAiCompatibleChat, type OpenAiChatMessage } from './ai-remote.js';

export interface AiAssessmentInput {
  ruleId: string;
  title: string;
  checkText: string;
  platform?: string;
  ruleYaml?: string;
  availableConditions?: Array<{ name: string; assessment: string; title?: string; version?: string | number }>;
}

export interface AiAssessmentCoverage {
  applicability: 'implemented' | 'not-needed' | 'not-representable';
  procedureSteps: Array<{ summary: string; represented: boolean; tests?: string[] }>;
  pathPatterns: Array<{ pattern: string; represented: boolean; strategy?: string }>;
}

export interface AiAssessmentDraft {
  generatedMode: 'automated' | 'manual-only';
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
    ['linux', ['linux', 'rhel', 'red hat', 'rpm', 'yum', 'dnf', 'systemctl', 'selinux']],
    ['unix', ['unix', 'linux', '/etc/', 'grep', 'passwd', 'shadow', 'chmod', 'ownership']],
    ['macos', ['macos', 'os x', 'plist', 'launchctl']],
    ['independent', ['command', 'shell', 'text file', 'configuration', 'regex']]
  ] as const) {
    if (haystack.startsWith(family + '.') && hints.some(hint => context.includes(hint))) score += 10;
  }
  if (haystack.startsWith('independent.') && /command|shell|text|file|regex|output/i.test(context)) score += 4;
  return score;
}

function selectedMappings(pack: MetadataPack, text: string, platform = ''): { catalog: any[]; relevant: any[] } {
  const entries = mappingEntries(pack).map(value => ({ value, score: capabilityScore(String(value?.capability ?? ''), String(value?.source ?? ''), text, platform) }));
  entries.sort((a, b) => b.score - a.score || String(a.value?.capability).localeCompare(String(b.value?.capability)));
  const relevant = entries.filter(entry => entry.score > 0).slice(0, 14).map(entry => compactMapping(entry.value));
  const catalog = entries.map(entry => ({ capability: entry.value?.capability, source: sourceSummary(entry.value?.source), score: entry.score }));
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
  const schemaNames = ['assessment.schema.json', 'rule.schema.json', 'benchmark.schema.json', 'applicability.schema.json', 'assessment-language.schema.json', 'native-selector.schema.json', 'expression.schema.json', 'variable-expression.schema.json'];
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
    ['SCHEMA-VERSION-MIGRATION-PLAN.md', readKnowledgeDocument(extensionRoot, 'SCHEMA-VERSION-MIGRATION-PLAN.md', documentLimit)]
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
    current_authoring_examples: {
      basic_assessment: 'assessment: { id: example-assessment, version: 1, assessment_title: Check a file, mode: automated, class: compliance, tests: { example-test: { test_title: Check a file, capability: unix.file, object: { filepath: { equals: /etc/example } }, require: { item_requirement: { items_found: one_or_more } } } } }',
      comparison_require: 'require: { item_requirement: { items_found: one_or_more, items_satisfying: every }, field_requirement: { values_found: one_or_more, values_matching: every }, fields: { value: { equals: expected } } }',
      shellcommand_existence: 'capability: independent.shellcommand; object: { shell: bash, command: command, error_if_exit_status_not_0: false, error_if_stderr_exists: false }; require: { item_requirement: { items_found: one_or_more }, field_requirement: { values_found: none } }',
      applicability_boundary: 'Applicability is separate from a platform hint. Do not invent or omit an applicability Assessment when the procedure contains an explicit branch without enough evidence to model it.'
    }
  });
}
function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
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
  return /not applicable|\bn\/a\b|not being utilized|not being used|if .*\b(ad|inactive|not installed|not configured)\b/i.test(text);
}

function procedureHasPathSet(text: string): boolean {
  return /\*|\[[^\]]+\]|\bconf\.d\b|\bfor each\b|\ball files?\b|\bany files?\b/i.test(text);
}

function coverageDiagnostics(input: AiAssessmentInput, payload: any, value: any): string[] {
  const coverage = normalizeCoverage(payload?.coverage);
  if (!coverage) return ['AI response omitted the required procedure coverage manifest; no draft was accepted.'];
  const diagnostics: string[] = [];
  if (procedureNeedsApplicability(input.checkText) && coverage.applicability !== 'implemented') diagnostics.push('The procedure contains a Not Applicable/conditional branch, but the AI did not implement that branch in Assessment logic.');
  if (coverage.procedureSteps.some(step => !step.represented)) diagnostics.push('The AI coverage manifest identifies one or more procedure steps that are not represented; partial automation is not linkable.');
  if (procedureHasPathSet(input.checkText) && (!coverage.pathPatterns.length || coverage.pathPatterns.some(path => !path.represented))) diagnostics.push('The procedure names a path set, wildcard, or multiple files, but the AI did not represent the complete population.');
  if (!coverage.procedureSteps.length) diagnostics.push('The AI coverage manifest contains no procedure steps.');
  const unresolvedCritical = list(payload?.unresolved_questions).filter(item => /applicability|not applicable|partial|wildcard|additional file|path set|cannot be represented|not represent/i.test(item));
  if (unresolvedCritical.length) diagnostics.push('The AI reports unresolved semantic coverage gaps; review or refine the procedure before linking this draft.');
  if (value?.assessment?.mode === 'automated' && !value?.assessment?.evaluate && coverage.procedureSteps.length > 1) diagnostics.push('Multiple procedure steps require explicit evaluate logic; the draft has no evaluate expression.');
  return diagnostics;
}

function draftFromFailure(message: string, assumptions: string[] = []): AiAssessmentDraft {
  return { generatedMode: 'manual-only', confidence: 'low', yaml: '', diagnostics: [message], document: undefined, assumptions, unresolved: [message], citations: [], method: 'configured-ai' };
}

export async function createAiAssessmentDraft(pack: MetadataPack, extensionRoot: string, endpoint: string, apiKey: string, model: string, input: AiAssessmentInput): Promise<AiAssessmentDraft> {
  // Bound user-controlled source before constructing a provider request. This
  // protects the authoring host and makes the exact outbound scope predictable.
  if (input.checkText.length > 60000) return draftFromFailure('The procedure text is larger than the AI authoring limit (60,000 characters); use a focused excerpt or the offline workflow.');
  if ((input.ruleYaml?.length ?? 0) > 50000) return draftFromFailure('The Rule YAML is larger than the AI authoring limit (50,000 characters); remove unrelated context or use the offline workflow.');
  if (input.title.length > 4000 || input.ruleId.length > 1000) return draftFromFailure('The Rule identity/title exceeds the AI authoring limit; shorten it before retrying.');
  const knowledge = buildScapNgKnowledge(pack, extensionRoot, { platform: input.platform, checkText: input.checkText });
  const system = `You are a SCAP-NG 0.4.1 assessment-authoring specialist, not a generic novice assistant. Use ONLY the canonical knowledge pack below as the normative contract. The schema and capability mappings are authoritative; do not invent fields, capabilities, operators, result semantics, applicability semantics, or scanner behavior. Prefer an existing mapped capability over a new one. Preserve organizational/ISSO/SA judgment as manual or unresolved. If the procedure has an applicability branch, use only a supplied existing applicability condition; otherwise return unresolved questions or manual-only rather than inventing an Assessment ID.\n\nYour task is to propose one Assessment for the supplied Rule and check procedure. Return ONLY a JSON object with these keys: generated_mode (automated or manual-only), confidence (high, medium, low), assessment_yaml (a YAML string when automated, empty when manual-only), assumptions (array of strings), unresolved_questions (array of strings), citations (array of short knowledge-pack pointers), rationale (short string), and coverage ({applicability: implemented|not-needed|not-representable, procedure_steps: [{summary, represented, tests}], path_patterns: [{pattern, represented, strategy}]}). Do not return Markdown or code fences, compliance PASS/FAIL, or a claim of runtime/scanner proof. The assessment_yaml must be a complete native SCAP-NG 0.4.1 Assessment and must validate against the supplied assessment schema: include specification, evaluate, test_title, reported_elements, and Test IDs ending in -test. Use explicit serialized values; never rely on presentation defaults. Decompose every command/check into an appropriate Test and connect them with explicit evaluate if/then/else logic. A Not Applicable branch must be represented with not_applicable or an existing applicability Assessment dependency; do not merely mention it in unresolved_questions while returning automated. Preserve every file path and wildcard population using schema-authorized directory/filename/set/for_each constructs; never collapse a wildcard to one file. Return manual-only if any required branch, path population, or predicate cannot be represented completely. Automated plus a partial coverage manifest is invalid. Every Test must include a schema-valid test_title, capability, reported_elements, object and require. Object selectors must use operator maps such as full_path: {equals: /etc/example} and pattern: {matches_regex: regex}, never raw selector strings. For comparison requirements, use item_requirement.items_satisfying and field_requirement.values_matching only with schema cardinalities such as every; one_or_more belongs to items_found/values_found.\n\nCanonical SCAP-NG knowledge pack (provenance pinned):\n${knowledge}`;
  const user = `Generate an AI-assisted draft for this source context. The user explicitly approved sending this bounded context to the configured provider.\n\nRule ID: ${input.ruleId}\nRule title: ${input.title}\nTarget platform context: ${input.platform || 'unknown; do not infer applicability solely from platform'}\n\nManual/check procedure text:\n--- BEGIN PROCEDURE ---\n${input.checkText}\n--- END PROCEDURE ---\n\nCurrent Rule YAML (context only; do not rewrite or mutate it):\n--- BEGIN RULE YAML ---\n${input.ruleYaml || '(not supplied)'}\n--- END RULE YAML ---\n\nExisting Benchmark applicability conditions (reference context only; do not invent IDs):\n${JSON.stringify(input.availableConditions ?? [])}`;
  let raw: string;
  try {
    const messages: OpenAiChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: user }];
    raw = await requestOpenAiCompatibleChat(endpoint, apiKey, model, messages);
  } catch (error) {
    return draftFromFailure(error instanceof Error ? error.message : String(error));
  }
  let payload: any;
  try { payload = JSON.parse(stripCodeFence(raw)); }
  catch { return draftFromFailure('The AI response was not valid JSON; no draft was accepted.'); }
  const assumptions = list(payload?.assumptions);
  const unresolved = list(payload?.unresolved_questions);
  const citations = list(payload?.citations);
  const rationale = typeof payload?.rationale === 'string' ? payload.rationale.trim() : undefined;
  const coverage = normalizeCoverage(payload?.coverage);
  const confidence = payload?.confidence === 'high' || payload?.confidence === 'medium' ? payload.confidence : 'low';
  if (payload?.generated_mode === 'manual-only') return { generatedMode: 'manual-only', confidence, yaml: '', diagnostics: [], document: undefined, assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
  if (payload?.generated_mode !== 'automated') return draftFromFailure('The AI response did not declare generated_mode as automated or manual-only.', assumptions);
  let yamlText = typeof payload.assessment_yaml === 'string' ? stripCodeFence(payload.assessment_yaml) : '';
  if (!yamlText && payload.assessment && typeof payload.assessment === 'object') yamlText = stringify(payload.assessment);
  if (!yamlText) return draftFromFailure('The AI response did not contain assessment_yaml.', assumptions);
  const document = parseDocument(yamlText, { uniqueKeys: true });
  if (document.errors.length) return { generatedMode: 'automated', confidence, yaml: yamlText, diagnostics: document.errors.map(error => error.message), assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
  let value: any;
  try { value = document.toJS({ maxAliasCount: 50 }); } catch (error) { return { generatedMode: 'automated', confidence, yaml: yamlText, diagnostics: [error instanceof Error ? error.message : String(error)], assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' }; }
  const schemaUri = pack.manifest.resources.find((item: any) => item.kind === 'schema' && item.uri.endsWith('/assessment.schema.json'))?.uri;
  const diagnostics = schemaUri ? pack.validate(schemaUri, value) : ['Pinned Assessment schema is unavailable.'];
  if (diagnostics.length) return { generatedMode: 'automated', confidence: 'low', yaml: yamlText, diagnostics, assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
  if (value?.assessment?.mode !== 'automated') diagnostics.push('AI draft must contain assessment.mode: automated.');
  if (!value?.assessment?.id || value.assessment.id !== input.ruleId.replace(/-rule$/, '-assessment')) assumptions.push('Review the generated Assessment ID and its Rule linkage before saving.');
  diagnostics.push(...coverageDiagnostics(input, payload, value));
  const effectiveConfidence = diagnostics.length ? 'low' : confidence;
  return { generatedMode: 'automated', confidence: effectiveConfidence, yaml: yamlText, document: value, diagnostics, assumptions, unresolved, citations, rationale, coverage, method: 'configured-ai' };
}
