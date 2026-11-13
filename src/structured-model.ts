import { parseDocument } from 'yaml';
import { MetadataPack, sha256, type Json } from './metadata.js';
import { SourceBuffer } from './source.js';
import { GuidedCatalog } from './guided.js';
import { schemaDynamicPropertyLocations, schemaItemLocations, schemaNodes, schemaPropertiesAtPath, schemaPropertyEntries } from './schema-resolver.js';
import { predicateOperatorChoices, predicateValueSourceChoices, selectorFieldDatatypes, selectorOperatorChoices, selectorValueChoices, selectorValueSourceChoices } from './completion.js';
import { analyzeVariables, expressionContract, inferredVariableDatatype, variableAnalysisSummary } from './expression-contract.js';
import { analyzeAssessmentReferences } from './reference-graph.js';

type EditPath = (string | number)[];
function scalarEntries(value: Json, path: EditPath = []): Array<{ path: EditPath; value: Json }> {
  if (Array.isArray(value)) return value.flatMap((entry, index) => scalarEntries(entry, [...path, index]));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => scalarEntries(entry, [...path, key]));
  return [{ path, value }];
}
function pathLabel(path: EditPath) { return path.map(part => typeof part === 'number' ? `[${part}]` : part).join('.').replaceAll('.[', '['); }
function schemaRoot(pack?: MetadataPack, value?: any) {
  const manual = value?.assessment?.mode === 'manual';
  const suffix = manual ? /\/manual-assessment\.schema\.json$/ : /\/assessment\.schema\.json$/;
  return pack?.manifest.resources.find((resource: any) => resource.kind === 'schema' && suffix.test(resource.uri))?.uri as string | undefined;
}

/**
 * Native Variable expression operations exposed by the pinned 0.4 Assessment
 * schema.  The inactive variable-function-expression schema is intentionally
 * not consulted here: it documents a migration candidate, not authoring
 * syntax accepted by Assessment.
 */
export function variableExpressionOperations(pack?: MetadataPack) {
  if (!pack) return [] as Array<{ value: string; title: string; description: string; required: string[] }>;
  const uri = pack.manifest.resources.find((resource: any) =>
    resource.kind === 'schema' && /\/variable-expression\.schema\.json$/.test(resource.uri))?.uri;
  if (!uri) return [];
  try {
    const schema: any = pack.resource(uri);
    const branches = schema?.$defs?.expression?.oneOf;
    if (!Array.isArray(branches)) return [];
    return branches.flatMap((branch: any) => {
      const properties = branch?.properties;
      if (!properties || typeof properties !== 'object') return [];
      const value = Object.keys(properties)[0];
      return value ? [{
        value,
        title: String(branch.title || value),
        description: String(branch.description || properties[value]?.description || ''),
        required: Array.isArray(branch.required) ? branch.required.map(String) : [value]
      }] : [];
    });
  } catch { return []; }
}
function escapedPart(part: string | number) { return String(part).replace(/~/g, '~0').replace(/\//g, '~1'); }
function dereference(pack: MetadataPack, uri: string, seen = new Set<string>()): { uri: string; node: any } | undefined {
  if (seen.has(uri)) return undefined; seen.add(uri);
  const node = pack.node(uri); if (typeof node.$ref !== 'string') return { uri, node };
  const target = new URL(node.$ref, uri).href; return dereference(pack, target, seen);
}
function schemaForPath(pack: MetadataPack, uri: string, path: EditPath): string | undefined {
  if (!path.length) return uri;
  const resolved = dereference(pack, uri); if (!resolved) return undefined;
  const node = resolved.node;
  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    for (let index = 0; index < (node[keyword] ?? []).length; index++) {
      const child = resolved.uri + (resolved.uri.includes('#') ? '' : '#') + `/${keyword}/${index}`;
      const found = schemaForPath(pack, child, path); if (found) return found;
    }
  }
  const [part, ...rest] = path;
  if (typeof part === 'number') return node.items ? schemaForPath(pack, resolved.uri + (resolved.uri.includes('#') ? '' : '#') + '/items', rest) : undefined;
  if (node.properties && Object.hasOwn(node.properties, part)) return schemaForPath(pack, resolved.uri + (resolved.uri.includes('#') ? '' : '#') + '/properties/' + escapedPart(part), rest);
  if (node.additionalProperties && typeof node.additionalProperties === 'object') return schemaForPath(pack, resolved.uri + (resolved.uri.includes('#') ? '' : '#') + '/additionalProperties', rest);
  return undefined;
}
function vocabularyHelp(pack: MetadataPack, path: EditPath): { label?: string; description?: string; choices?: unknown[] } | undefined {
  try {
    const vocabulary: any = pack.resource(pack.manifest.vocabulary_uri);
    const scopes = vocabulary?.term_scopes ?? {};
    const candidates: string[] = [];
    if (path[0] === 'assessment') {
      if (path.length === 2) candidates.push(`assessment.${String(path[1])}`);
      if (path[1] === 'evaluate' && path.length >= 3) candidates.push(`assessment.evaluate.${String(path[2])}`);
      const tests = path.indexOf('tests');
      if (tests >= 0) {
        const rest = path.slice(tests + 2).map(String);
        if (rest[0] === 'require') {
          if (rest[1] === 'item_requirement' && rest[2]) candidates.push(`test.require.item_requirement.${rest[2]}`);
          if (rest[1] === 'field_requirement') candidates.push('test.require.field_requirement');
          if (rest[1] === 'fields') {
            if (rest[2]) candidates.push(`field.${rest[2]}`);
            if (rest.length === 2) candidates.push('test.require.fields');
          }
          if (rest[1] && rest[1] !== 'fields') candidates.push(`test.require.${rest[1]}`);
          if (rest[1] === 'fields') candidates.push('test.require.fields');
        } else if (rest.length === 1 && rest[0]) candidates.push(`test.${rest[0]}`);
        const fields = path.indexOf('fields');
        if (fields >= 0 && path.length > fields + 1) {
          // Prefer the operation vocabulary (field.equals, field.matches_regex,
          // etc.) over the generic Require-fields description.
          candidates.unshift(`field.${String(path.at(-1))}`);
        }
      }
    }
    return candidates.map(candidate => scopes[candidate]).find(Boolean);
  } catch { return undefined; }
}
function schemaFacts(pack: MetadataPack, uri: string): { types: string[]; constraints: string[] } {
  const types = new Set<string>(); const constraints: string[] = [];
  for (const { node } of schemaNodes(pack, uri)) {
    const declared = Array.isArray(node?.type) ? node.type : node?.type ? [node.type] : [];
    for (const type of declared) types.add(String(type));
    if (Array.isArray(node?.enum) && node.enum.length) constraints.push(`Allowed values: ${node.enum.map((value: unknown) => `\`${String(value)}\``).join(', ')}`);
    if (typeof node?.pattern === 'string') constraints.push(`Pattern: \`${node.pattern}\``);
    if (typeof node?.minLength === 'number') constraints.push(`Minimum length: ${node.minLength}`);
    if (typeof node?.maxLength === 'number') constraints.push(`Maximum length: ${node.maxLength}`);
    if (node?.format) constraints.push(`Format: \`${String(node.format)}\``);
  }
  return { types: [...types], constraints: [...new Set(constraints)] };
}
function schemaHelp(pack: MetadataPack | undefined, root: string | undefined, path: EditPath, draft = false) {
  if (!pack || !root || !path.length) return undefined;
  try {
    const uri = schemaForPath(pack, root, path); if (!uri) return undefined;
    const parentUri = path.length > 1 ? schemaForPath(pack, root, path.slice(0, -1)) : undefined;
    const help = pack.describe(uri, { documentVersion: '0.4.0', schemaValid: !draft, isOverride: false, diagnostics: [] });
    const vocabulary = vocabularyHelp(pack, path);
    const facts = schemaFacts(pack, uri);
    const key = String(path.at(-1));
    const fieldIndex = path.lastIndexOf('fields');
    const fieldName = fieldIndex >= 0 && path.length > fieldIndex + 1 ? String(path[fieldIndex + 1]) : undefined;
    const typeText = facts.types.length ? ` Schema type: ${facts.types.map(type => `\`${type}\``).join(' or ')}.` : '';
    const fieldPrefix = fieldName && fieldIndex >= 0 ? `Collected field \`${fieldName}\`.${typeText}` : '';
    const description = vocabulary?.description || help.description || '';
    const factText = fieldPrefix && facts.constraints.length ? ` ${facts.constraints.join('. ')}.` : '';
    const completeDescription = `${fieldPrefix}${description ? (fieldPrefix ? ' ' : '') + description : ''}${factText}`.trim() || `Schema-defined ${key.replaceAll('_', ' ')} value.${typeText}`.trim();
    const title = vocabulary?.label || help.title || key.replaceAll('_', ' ').replace(/^./, value => value.toUpperCase());
    const control = pack.control(uri, undefined, { documentVersion: pack.pin.schemaVersion, schemaValid: !draft, isOverride: false, diagnostics: [], parentSchemaUri: parentUri }, 'hide-defaults'); return { uri, parentUri, title, description: completeDescription, annotation: help.annotation, suggested: control.suggested, hasSuggestion: control.hasSuggestion, choices: (vocabulary?.choices?.length ? vocabulary.choices : help.choices).filter((choice: unknown) => ['string', 'number', 'boolean'].includes(typeof choice)) as Array<string | number | boolean> };
  } catch { return undefined; }
}

function human(value: unknown) { if (value === null || value === undefined) return ''; if (typeof value === 'object') return JSON.stringify(value); return String(value); }
function vocabularyLabel(pack: MetadataPack | undefined, capability: string) {
  try { return pack ? pack.resource(pack.manifest.vocabulary_uri).capabilities?.[capability]?.label ?? capability : capability; } catch { return capability; }
}
export function explainAssessment(value: Json, pack?: MetadataPack): string {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('assessment' in value)) return 'No Assessment explanation is available for this document.';
  const assessment: any = (value as any).assessment; const tests = assessment?.tests;
  if (!tests || typeof tests !== 'object') return assessment?.mode === 'manual' ? 'Manual Assessment: follow the authored procedure and record the declared response.' : 'Assessment has no automated Test explanation yet.';
  const test: any = Object.values(tests)[0]; if (!test) return 'Assessment has no automated Test explanation yet.';
  const capability = vocabularyLabel(pack, test.capability); const objectValues = Object.entries(test.object ?? {}).flatMap(([name, predicate]: any) => predicate && typeof predicate === 'object' ? Object.entries(predicate).map(([operation, operand]) => `${name.replaceAll('_', ' ')} ${operation.replaceAll('_', ' ')} ${human(operand)}`) : [`${name.replaceAll('_', ' ')} ${human(predicate)}`]);
  const requirement: any = test.require ?? {}; const item = requirement.item_requirement ?? {}; const field = requirement.field_requirement ?? {}; const itemText = item.items_found ? `at least ${item.items_found.replaceAll('_', ' ')} collected Item(s)` : 'the required collected Items'; const satisfyText = item.items_satisfying ? ` and ${item.items_satisfying.replaceAll('_', ' ')} selected Item(s) must satisfy the condition` : '';
  const fieldText = field.values_matching ? `; ${field.values_matching.replaceAll('_', ' ')} found field values must match` : ''; const predicates = Object.entries(requirement.fields ?? {}).flatMap(([name, predicate]: any) => predicate && typeof predicate === 'object' ? Object.entries(predicate).map(([operation, operand]) => `${name.replaceAll('_', ' ')} ${operation.replaceAll('_', ' ')} ${human(operand)}`) : []).join(' and ');
  const condition = predicates ? `: ${predicates}` : '';
  const evaluate = assessment.evaluate && typeof assessment.evaluate === 'object' && !Array.isArray(assessment.evaluate)
    ? ` Assessment evaluation uses the authored ${Object.keys(assessment.evaluate).join('/')} alternative; this describes selection semantics only.` : '';
  const inputGuard = assessment.evaluate?.if?.input_provided;
  const inputFallback = assessment.evaluate?.else?.not_evaluated ? `else not_evaluated (${assessment.evaluate.else.not_evaluated.reason ?? 'authored fallback'})` : 'otherwise follow the authored else outcome';
  const inputBranch = assessment.inputs && inputGuard
    ? ` The optional Input branch is authored as: when '${inputGuard}' is provided, continue with the selected branch; ${inputFallback}. Missing, empty and not-evaluated states are not inferred here.` : '';
  const variableChain = assessment.variables ? ` Authored Variables remain in the collection chain (${Object.keys(assessment.variables).join(', ')}); the editor does not execute them.` : '';
  return `Collect ${capability}${objectValues.length ? ` (${objectValues.join(', ')}` : ''}${objectValues.length ? ')' : ''}; pass conditions require ${itemText}${satisfyText}${fieldText}${condition}.${evaluate}${inputBranch}${variableChain} This is an authoring explanation, not a scanner result.`;
}

function objectSelectorContext(assessment: any, path: EditPath) {
  if (path[0] !== 'assessment' || path.at(-1) !== 'equals' && path.at(-1) !== 'variable') return undefined;
  const objectIndex = path.lastIndexOf('object');
  if (objectIndex >= 0 && objectIndex + 2 === path.length - 1) {
    let object: any = { assessment };
    for (const part of path.slice(0, objectIndex + 1)) object = object?.[part as any];
    const capability = object?.capability || (path[1] === 'tests' ? assessment?.tests?.[String(path[2])]?.capability : undefined);
    return typeof capability === 'string' ? { capability, field: String(path[objectIndex + 1]) } : undefined;
  }
  if (path[1] === 'shared_objects' && path.length === 5) {
    const object = assessment?.shared_objects?.[String(path[2])];
    return typeof object?.capability === 'string' ? { capability: object.capability, field: String(path[3]) } : undefined;
  }
  return undefined;
}
/** Allowed scalar Object values from the pinned capability-specific schema.
 * Resolve the actual property and comparison branch, not arbitrary YAML paths.
 */
/** Resolve capability-specific selector options wherever a collected Object is authored:
 * inline Test Objects, Shared Objects, and nested Variable collection expressions.
 * The pinned capability schema is the only source of enum options.
 */
/** Finite selector values must come from the same capability map as YAML completion. */
function objectScalarChoices(pack: MetadataPack | undefined, assessment: any, path: EditPath): string[] {
  if (!pack) return [];
  const context = objectSelectorContext(assessment, path);
  if (!context) return [];
  try { return selectorValueChoices(pack, context.capability, context.field, 'equals', false).map(choice => choice.value); }
  catch { return []; }
}
function testChoiceOptions(pack: MetadataPack | undefined, path: EditPath): string[] {
  if (!pack || path[0] !== 'assessment') return [];
  if (path.at(-1) === 'capability') {
    const testCapability = path[1] === 'tests' && path.length === 4;
    const sharedCapability = path[1] === 'shared_objects' && path.length === 4;
    const nestedObjectCapability = path[1] === 'variables' && path.includes('object') &&
      path[path.length - 2] === 'object';
    if (testCapability || sharedCapability || nestedObjectCapability)
      return Object.keys(pack.manifest.capabilities || {}).sort();
  }
  if (path[1] === 'tests' && path.length === 4 && path[3] === 'reported_elements') {
    const schemaUri = pack.manifest.resources.find((resource: any) =>
      resource.kind === 'schema' && resource.uri.endsWith('/reported-elements.schema.json'))?.uri;
    if (!schemaUri) return [];
    const choices = new Set<string>();
    for (const location of schemaNodes(pack, schemaUri)) {
      if (Array.isArray(location.node.enum)) for (const value of location.node.enum)
        if (typeof value === 'string') choices.add(value);
      if (typeof location.node.const === 'string') choices.add(location.node.const);
    }
    return [...choices];
  }
  return [];
}
/** Schema-derived comparison operations for the authored scalar mapping.
 * Object selectors use the actual capability schema, whereas Require fields
 * use the shared scalar predicate grammar. No per-capability operator lists.
 */
/** Capability-scoped operations shared with the Red Hat YAML completion adapter.
 * Never expand a single selector to the generic all-datatype vocabulary.
 */
type PredicateDefinition = 'scalar_field_predicate' | 'record_field_predicate' | 'object_record_field_predicate';
const logicalGroupKeys = new Set(['and', 'or', 'one', 'xor']);

function nestedPredicateDefinition(pack: MetadataPack, capability: string, parent: EditPath, requireIndex: number): PredicateDefinition | undefined {
  const schemaUri = pack.manifest.capabilities[capability]?.schema_uri;
  if (!schemaUri) return undefined;
  // Resolve the canonical state predicate at the authored field path. Record
  // member names are dynamic schema properties, so the resolver intentionally
  // walks `additionalProperties` rather than maintaining a field registry.
  const relative = parent.slice(requireIndex + 1)
    .filter((part): part is string => typeof part !== 'number' && !logicalGroupKeys.has(String(part)));
  if (relative[0] === 'fields') relative.shift();
  if (!relative.length) return undefined;
  try {
    const entries = schemaPropertiesAtPath(pack, `${schemaUri}#/$defs/state_predicate`, relative);
    if (!['equals', 'not_equal', 'matches_regex'].some(operation => entries.has(operation))) return undefined;
    const hasRecord = relative.includes('record');
    return hasRecord ? 'record_field_predicate' : undefined;
  } catch { return undefined; }
}

function canonicalRequireOperation(pack: MetadataPack, capability: string, path: EditPath, requireIndex: number): boolean {
  const candidate = path.at(-1);
  if (typeof candidate !== 'string' || !candidate) return false;
  const schemaUri = pack.manifest.capabilities[capability]?.schema_uri;
  if (!schemaUri) return false;
  const relative = path.slice(requireIndex + 1, -1)
    .filter((part): part is string => typeof part !== 'number' && !logicalGroupKeys.has(String(part)));
  if (relative[0] === 'fields') relative.shift();
  if (!relative.length) return false;
  try {
    const operation = schemaPropertiesAtPath(pack, `${schemaUri}#/$defs/state_predicate`, relative).get(candidate);
    // Scalar comparison properties are oneOf unions (literal, Variable and
    // Input branches). Cardinality controls and datatype declarations are
    // $refs/primitive properties and must never enter the operator editor.
    return Boolean(operation?.node && Array.isArray(operation.node.oneOf));
  } catch { return false; }
}

function comparisonContext(pack: MetadataPack | undefined, assessment: any, path: EditPath) {
  if (!pack || path[0] !== 'assessment' || path.length < 5) return undefined;
  const parent = path.slice(0, -1);
  const objectPath = parent.concat('equals');
  const objectContext = objectSelectorContext(assessment, objectPath);
  if (objectContext && parent.at(-1) === objectContext.field) return { ...objectContext, requireField: false };
  const requireIndex = parent.indexOf('require');
  const fieldsIndex = parent.lastIndexOf('fields');
  if (requireIndex < 0 || fieldsIndex <= requireIndex || fieldsIndex + 1 >= parent.length || parent[1] !== 'tests') return undefined;
  const capability = assessment?.tests?.[String(parent[2])]?.capability;
  const field = String(parent[fieldsIndex + 1]);
  // Direct fields, logical-group fields, and record member fields all use the
  // same scalar predicate contract at their nearest `fields` mapping. A
  // record member is resolved from the canonical state schema, not guessed
  // from the capability name or a GUI-only registry.
  if (parent.length !== fieldsIndex + 2) return undefined;
  if (typeof capability !== 'string' || !canonicalRequireOperation(pack, capability, path, requireIndex)) return undefined;
  const predicateDefinition = nestedPredicateDefinition(pack, capability, parent, requireIndex);
  return typeof capability === 'string' ? { capability, field, requireField: true, predicateDefinition } : undefined;
}

function comparisonDescriptor(pack: MetadataPack | undefined, assessment: any, path: EditPath) {
  if (!pack) return undefined;
  const tail = String(path.at(-1) ?? '');
  const operationPath = tail === 'variable' || tail === 'input' ? path.slice(0, -1) : path;
  const context = comparisonContext(pack, assessment, operationPath);
  if (!context) return undefined;
  return { ...context, operationPath, operation: String(operationPath.at(-1)), source: tail === 'variable' || tail === 'input' ? tail : 'fixed' };
}

function authoredComparisonDatatype(assessment: any, operationPath: EditPath): string | undefined {
  const datatype = operationPath.slice(0, -1).concat('datatype');
  let value: any = assessment;
  for (const part of datatype.slice(1)) value = value?.[part as any];
  return typeof value === 'string' ? value : undefined;
}

export function comparisonValueSources(pack: MetadataPack | undefined, assessment: any, path: EditPath): string[] {
  const descriptor = comparisonDescriptor(pack, assessment, path);
  if (!descriptor || !pack) return [];
  try { return expressionContract(pack, descriptor.capability, descriptor.field, descriptor.requireField ? 'require' : 'object', descriptor.predicateDefinition).operatorSources[descriptor.operation] ?? []; }
  catch { return []; }
}

export function comparisonOperatorDescriptions(pack: MetadataPack | undefined, assessment: any, path: EditPath, includeIncompatible = false): Record<string, string> {
  const descriptor = comparisonDescriptor(pack, assessment, path);
  if (!descriptor || !pack) return {};
  try {
    const contract = expressionContract(pack, descriptor.capability, descriptor.field, descriptor.requireField ? 'require' : 'object', descriptor.predicateDefinition);
    const result = { ...contract.operatorDocumentation };
    if (includeIncompatible && descriptor.operation && !Object.hasOwn(result, descriptor.operation)) result[descriptor.operation] = 'Authored operator is not valid for the selected datatype.';
    return result;
  } catch { return {}; }
}

export function comparisonOperations(pack: MetadataPack | undefined, assessment: any, path: EditPath, includeIncompatible = false): string[] {
  const descriptor = comparisonDescriptor(pack, assessment, path);
  if (!descriptor || !pack) return [];
  try {
    const contract = expressionContract(pack, descriptor.capability, descriptor.field, descriptor.requireField ? 'require' : 'object', descriptor.predicateDefinition);
    const allowed = contract.operators.map(choice => choice.value);
    if (includeIncompatible && descriptor.operation && !allowed.includes(descriptor.operation)) return [...allowed, descriptor.operation];
    return allowed.includes(descriptor.operation) ? allowed : [];
  } catch { return []; }
}

function comparisonValueChoices(pack: MetadataPack | undefined, assessment: any, path: EditPath): string[] {
  const descriptor = comparisonDescriptor(pack, assessment, path);
  if (!descriptor || !pack) return [];
  try {
    const contract = expressionContract(pack, descriptor.capability, descriptor.field, descriptor.requireField ? 'require' : 'object', descriptor.predicateDefinition);
    return contract.fixedChoicesByOperator[descriptor.operation] ?? [];
  } catch { return []; }
}

function comparisonFixedChoices(pack: MetadataPack | undefined, assessment: any, path: EditPath): string[] {
  const current = comparisonValueChoices(pack, assessment, path);
  if (current.length) return current;
  const descriptor = comparisonDescriptor(pack, assessment, path);
  if (!descriptor || !pack) return [];
  try {
    const contract = expressionContract(pack, descriptor.capability, descriptor.field, descriptor.requireField ? 'require' : 'object', descriptor.predicateDefinition);
    return contract.fixedChoicesByOperator.equals ?? [];
  } catch { return []; }
}

export function comparisonVariableCompatible(pack: MetadataPack | undefined, assessment: any, path: EditPath, variableId: string): boolean {
  const descriptor = comparisonDescriptor(pack, assessment, path);
  const variable = assessment?.variables?.[variableId];
  if (!descriptor || !variable) return false;
  // Exactly one active 0.4.1 grammar. Types are inferred from expressions,
  // never from an obsolete declaration datatype or numeric-looking strings.
  if (Object.hasOwn(variable, 'datatype')) return false;
  const datatype = inferredVariableDatatype(assessment, variableId);
  if (!datatype) return false; // Ambiguous collected fields require a type proof.
  const datatypes = selectorFieldDatatypes(pack!, descriptor.capability, descriptor.field, descriptor.requireField);
  return !datatypes.length || datatypes.includes(datatype);
}

/** Return contextual authoring help from the exact pinned capability predicate. */
function contextualFieldDescription(pack: MetadataPack | undefined, assessment: any, path: EditPath): string {
  if(!pack||path[0]!=='assessment')return '';
  const selector = objectSelectorContext(assessment, path);
  if (selector) {
    const capability = selector.capability;
    const capabilityPin = (pack.manifest.capabilities as any)?.[capability];
    const fieldName = selector.field;
    if (capabilityPin) {
      try {
        const mapping: any = pack.resource(capabilityPin.mapping_uri);
        const semantic = mapping.native?.selector_case_semantics?.[fieldName];
        if (semantic?.description) return 'Select the '+fieldName.replaceAll('_',' ')+' value for '+capability+'. '+semantic.description;
      } catch {}
      try {
        const context = { documentVersion: pack.pin.schemaVersion, schemaValid: true, isOverride: false, diagnostics: [] as string[] };
        const hint = pack.describe(capabilityPin.schema_uri+'#/$defs/object/properties/'+fieldName.replaceAll('~','~0').replaceAll('/','~1'), context);
        if (hint.description) return hint.description;
      } catch {}
    }
  }
  const reqIndex=path.indexOf('require');
  if(reqIndex>=0&&path[reqIndex+1]==='fields'&&path.length>reqIndex+2){
    const cap=assessment?.tests?.[String(path[2])]?.capability;
    const name=String(path[reqIndex+2]);
    try{
      const catalog=new GuidedCatalog(pack);
      const field=catalog.resultFields(cap).find(entry=>entry.name===name);
      if(field?.description)return 'Compare collected '+name.replaceAll('_',' ')+' values. '+field.description;
    }catch{}
    return 'Compare collected '+name.replaceAll('_',' ')+' values using the canonical scalar comparison vocabulary.';
  }
  return '';
}
/** Never show authoring-implementation metadata as end-user field help. */
function usefulFieldHelp(schemaDescription:string|undefined, assessment:any, path:EditPath, contextual:string):string {
  const schemaText=String(schemaDescription||'').trim();
  const contextualText=String(contextual||'').trim();
  // Metadata may describe a datatype constraint in implementation terminology.
  // Present the intended authoring guidance instead, without inventing semantics.
  if(path.includes('require') && path.includes('fields') && path.at(-1)==='datatype' &&
     /redundant explicit datatype|self.describing comparison|omitted datatype remains valid/i.test(schemaText))
    return 'Optional datatype declaration. If specified, it must agree with the comparison value type.';
  const generic=/explicit new.authoring selection|preserve source.effective values|selector operator;|visible overrides; no runtime fallback/i;
  const genericComparison=/Compare the observed value|Compare observed and expected|Native typed comparison equivalent|A redundant explicit datatype/i;
  const requireField=path.includes('require')&&path.includes('fields')&&path.length>path.indexOf('fields')+1;
  if(requireField&&(genericComparison.test(schemaText)||!schemaText)&&contextualText)return contextualText;
  if(schemaText&&!generic.test(schemaText))return schemaText;
  if(contextualText&&!generic.test(contextualText))return contextualText;
  const objectIndex=path.lastIndexOf('object');
  if(objectIndex>=0&&objectIndex<path.length-1){
    let object:any={assessment};
    for(const part of path.slice(0,objectIndex+1))object=object?.[part as any];
    const cap=object?.capability||(path[1]==='tests'?assessment?.tests?.[String(path[2])]?.capability:undefined);
    const field=String(path[objectIndex+1]).replaceAll('_',' ');
    return 'Select the '+field+' value used by '+String(cap||'this capability')+
      ' to identify collected items. Only supported comparisons are offered.';
  }
  const req=path.indexOf('require');
  if(req>=0&&path[req+1]==='fields'&&path.length>req+2){
    return 'Comparison applied to the collected '+String(path[req+2]).replaceAll('_',' ')+
      ' field. Only operators supported by this capability are available.';
  }
  return generic.test(schemaText)?'':schemaText;
}
function assessmentVariableChoices(assessment:any,path:EditPath):string[]|undefined {
  if(path.at(-1)!=='variable')return undefined;
  const inTest=path[1]==='tests'&&path[3]==='object';
  const inShared=path[1]==='shared_objects';
  if(!inTest&&!inShared)return undefined;
  return Object.keys(assessment?.variables||{})
}
function schemaPointerPath(pointer: string): EditPath {
  if (!pointer) return [];
  return pointer.split('/').slice(1).map(part => {
    const decoded = part.replace(/~1/g, '/').replace(/~0/g, '~');
    return /^\d+$/.test(decoded) ? Number(decoded) : decoded;
  });
}
function schemaDiagnostic(error: any) {
  const instancePath = String(error.instancePath ?? '');
  const message = `${instancePath || '/'}: ${error.message ?? 'schema validation error'}`;
  return { path: schemaPointerPath(instancePath), instancePath, schemaPath: String(error.schemaPath ?? ''), keyword: String(error.keyword ?? ''), message };
}

function parseAuthoringDocument(document: any): { value: any; draft: boolean; diagnostics: string[] } {
  const text = document.getText();
  try { return { value: new SourceBuffer(text).json(), draft: false, diagnostics: [] }; }
  catch (error) {
    try {
      const parsed: any = parseDocument(text, { uniqueKeys: false, keepSourceTokens: true });
      const value = parsed.toJS({ maxAliasCount: 50 });
      const diagnostics: string[] = [...new Set<string>((parsed.errors ?? []).map((item: any) => item.message || String(item)))];
      return { value: value ?? {}, draft: true, diagnostics: diagnostics.length ? diagnostics : [error instanceof Error ? error.message : String(error)] };
    } catch (draftError) {
      return { value: {}, draft: true, diagnostics: [draftError instanceof Error ? draftError.message : String(draftError)] };
    }
  }
}

function schemaLocationsForValuePath(pack: MetadataPack, root: string, path: EditPath) {
  let locations = schemaNodes(pack, root);
  for (const part of path) {
    if (typeof part === 'number') {
      locations = schemaItemLocations(pack, locations).flatMap(location => schemaNodes(pack, location.uri));
      continue;
    }
    const property = schemaPropertyEntries(pack, locations).get(part);
    if (property) {
      locations = schemaNodes(pack, property.uri);
      continue;
    }
    const additional = schemaDynamicPropertyLocations(pack, locations, String(part));
    if (additional.length) {
      locations = additional.flatMap(location => schemaNodes(pack, location.uri));
      continue;
    }
    return [];
  }
  return locations;
}
function structuralSchemaSummary(pack: MetadataPack, locations: any[]) {
  const properties = new Map<string, any>();
  const required = new Set<string>();
  for (const location of locations) {
    for (const name of location.node?.required ?? []) required.add(String(name));
    for (const [name, property] of schemaPropertyEntries(pack, [location])) {
      if (!properties.has(name)) {
        const nodes = schemaNodes(pack, property.uri);
        const first = nodes[0]?.node ?? property.node;
        properties.set(name, {
          name,
          title: String(first.title ?? name.replaceAll('_', ' ')),
          description: String(first.description ?? ''),
          type: Array.isArray(first.type) ? first.type : first.type,
          enum: Array.isArray(first.enum) ? first.enum : undefined,
          default: first.default,
          required: false,
          object: nodes.some(item => item.node?.type === 'object' || item.node?.properties || item.node?.additionalProperties !== undefined),
          array: nodes.some(item => item.node?.type === 'array' || item.node?.items)
        });
      }
    }
  }
  for (const name of required) if (properties.has(name)) properties.get(name).required = true;
  const additional = schemaDynamicPropertyLocations(pack, locations).length > 0;
  const itemLocations = schemaItemLocations(pack, locations);
  const item = itemLocations.length ? {
    object: itemLocations.some(location => location.node?.type === 'object' || location.node?.properties || location.node?.patternProperties || location.node?.additionalProperties !== undefined),
    array: itemLocations.some(location => location.node?.type === 'array' || location.node?.items),
    type: itemLocations[0]?.node?.type
  } : undefined;
  return { properties: [...properties.values()], additional, item };
}
function structuralNodes(pack: MetadataPack | undefined, root: string | undefined, value: any, path: EditPath = ['assessment']): any[] {
  if (!pack || !root || !value || typeof value !== 'object') return [];
  const locations = schemaLocationsForValuePath(pack, root, path);
  const summary = structuralSchemaSummary(pack, locations);
  const currentKeys = Array.isArray(value) ? value.map((_entry, index) => String(index)) : Object.keys(value);
  const result = [{ path, kind: Array.isArray(value) ? 'array' : 'map', currentKeys, ...summary }];
  if (Array.isArray(value)) value.forEach((entry, index) => result.push(...structuralNodes(pack, root, entry, [...path, index])));
  else Object.entries(value).forEach(([key, entry]) => result.push(...structuralNodes(pack, root, entry, [...path, key])));
  return result;
}

export function modelFor(document: any, pack?: MetadataPack) {
  try {
    const parsed = parseAuthoringDocument(document); const value = parsed.value; const root = schemaRoot(pack, value);
    // A parseable document can still violate the pinned schema. Keep those
    // diagnostics separate from YAML parse errors and make the value-aware
    // default policy conservative: invalid authored values must stay visible.
    const schemaDiagnostics = pack && root && !parsed.draft ? pack.validateDetailed(root, value as Json).map(schemaDiagnostic) : [];
    const diagnostics = [...parsed.diagnostics, ...schemaDiagnostics.map((error: any) => error.message)];
    const schemaValid = !parsed.draft && schemaDiagnostics.length === 0;
    const fields = scalarEntries(value).map(field => {
      const help = schemaHelp(pack, root, field.path, parsed.draft);
      const parentValue = field.path.length > 1 ? field.path.slice(0, -1).reduce((parent: any, part: string | number) => parent?.[part as any], value) : undefined;
      const control = help && pack ? pack.control(help.uri, field.value, { documentVersion: pack.pin.schemaVersion, schemaValid, isOverride: false, diagnostics, parentValue, parentSchemaUri: help.parentUri }, 'hide-defaults') : undefined;
      const hidden = control?.hidden ?? false;
      const variableChoices = assessmentVariableChoices((value as any)?.assessment, field.path);
      const testChoices = testChoiceOptions(pack, field.path);
      const descriptor = comparisonDescriptor(pack, (value as any)?.assessment, field.path);
      const comparisonChoices = comparisonValueChoices(pack, (value as any)?.assessment, field.path);
      const scalarChoices = objectScalarChoices(pack, (value as any)?.assessment, field.path);
      const sourceChoices = comparisonValueSources(pack, (value as any)?.assessment, field.path);
      const expressionVariableChoices = sourceChoices.includes('variable') && descriptor ? Object.keys((value as any)?.assessment?.variables || {}).filter(id => comparisonVariableCompatible(pack, (value as any)?.assessment, descriptor.operationPath, id)) : [];
      const expressionInputChoices = sourceChoices.includes('input') ? Object.keys((value as any)?.assessment?.inputs || {}) : [];
      const choices = descriptor?.source === 'variable' ? expressionVariableChoices : descriptor?.source === 'input' ? expressionInputChoices : variableChoices ?? (testChoices.length ? testChoices : (comparisonChoices.length ? comparisonChoices : (scalarChoices.length ? scalarChoices : help?.choices || [])));
      const legalOperators = descriptor ? comparisonOperations(pack, (value as any)?.assessment, descriptor.operationPath) : [];
      const operatorChoices = descriptor ? comparisonOperations(pack, (value as any)?.assessment, descriptor.operationPath, true) : [];
      const operatorDescriptions = descriptor ? comparisonOperatorDescriptions(pack, (value as any)?.assessment, descriptor.operationPath, true) : {};
      const fixedChoices = descriptor ? comparisonFixedChoices(pack, (value as any)?.assessment, descriptor.operationPath) : [];
      const valueSources = descriptor ? sourceChoices : [];
      return {
        ...field,
        label: help?.title || pathLabel(field.path),
        description: usefulFieldHelp(help?.description, (value as any)?.assessment, field.path, contextualFieldDescription(pack, (value as any)?.assessment, field.path)),
        choices,
        pickerOnly: variableChoices !== undefined,
        operatorChoices,
        operatorDescriptions,
        comparisonOperation: descriptor?.operation,
        comparisonPath: descriptor?.operationPath,
        valueSource: descriptor?.source,
        valueSources,
        variableChoices: expressionVariableChoices,
        inputChoices: expressionInputChoices,
        operatorCompatible: descriptor && operatorChoices.length ? legalOperators.includes(descriptor.operation) : undefined,
        fixedChoices: fixedChoices.length ? fixedChoices : (field.path.at(-1) === 'equals' ? scalarChoices : objectScalarChoices(pack, (value as any)?.assessment, [...field.path.slice(0, -1), 'equals'])),
        // Use the value-aware control metadata so object-level defaults (for
        // example the complete field_requirement pair) are exposed on each
        // scalar child without inventing a second default registry.
        suggested: control?.suggested ?? help?.suggested,
        hasSuggestion: control?.hasSuggestion ?? help?.hasSuggestion ?? false,
        hidden,
        kind: field.value === null ? 'null' : typeof field.value
      };
    });
    const variableDraft = pack && value?.assessment && typeof value.assessment === 'object' ? analyzeVariables(pack, value.assessment, true).diagnostics.some(item => item.code.startsWith('incomplete-')) : false;
    return { ok: true, draft: parsed.draft || variableDraft, schemaValid, parseDiagnostics: parsed.diagnostics, schemaDiagnostics, diagnostics, revision: sha256(document.getText()), version: document.version, explanation: explainAssessment(value, pack), fields, structuralNodes: structuralNodes(pack, root, value, []) };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error), fields: [] }; }
}

function evaluationText(value: any): string {
  if (Array.isArray(value)) return value.map(evaluationText).join(' and ');
  if (!value || typeof value !== 'object') return 'no authored evaluation tree';
  if (typeof value.test === 'string') return value.test;
  return Object.entries(value).map(([operator, branch]) => `${operator.toUpperCase()} (${evaluationText(branch)})`).join(' ');
}
export function requireLogicalOperations(pack?: MetadataPack): string[] {
  if (!pack) return [];
  try {
    const schema: any = pack.resource(`https://scap-ng.dev/schema/v${pack.pin.schemaVersion}/assessment-language.schema.json`);
    const branches = schema.$defs?.canonical_condition?.oneOf;
    if (!Array.isArray(branches)) return [];
    const operations = new Set<string>();
    for (const branch of branches) for (const name of branch.required ?? [])
      if (branch.properties?.[name]?.type === 'array') operations.add(String(name));
    return [...operations];
  } catch { return []; }
}

function evaluationControl(value: any, pack?: MetadataPack) {
  if (!pack) return undefined;
  const operations = new GuidedCatalog(pack).logicalOperators().map(option => option.value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { path: ['assessment', 'evaluate'], operations };
  if (value.if) return undefined;
  const operation = Object.keys(value).find(key => operations.includes(key));
  return { path: ['assessment', 'evaluate'], operation, operations };
}
function samePath(left: (string | number)[], right: (string | number)[]) { return left.length === right.length && left.every((part, index) => part === right[index]); }
function fieldAt(fields: any[], path: (string | number)[]) { return fields.find(field => samePath(field.path, path)); }
function objectFieldLabel(_capability: string, _name: string, fallback: string) {
  // Labels come from the pinned capability vocabulary/schema at the call site.
  // Keep this adapter only for future presentation-only fallbacks.
  return fallback;
}
function operationKey(value: any) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).find(key => !['datatype', 'values_found', 'values_matching', 'value_match', 'redact_result'].includes(key)) : undefined; }
function predicateControl(fields: any[], mappingPath: (string | number)[], name: string, definition: any, label: string) {
  const operation = operationKey(definition); if (!operation) return { name, label, mappingPath, operation: undefined, value: undefined, valuePath: undefined, choices: [], unsupported: true };
  const valuePath = [...mappingPath, operation]; const scalar = fieldAt(fields, valuePath); const rawValue = definition[operation];
  return { name, label, mappingPath, operation, value: rawValue, valuePath, choices: scalar?.choices ?? [], description: scalar?.description ?? '', operations: [], regexPatterns: operation === 'matches_regex' ? (Array.isArray(rawValue) ? rawValue.map(String) : [String(rawValue)]) : [], unsupported: !scalar && !Array.isArray(rawValue) };
}
export function assessmentEditorModel(document: any, pack?: MetadataPack) {
  const parsed = parseAuthoringDocument(document);
  const base: any = modelFor(document, pack); if (!base.ok) return base;
  base.schemaVersion = pack?.pin.schemaVersion; base.packSha256 = pack?.pin.manifestSha256;
  const value: any = parsed.value; const assessment = value.assessment;
  // Keep the authored root-member names separate from the presentation
  // object returned below. The graphical tree must not mistake derived
  // helpers (title, evaluationControl, inputControls, etc.) for YAML keys.
  base.authoredAssessmentKeys = assessment && typeof assessment === 'object' && !Array.isArray(assessment)
    ? Object.keys(assessment) : [];
  const referenceAnalysis = assessment && typeof assessment === 'object' && !Array.isArray(assessment)
    ? analyzeAssessmentReferences(assessment) : undefined;
  // Webview models must remain structured-clone serializable; keep the
  // analyzer's callable lookup API in the host and expose only its receipt.
  base.referenceAnalysis = referenceAnalysis ? {
    definitions: referenceAnalysis.definitions,
    references: referenceAnalysis.references,
    unresolved: referenceAnalysis.unresolved
  } : undefined;
  // The graphical Variables inspector needs the authored expression structure,
  // not only the flattened scalar control list. This is read-only presentation
  // data derived from the same authoritative YAML document.
  base.variableDefinitions = assessment && typeof assessment === 'object' && !Array.isArray(assessment) ? (assessment.variables ?? {}) : {};
  base.variableExpressionOperations = variableExpressionOperations(pack);
  base.requireLogicalOperations = requireLogicalOperations(pack);
  if (pack && assessment && typeof assessment === 'object' && !Array.isArray(assessment)) {
    const variableAnalysis = analyzeVariables(pack, assessment, Boolean(base.draft));
    base.variableAnalysis = variableAnalysis;
    base.variableDiagnostics = variableAnalysis.diagnostics;
    base.variableAnalysisSummary = variableAnalysisSummary(variableAnalysis);
  }
  // Preserve the authored Require hierarchy for explanation of population, predicates
  // and ordered regex arrays. Edits still target original source scalar paths.
  base.requireDefinitions = assessment && typeof assessment === 'object' && !Array.isArray(assessment) && assessment.tests && typeof assessment.tests === 'object' ? Object.fromEntries(Object.entries(assessment.tests).map(([testId, test]: [string, any]) => [testId, test?.require ?? {}])) : {};
  base.sharedObjectDefinitions = assessment && typeof assessment === 'object' && !Array.isArray(assessment) && assessment.shared_objects && typeof assessment.shared_objects === 'object' ? assessment.shared_objects : {};
  if (!assessment || typeof assessment !== 'object' || !assessment.tests || typeof assessment.tests !== 'object') return { ...base, assessment: undefined, hiddenCount: base.fields.filter((field: any) => field.hidden).length };
  const catalog = pack ? new GuidedCatalog(pack) : undefined; const tests = Object.entries(assessment.tests).map(([id, test]: [string, any]) => {
    const path = ['assessment', 'tests', id]; const titlePath = [...path, 'test_title']; const titleField = fieldAt(base.fields, titlePath); const controls: any[] = [];
    for (const [name, predicate] of Object.entries(test.object ?? {})) if (predicate && typeof predicate === 'object' && !Array.isArray(predicate)) controls.push({ kind: 'object', ...predicateControl(base.fields, [...path, 'object', name], name, predicate, objectFieldLabel(test.capability, name, catalog?.objectFields(test.capability).find(field => field.name === name)?.label ?? name.replaceAll('_', ' '))), definition: catalog?.objectFields(test.capability).find(field => field.name === name) });
    const requirement = test.require ?? {}; const itemControls = Object.entries(requirement.item_requirement ?? {}).map(([name, current]) => { const control = fieldAt(base.fields, [...path, 'require', 'item_requirement', name]); return { name, label: name === 'items_found' ? 'Items found' : 'Items satisfying', path: [...path, 'require', 'item_requirement', name], value: current, choices: control?.choices ?? [], suggested: control?.suggested, hasSuggestion: control?.hasSuggestion ?? false, hidden: control?.hidden ?? false }; });
    const fieldRequirement = Object.entries(requirement.field_requirement ?? {}).map(([name, current]) => { const control = fieldAt(base.fields, [...path, 'require', 'field_requirement', name]); return { name, label: name === 'values_found' ? 'Field values found' : 'Field values matching', path: [...path, 'require', 'field_requirement', name], value: current, choices: control?.choices ?? [], suggested: control?.suggested, hasSuggestion: control?.hasSuggestion ?? false, hidden: control?.hidden ?? false }; });
    const fieldControls = Object.entries(requirement.fields ?? {}).map(([name, predicate]) => ({ kind: 'field', ...predicateControl(base.fields, [...path, 'require', 'fields', name], name, predicate, name.replaceAll('_', ' ')), operations: catalog?.operations() ?? [] }));
    return { id, path, title: test.test_title ?? id, titlePath, titleField, capability: test.capability, capabilityLabel: catalog ? catalog.capabilities().find(option => option.value === test.capability)?.label ?? test.capability : test.capability, objectControls: controls, itemControls, fieldRequirement, fieldControls, requireFieldOptions: catalog?.resultFields(test.capability) ?? [], explanation: explainAssessment({ assessment: { ...assessment, tests: { [id]: test } } }, pack), unsupported: Object.keys(test).filter(key => !['test_title', 'capability', 'object', 'require', 'reported_elements'].includes(key)) };
  });
  const inputControls = Object.entries(assessment.inputs ?? {}).flatMap(([name, input]: [string, any]) => {
    if (!input || typeof input !== 'object') return [];
    return [{ name, label: `Input: ${name}`, description: input.description ?? 'Optional author-supplied value', controls: Object.keys(input).filter(key => ['datatype', 'required', 'description', 'cardinality'].includes(key)).map(key => ({ label: key.replaceAll('_', ' '), path: ['assessment', 'inputs', name, key], value: input[key], choices: fieldAt(base.fields, ['assessment', 'inputs', name, key])?.choices ?? [] })) }];
  });
  return { ...base, assessment: { id: assessment.id, title: assessment.assessment_title, mode: assessment.mode, evaluate: assessment.evaluate, evaluationControl: evaluationControl(assessment.evaluate, pack), evaluationExplanation: assessment.evaluate ? `Authored evaluation tree: ${evaluationText(assessment.evaluate)}. This describes logical selection only; no Test has been executed.` : '', inputControls, tests }, hiddenCount: base.fields.filter((field: any) => field.hidden).length };
}
