import { stringify } from 'yaml';
import { MetadataPack, type Json } from './metadata.js';

export interface GuidedOption { value: string; label: string; description?: string; }
export interface GuidedTestDraft { id: string; title: string; capability: string; object: Json; presenceOnly?: boolean; fields?: Record<string, Json>; }
export interface GuidedAssessmentDraft { platform: string; id: string; title: string; mode: 'manual' | 'automated'; className: string; procedure?: string; response?: Json; tests?: GuidedTestDraft[]; evaluate?: 'and' | 'or' | 'one' | 'xor'; }
const schemaBase = 'https://scap-ng.dev/schema/v0.4.0/';
function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function choices(pack: MetadataPack, uri: string): GuidedOption[] {
  try { const help = pack.describe(uri, { documentVersion: pack.pin.schemaVersion, schemaValid: true, isOverride: false, diagnostics: [] }); return help.choices.filter((value: Json): value is string => typeof value === 'string').map(value => ({ value, label: value })); } catch { return []; }
}
function vocabulary(pack: MetadataPack): any { return pack.resource(pack.manifest.vocabulary_uri); }

export class GuidedCatalog {
  constructor(readonly pack: MetadataPack) {}
  platforms(): GuidedOption[] { return Object.entries(vocabulary(this.pack).platform_labels ?? {}).map(([value, label]) => ({ value, label: String(label) })); }
  capabilities(): GuidedOption[] {
    const labels = vocabulary(this.pack).capabilities ?? {};
    return Object.keys(this.pack.manifest.capabilities).sort().map(value => ({ value, label: labels[value]?.label ?? value, description: labels[value]?.description }));
  }
  modes(): GuidedOption[] { return choices(this.pack, schemaBase + 'assessment.schema.json#/properties/assessment/properties/mode'); }
  classes(): GuidedOption[] { return choices(this.pack, schemaBase + 'assessment.schema.json#/properties/assessment/properties/class'); }
  itemFound(): GuidedOption[] { return choices(this.pack, schemaBase + 'assessment-language.schema.json#/$defs/item_existence_cardinality'); }
  itemsSatisfying(): GuidedOption[] { return choices(this.pack, schemaBase + 'assessment-language.schema.json#/$defs/cardinality'); }
  fieldValuesFound(): GuidedOption[] { return choices(this.pack, schemaBase + 'assessment-language.schema.json#/$defs/paired_requirement/properties/values_found'); }
  fieldValuesMatching(): GuidedOption[] { return choices(this.pack, schemaBase + 'assessment-language.schema.json#/$defs/paired_requirement/properties/values_matching'); }
  logicalOperators(): GuidedOption[] {
    return ['and', 'or', 'one', 'xor'].map(value => ({ value, label: vocabulary(this.pack).term_scopes?.[`assessment.evaluate.${value}`]?.label ?? value, description: vocabulary(this.pack).term_scopes?.[`assessment.evaluate.${value}`]?.description }));
  }
  capabilityObjectSchema(capability: string) { return this.pack.manifest.capabilities[capability]?.schema_uri; }
}

export function createGuidedAssessment(pack: MetadataPack, draft: GuidedAssessmentDraft): { document: Json; yaml: string; diagnostics: string[] } {
  if (!draft.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*-assessment$/.test(draft.id)) throw new Error('Assessment ID must end in -assessment and use lowercase kebab-case');
  if (!draft.title.trim()) throw new Error('Assessment title is required');
  if (!draft.platform) throw new Error('Choose a target platform authoring context');
  const assessment: Record<string, Json> = { id: draft.id, version: 1, assessment_title: draft.title, mode: draft.mode, class: draft.className };
  if (draft.mode === 'manual') {
    if (!draft.procedure?.trim()) throw new Error('Manual procedure is required');
    if (!draft.response || !object(draft.response)) throw new Error('Manual response contract is required');
    assessment.procedure = draft.procedure; assessment.response = draft.response;
  }
  else {
    if (!draft.tests?.length) throw new Error('Add at least one automated Test');
    assessment.specification = { id: 'scap-ng.pre-alpha.assessment', version: '0.4.0' };
    const tests: Record<string, Json> = {};
    for (const test of draft.tests) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-test$/.test(test.id)) throw new Error(`Test ID must be lowercase kebab-case and end in -test: ${test.id}`);
      const require: Record<string, Json> = { item_requirement: { items_found: 'one_or_more', ...(test.presenceOnly ? {} : { items_satisfying: 'every' }) } };
      if (!test.presenceOnly) { require.field_requirement = { values_found: 'one_or_more', values_matching: 'every' }; if (test.fields && Object.keys(test.fields).length) require.fields = test.fields; }
      tests[test.id] = { test_title: test.title, capability: test.capability, reported_elements: 'all', object: test.object, require };
    }
    assessment.tests = tests;
    const ids = draft.tests.map(test => ({ test: test.id }) as Json);
    assessment.evaluate = draft.evaluate ? { [draft.evaluate]: ids } : ids[0];
  }
  const document = { assessment } as Json;
  const diagnostics = pack.validate(schemaBase + 'assessment.schema.json', document);
  return { document, yaml: stringify(document), diagnostics };
}
