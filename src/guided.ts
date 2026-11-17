import { stringify } from 'yaml';
import { MetadataPack, type Json } from './metadata.js';
import { schemaNodes } from './schema-resolver.js';
import { styleGeneratedObjects, type YamlObjectStyle } from './yaml-style.js';
import { selectorOperatorChoices, selectorValueChoices } from './completion.js';
import { orderGeneratedAssessment } from './assessment-order.js';

export interface GuidedOption { value: string; label: string; description?: string; isDefault?: boolean; }
export interface GuidedObjectField {
  name: string;
  label: string;
  description?: string;
  datatype: string;
  datatypes: string[];
  operations: GuidedOption[];
  enumValues: string[];
}
export interface GuidedObjectRequirement { fields: string[]; description?: string; }
export interface GuidedTestDraft { id: string; title: string; capability: string; object: Json; presenceOnly?: boolean; fields?: Record<string, Json>; }
export interface GuidedApplicabilitySelection { alias: string; assessmentId: string; expectedVersion: string | number; }
export interface GuidedAssessmentDraft { platform: string; id: string; title: string; mode: 'manual' | 'automated'; className: string; procedure?: string; response?: Json; tests?: GuidedTestDraft[]; evaluate?: 'and' | 'or' | 'one' | 'xor'; applicability?: GuidedApplicabilitySelection; objectStyle?: YamlObjectStyle; }
const schemaBase = 'https://scap-ng.dev/schema/v0.4.0/';
function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
const schemaContext = (pack: MetadataPack) => ({ documentVersion: pack.pin.schemaVersion, schemaValid: true, isOverride: false, diagnostics: [] as string[] });
function schemaDefaultOrObjectDefaults(pack: MetadataPack, uri: string): Json {
  const help = pack.describe(uri, schemaContext(pack));
  if (help.hasSuggestion) return structuredClone(help.suggested as Json);
  return pack.newObjectDefaults(uri, {}, schemaContext(pack));
}
function choices(pack: MetadataPack, uri: string): GuidedOption[] {
  try {
    const help = pack.describe(uri, { documentVersion: pack.pin.schemaVersion, schemaValid: true, isOverride: false, diagnostics: [] });
    const values = help.choices.length ? help.choices : enumValues(pack.node(uri));
    return values.filter((value: Json): value is string => typeof value === 'string').map(value => ({
      value,
      label: value,
      description: help.description || undefined,
      isDefault: help.hasSuggestion && value === help.suggested
    }));
  } catch { return []; }
}
function vocabulary(pack: MetadataPack): any { return pack.resource(pack.manifest.vocabulary_uri); }
function summaryValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (Array.isArray(value)) return value.map(summaryValue).filter(Boolean).join(', ');
  if (object(value)) {
    const entries = Object.entries(value);
    if (entries.length === 1) return `${entries[0][0].replaceAll('_', ' ')} ${summaryValue(entries[0][1])}`.trim();
    return entries.map(([name, operand]) => `${name.replaceAll('_', ' ')} ${summaryValue(operand)}`.trim()).join(', ');
  }
  return String(value);
}
/**
 * Generate only human-facing authored metadata. This never represents an
 * evaluation result; it is persisted in native test_title so the Test keeps
 * a useful summary when the author leaves the optional title blank.
 */
export function generatedTestTitle(pack: MetadataPack, draft: Pick<GuidedTestDraft, 'capability' | 'object' | 'fields' | 'presenceOnly'>): string {
  const labels = vocabulary(pack).capabilities ?? {};
  const capability = labels[draft.capability]?.label ?? draft.capability;
  const selectors = Object.entries(draft.object ?? {}).map(([name, predicate]) => {
    const value = summaryValue(predicate);
    return value ? `${name.replaceAll('_', ' ')} ${value}` : name.replaceAll('_', ' ');
  });
  const conditions = Object.entries(draft.fields ?? {}).map(([name, predicate]) => {
    const value = summaryValue(predicate);
    return value ? `${name.replaceAll('_', ' ')} ${value}` : name.replaceAll('_', ' ');
  });
  const selectorText = selectors.length ? ` for ${selectors.join(', ')}` : '';
  const conditionText = draft.presenceOnly ? ' (presence check)' : conditions.length ? `; requires ${conditions.join(' and ')}` : '';
  return `Check ${capability}${selectorText}${conditionText}`;
}
function datatypeValues(node: any): string[] { const values = new Set<string>(); const visit = (value: any) => { if (!value || typeof value !== 'object') return; if (Array.isArray(value.enum)) for (const item of value.enum) if (typeof item === 'string') values.add(item); for (const [key, child] of Object.entries(value)) if (key === 'datatype') visit(child); else if (child && typeof child === 'object') visit(child); }; visit(node); return [...values]; }
function enumValues(node: any): string[] {
  const values = new Set<string>(); const visit = (value: any) => { if (!value || typeof value !== 'object') return; if (Array.isArray(value.enum)) for (const item of value.enum) if (typeof item === 'string') values.add(item); for (const child of Object.values(value)) visit(child); }; visit(node); return [...values];
}
function selectorEnumValues(pack: MetadataPack, uri: string): string[] {
  const values = new Set<string>();
  const visit = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.enum)) for (const item of value.enum) if (typeof item === 'string') values.add(item);
    for (const child of Object.values(value)) visit(child);
  };
  for (const location of schemaNodes(pack, uri)) visit(location.node.properties?.equals);
  return [...values];
}
function schemaTypes(node: any): string[] {
  const values = new Set<string>();
  const visit = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.properties?.datatype?.enum)) for (const item of value.properties.datatype.enum) if (typeof item === 'string') values.add(item);
    if (Array.isArray(value.enum) && value.type === 'string' && value.enum.includes('string')) values.add('string');
    for (const child of Object.values(value)) visit(child);
  };
  visit(node);
  return [...values];
}

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
  reportedElements(): GuidedOption[] { return choices(this.pack, schemaBase + 'reported-elements.schema.json'); }
  logicalOperators(): GuidedOption[] {
    const uri = schemaBase + 'expression.schema.json#/$defs/expression';
    const terms = vocabulary(this.pack).term_scopes ?? {};
    const values = new Set<string>();
    for (const location of schemaNodes(this.pack, uri)) {
      for (const value of location.node.required ?? []) {
        const property = location.node.properties?.[value];
        if (property?.type === 'array') values.add(value);
      }
    }
    return [...values].map(value => ({ value, label: terms[`assessment.evaluate.${value}`]?.label ?? value, description: terms[`assessment.evaluate.${value}`]?.description }));
  }
  capabilityObjectSchema(capability: string) { return this.pack.manifest.capabilities[capability]?.schema_uri; }
  objectFields(capability: string): GuidedObjectField[] {
    const uri = this.capabilityObjectSchema(capability); if (!uri) return [];
    const schema: any = this.pack.resource(uri); const properties = schema.$defs?.object?.properties ?? {};
    // Generated capability schemas identify primary selectors with the pinned
    // authoring context. This keeps Guided and native YAML on one metadata path.
    return Object.entries(properties).filter(([, spec]: [string, any]) => spec?.['x-scap-ng-authoring']?.context === 'selector_comparison').map(([name, spec]: [string, any]) => {
      const pointer = uri + '#/$defs/object/properties/' + name.replace(/~/g, '~0').replace(/\//g, '~1');
      const help = this.pack.describe(pointer, schemaContext(this.pack));
      const datatypes = datatypeValues(spec).length ? datatypeValues(spec) : schemaTypes(spec);
      const operations = selectorOperatorChoices(this.pack, capability, name, false).map(option => ({ value: option.value, label: option.label, description: option.description }));
      return { name, label: help.title || name, description: help.description, datatype: datatypes[0] ?? 'string', datatypes, operations, enumValues: selectorEnumValues(this.pack, pointer) };
    });
  }
  objectRequirements(capability: string): GuidedObjectRequirement[] {
    const uri = this.capabilityObjectSchema(capability); if (!uri) return [];
    const schema: any = this.pack.resource(uri); const objectSchema = schema.$defs?.object;
    const fields = new Set(this.objectFields(capability).map(field => field.name));
    const branches = Array.isArray(objectSchema?.oneOf) ? objectSchema.oneOf : [objectSchema];
    return branches.map((branch: any) => ({
      fields: (branch?.required ?? []).filter((name: any) => typeof name === 'string' && fields.has(name)),
      description: typeof branch?.description === 'string' ? branch.description : undefined
    })).filter((requirement: GuidedObjectRequirement) => requirement.fields.length > 0);
  }
  resultFields(capability: string) {
    const uri = this.capabilityObjectSchema(capability); if (!uri) return [];
    const schema: any = this.pack.resource(uri); const predicate: any = schema.$defs?.state_predicate;
    const branches = ['oneOf', 'anyOf'].flatMap(key => Array.isArray(predicate?.[key]) ? predicate[key] : []);
    const names = new Set<string>(); for (const branch of branches) for (const name of branch.required ?? []) names.add(name);
    return [...names].map(name => {
      const matching = branches.map((branch: any, index: number) => ({ branch, index })).filter(({ branch }) => (branch.required ?? []).includes(name));
      const datatypes = [...new Set(matching.flatMap(({ branch }) => datatypeValues(branch.properties?.[name])))];
      const description = matching.map(({ branch, index }) => {
        const property = branch.properties?.[name]; if (property?.description) return property.description;
        try { return this.pack.describe(`${uri}#/$defs/state_predicate/${Array.isArray(predicate.oneOf) ? 'oneOf' : 'anyOf'}/${index}/properties/${name}`, { documentVersion: this.pack.pin.schemaVersion, schemaValid: true, isOverride: false, diagnostics: [] }).description; } catch { return ''; }
      }).find(Boolean) || undefined;
      const operations = selectorOperatorChoices(this.pack, capability, name, true).map(option => ({ value: option.value, label: option.label, description: option.description }));
      // Presence/cardinality predicates (for example values_found: none) are
      // native Require operations too, but are intentionally kept separate
      // from scalar comparison operators by the completion adapter. Derive
      // those extra operations directly from the pinned predicate schema so a
      // wizard can restore a presence-only field without a GUI registry.
      const languageUri = schemaBase + 'assessment-language.schema.json';
      const scalarPredicate: any = this.pack.resource(languageUri).$defs?.scalar_field_predicate;
      for (const [value, spec] of Object.entries(scalarPredicate?.properties ?? {})) {
        const ref = typeof (spec as any)?.$ref === 'string' ? String((spec as any).$ref) : '';
        if (!/(?:existence_cardinality|cardinality)$/.test(ref) || operations.some(operation => operation.value === value)) continue;
        operations.push({ value, label: String((spec as any).title || value).replaceAll('_', ' '), description: (spec as any).description });
      }
      const valueChoices = Object.fromEntries(operations.map(operation => {
        const direct = selectorValueChoices(this.pack, capability, name, operation.value, true).map(choice => choice.value);
        if (direct.length) return [operation.value, direct];
        const spec = scalarPredicate?.properties?.[operation.value]; const ref = typeof spec?.$ref === 'string' ? spec.$ref : undefined;
        if (!ref) return [operation.value, []];
        try {
          const choices = this.pack.describe(new URL(ref, languageUri).href, schemaContext(this.pack)).choices;
          return [operation.value, choices.filter((choice: Json): choice is string => typeof choice === 'string')];
        } catch { return [operation.value, []]; }
      }));
      return { name, label: name, description, datatype: datatypes[0] ?? 'string', datatypes, operations, valueChoices };
    });
  }
  operations() {
    const vocabularyOperations = vocabulary(this.pack).operations ?? {};
    const predicate = this.pack.resource(schemaBase + 'assessment-language.schema.json').$defs?.scalar_field_predicate?.properties ?? {};
    return Object.keys(predicate).filter(name => Object.hasOwn(vocabularyOperations, name) || name === 'case_insensitive_not_equal').map(value => ({ value, label: vocabularyOperations[value]?.label ?? value, description: vocabularyOperations[value]?.description }));
  }
}

export function createGuidedAssessment(pack: MetadataPack, draft: GuidedAssessmentDraft): { document: Json; yaml: string; diagnostics: string[] } {
  if (!draft.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*-assessment$/.test(draft.id)) throw new Error('Assessment ID must end in -assessment and use lowercase kebab-case');
  if (!draft.title.trim()) throw new Error('Assessment title is required');
  if (!draft.platform) throw new Error('Choose a target platform authoring context');
  const assessment: Record<string, Json> = { id: draft.id, version: 1, assessment_title: draft.title, mode: draft.mode, class: draft.className };
  if (draft.applicability) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.applicability.alias)) throw new Error('Applicability alias must use lowercase kebab-case.');
    if (!draft.applicability.assessmentId.trim()) throw new Error('Applicability Assessment ID is required.');
    assessment.dependencies = { [draft.applicability.alias]: { assessment: draft.applicability.assessmentId, expected_version: draft.applicability.expectedVersion, purpose: 'applicability' } };
    assessment.applicability = { assessment: draft.applicability.alias };
  }
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
      const itemRequirementUri = schemaBase + 'assessment-language.schema.json#/$defs/canonical_all_items_requirement/properties/item_requirement';
      const fieldRequirementUri = schemaBase + 'assessment-language.schema.json#/$defs/canonical_all_items_requirement/properties/field_requirement';
      const itemDefaults = schemaDefaultOrObjectDefaults(pack, itemRequirementUri);
      const require: Record<string, Json> = { item_requirement: test.presenceOnly
        ? { items_found: (itemDefaults as Record<string, Json>).items_found }
        : itemDefaults };
      if (!test.presenceOnly) {
        require.field_requirement = schemaDefaultOrObjectDefaults(pack, fieldRequirementUri);
        if (test.fields && Object.keys(test.fields).length) require.fields = test.fields;
      }
      const testTitle = test.title?.trim() || generatedTestTitle(pack, test);
      tests[test.id] = { test_title: testTitle, capability: test.capability, reported_elements: 'all', object: test.object, require };
    }
    // New authoring presents the evaluation graph before its Test definitions.
    // This is a presentation/layout choice only: existing documents are never
    // reserialized, and the native schema remains order-insensitive.
    const ids = draft.tests.map(test => ({ test: test.id }) as Json);
    assessment.evaluate = draft.evaluate ? { [draft.evaluate]: ids } : ids[0];
    assessment.tests = tests;
  }
  const document = { assessment: orderGeneratedAssessment(assessment, draft.mode) } as Json;
  const diagnostics = pack.validate(schemaBase + 'assessment.schema.json', document);
  return { document, yaml: draft.objectStyle ? styleGeneratedObjects(document, draft.objectStyle) : stringify(document), diagnostics };
}
