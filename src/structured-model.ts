import { MetadataPack, sha256, type Json } from './metadata.js';
import { SourceBuffer } from './source.js';
import { GuidedCatalog } from './guided.js';
import { schemaNodes } from './schema-resolver.js';
import { selectorOperatorChoices, selectorValueChoices } from './completion.js';

type EditPath = (string | number)[];
function scalarEntries(value: Json, path: EditPath = []): Array<{ path: EditPath; value: Json }> {
  if (Array.isArray(value)) return value.flatMap((entry, index) => scalarEntries(entry, [...path, index]));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => scalarEntries(entry, [...path, key]));
  return [{ path, value }];
}
function pathLabel(path: EditPath) { return path.map(part => typeof part === 'number' ? `[${part}]` : part).join('.').replaceAll('.[', '['); }
function schemaRoot(pack?: MetadataPack) {
  return pack?.manifest.resources.find((resource: any) => resource.kind === 'schema' && /\/assessment\.schema\.json$/.test(resource.uri))?.uri as string | undefined;
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
function schemaHelp(pack: MetadataPack | undefined, root: string | undefined, path: EditPath) {
  if (!pack || !root || !path.length) return undefined;
  try {
    const uri = schemaForPath(pack, root, path); if (!uri) return undefined;
    const help = pack.describe(uri, { documentVersion: '0.4.0', schemaValid: true, isOverride: false, diagnostics: [] });
    const control = pack.control(uri, undefined, { documentVersion: pack.pin.schemaVersion, schemaValid: true, isOverride: false, diagnostics: [] }, 'hide-defaults'); return { uri, title: help.title, description: help.description, annotation: help.annotation, suggested: help.suggested, hasSuggestion: help.hasSuggestion, choices: help.choices.filter((choice: Json) => ['string', 'number', 'boolean'].includes(typeof choice)) as Array<string | number | boolean> };
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

/** Allowed scalar Object values from the pinned capability-specific schema.
 * Resolve the actual property and comparison branch, not arbitrary YAML paths.
 */
/** Resolve capability-specific selector options wherever a collected Object is authored:
 * inline Test Objects, Shared Objects, and nested Variable collection expressions.
 * The pinned capability schema is the only source of enum options.
 */
/** Finite selector values must come from the same capability map as YAML completion. */
function objectScalarChoices(pack: MetadataPack | undefined, assessment: any, path: EditPath): string[] {
  if(!pack||path[0]!=='assessment'||path.at(-1)!=='equals')return [];
  const objectIndex=path.lastIndexOf('object');
  if(objectIndex<0||objectIndex+2!==path.length-1)return [];
  let obj:any={assessment};
  for(const part of path.slice(0,objectIndex+1))obj=obj?.[part as any];
  const capability=obj?.capability || (path[1]==='tests'?assessment?.tests?.[String(path[2])]?.capability:undefined);
  const field=String(path[objectIndex+1]);
  if(typeof capability!=='string')return [];
  try{return selectorValueChoices(pack,capability,field,'equals',false).map(choice=>choice.value)}
  catch{return []}
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
export function comparisonOperations(pack: MetadataPack | undefined, assessment: any, path: EditPath): string[] {
  if (!pack || path[0] !== 'assessment' || path.length < 5) return [];
  const operation=String(path.at(-1));
  const parent=path.slice(0,-1);
  const objectIndex=parent.lastIndexOf('object');
  let capability: string | undefined, field: string | undefined;
  let requireField=false;
  if(objectIndex>=0 && objectIndex===parent.length-2){
    let obj:any={assessment};
    for(const part of parent.slice(0,objectIndex+1))obj=obj?.[part as any];
    capability=obj?.capability || (parent[1]==='tests'?assessment?.tests?.[String(parent[2])]?.capability:undefined);
    field=String(parent.at(-1));
  }else{
    const req=parent.indexOf('require');
    if(req<0||parent[req+1]!=='fields'||parent.length!==req+3||parent[1]!=='tests')return [];
    requireField=true;
    capability=assessment?.tests?.[String(parent[2])]?.capability;
    field=String(parent.at(-1));
  }
  if(typeof capability!=='string'||!field)return [];
  try {
    // Reuse the completion resolver: it intersects the capability-specific
    // propertyNames contract with required oneOf alternatives.
    const choices=selectorOperatorChoices(pack,capability,field,requireField)
      .map(choice=>choice.value);
    return choices.includes(operation)?choices:[];
  }catch{return []}
}
/** Return contextual authoring help from the exact pinned capability predicate. */
function contextualFieldDescription(pack: MetadataPack | undefined, assessment: any, path: EditPath): string {
  if(!pack||path[0]!=='assessment')return '';
  const objectAt=path.lastIndexOf('object');
  if(objectAt>=0&&objectAt+1<path.length){
    let object:any={assessment};
    for(const part of path.slice(0,objectAt+1))object=object?.[part as any];
    const capability=object?.capability||(path[1]==='tests'?assessment?.tests?.[String(path[2])]?.capability:undefined);
    const uri=typeof capability==='string'?(pack.manifest.capabilities as any)?.[capability]?.schema_uri:undefined;
    if(uri){
      const name=String(path[objectAt+1]).replaceAll('~','~0').replaceAll('/','~1');
      const base=uri+'#/$defs/object/properties/'+name;
      try{
        const context={documentVersion:pack.pin.schemaVersion,schemaValid:true,isOverride:false,diagnostics:[]};
        const hint=pack.describe(base,context);
        if(hint.description)return hint.description;
      }catch{}
    }
  }
  const reqIndex=path.indexOf('require');
  if(reqIndex>=0&&path[reqIndex+1]==='fields'&&path.length>reqIndex+2){
    const cap=assessment?.tests?.[String(path[2])]?.capability;
    try{
      const catalog=new GuidedCatalog(pack);
      const field=catalog.resultFields(cap).find(entry=>entry.name===String(path[reqIndex+2]));
      if(field?.description)return field.description;
    }catch{}
  }
  return '';
}
/** Never show authoring-implementation metadata as end-user field help. */
function usefulFieldHelp(schemaDescription:string|undefined, assessment:any, path:EditPath, contextual:string):string {
  const description=String(schemaDescription||contextual||'').trim();
  const generic=/explicit new.authoring selection|preserve source.effective values|selector operator;|visible overrides; no runtime fallback/i;
  if(description&&!generic.test(description))return description;
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
  return generic.test(description)?'':description;
}
function assessmentVariableChoices(assessment:any,path:EditPath):string[]|undefined {
  if(path.at(-1)!=='variable')return undefined;
  const inTest=path[1]==='tests'&&path[3]==='object';
  const inShared=path[1]==='shared_objects';
  if(!inTest&&!inShared)return undefined;
  return Object.keys(assessment?.variables||{})
}
export function modelFor(document: any, pack?: MetadataPack) {
  try {
    const value = new SourceBuffer(document.getText()).json(); const root = schemaRoot(pack);
    return { ok: true, revision: sha256(document.getText()), version: document.version, explanation: explainAssessment(value, pack), fields: scalarEntries(value).map(field => {
      const help = schemaHelp(pack, root, field.path);
      const hidden = help && pack ? pack.control(help.uri, field.value, { documentVersion: pack.pin.schemaVersion, schemaValid: true, isOverride: false, diagnostics: [] }, 'hide-defaults').hidden : false; return { ...field, label: help?.title || pathLabel(field.path), description: usefulFieldHelp(help?.description,(value as any)?.assessment,field.path,contextualFieldDescription(pack,(value as any)?.assessment,field.path)), choices: assessmentVariableChoices((value as any)?.assessment,field.path) ?? (testChoiceOptions(pack,field.path).length ? testChoiceOptions(pack,field.path) : objectScalarChoices(pack,(value as any)?.assessment,field.path).length ? objectScalarChoices(pack,(value as any)?.assessment,field.path) : help?.choices || []), pickerOnly: assessmentVariableChoices((value as any)?.assessment,field.path)!==undefined, operatorChoices: comparisonOperations(pack,(value as any)?.assessment,field.path), fixedChoices: field.path.at(-1)==='equals'?objectScalarChoices(pack,(value as any)?.assessment,field.path):objectScalarChoices(pack,(value as any)?.assessment,[...field.path.slice(0,-1),'equals']), suggested: help?.suggested, hasSuggestion: help?.hasSuggestion ?? false, hidden, kind: field.value === null ? 'null' : typeof field.value };
    }) };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error), fields: [] }; }
}

function evaluationText(value: any): string {
  if (Array.isArray(value)) return value.map(evaluationText).join(' and ');
  if (!value || typeof value !== 'object') return 'no authored evaluation tree';
  if (typeof value.test === 'string') return value.test;
  return Object.entries(value).map(([operator, branch]) => `${operator.toUpperCase()} (${evaluationText(branch)})`).join(' ');
}
function evaluationControl(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.if) return undefined;
  const operation = Object.keys(value).find(key => ['and', 'or', 'one', 'xor'].includes(key));
  return operation ? { path: ['assessment', 'evaluate'], operation, operations: ['and', 'or', 'one', 'xor'] } : undefined;
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
  const base: any = modelFor(document, pack); if (!base.ok) return base;
  base.schemaVersion = pack?.pin.schemaVersion; base.packSha256 = pack?.pin.manifestSha256; base.diagnostics = [];
  const value: any = new SourceBuffer(document.getText()).json(); const assessment = value.assessment;
  // The graphical Variables inspector needs the authored expression structure,
  // not only the flattened scalar control list. This is read-only presentation
  // data derived from the same authoritative YAML document.
  base.variableDefinitions = assessment && typeof assessment === 'object' && !Array.isArray(assessment) ? (assessment.variables ?? {}) : {};
  // Preserve the authored Require hierarchy for explanation of population, predicates
  // and ordered regex arrays. Edits still target original source scalar paths.
  base.requireDefinitions = assessment && typeof assessment === 'object' && !Array.isArray(assessment) && assessment.tests && typeof assessment.tests === 'object' ? Object.fromEntries(Object.entries(assessment.tests).map(([testId, test]: [string, any]) => [testId, test?.require ?? {}])) : {};
  base.sharedObjectDefinitions = assessment && typeof assessment === 'object' && !Array.isArray(assessment) && assessment.shared_objects && typeof assessment.shared_objects === 'object' ? assessment.shared_objects : {};
  if (!assessment || typeof assessment !== 'object' || !assessment.tests || typeof assessment.tests !== 'object') return { ...base, assessment: undefined, hiddenCount: base.fields.filter((field: any) => field.hidden).length };
  const catalog = pack ? new GuidedCatalog(pack) : undefined; const tests = Object.entries(assessment.tests).map(([id, test]: [string, any]) => {
    const path = ['assessment', 'tests', id]; const titlePath = [...path, 'test_title']; const titleField = fieldAt(base.fields, titlePath); const controls: any[] = [];
    for (const [name, predicate] of Object.entries(test.object ?? {})) if (predicate && typeof predicate === 'object' && !Array.isArray(predicate)) controls.push({ kind: 'object', ...predicateControl(base.fields, [...path, 'object', name], name, predicate, objectFieldLabel(test.capability, name, catalog?.objectFields(test.capability).find(field => field.name === name)?.label ?? name.replaceAll('_', ' '))), definition: catalog?.objectFields(test.capability).find(field => field.name === name) });
    const requirement = test.require ?? {}; const itemControls = Object.entries(requirement.item_requirement ?? {}).map(([name, current]) => ({ name, label: name === 'items_found' ? 'Items found' : 'Items satisfying', path: [...path, 'require', 'item_requirement', name], value: current, choices: fieldAt(base.fields, [...path, 'require', 'item_requirement', name])?.choices ?? [] }));
    const fieldRequirement = Object.entries(requirement.field_requirement ?? {}).map(([name, current]) => ({ name, label: name === 'values_found' ? 'Field values found' : 'Field values matching', path: [...path, 'require', 'field_requirement', name], value: current, choices: fieldAt(base.fields, [...path, 'require', 'field_requirement', name])?.choices ?? [] }));
    const fieldControls = Object.entries(requirement.fields ?? {}).map(([name, predicate]) => ({ kind: 'field', ...predicateControl(base.fields, [...path, 'require', 'fields', name], name, predicate, name.replaceAll('_', ' ')), operations: catalog?.operations() ?? [] }));
    return { id, path, title: test.test_title ?? id, titlePath, titleField, capability: test.capability, capabilityLabel: catalog ? catalog.capabilities().find(option => option.value === test.capability)?.label ?? test.capability : test.capability, objectControls: controls, itemControls, fieldRequirement, fieldControls, explanation: explainAssessment({ assessment: { ...assessment, tests: { [id]: test } } }, pack), unsupported: Object.keys(test).filter(key => !['test_title', 'capability', 'object', 'require', 'reported_elements'].includes(key)) };
  });
  const inputControls = Object.entries(assessment.inputs ?? {}).flatMap(([name, input]: [string, any]) => {
    if (!input || typeof input !== 'object') return [];
    return [{ name, label: `Input: ${name}`, description: input.description ?? 'Optional author-supplied value', controls: Object.keys(input).filter(key => ['datatype', 'required', 'description', 'cardinality'].includes(key)).map(key => ({ label: key.replaceAll('_', ' '), path: ['assessment', 'inputs', name, key], value: input[key], choices: fieldAt(base.fields, ['assessment', 'inputs', name, key])?.choices ?? [] })) }];
  });
  return { ...base, assessment: { id: assessment.id, title: assessment.assessment_title, mode: assessment.mode, evaluate: assessment.evaluate, evaluationControl: evaluationControl(assessment.evaluate), evaluationExplanation: assessment.evaluate ? `Authored evaluation tree: ${evaluationText(assessment.evaluate)}. This describes logical selection only; no Test has been executed.` : '', inputControls, tests }, hiddenCount: base.fields.filter((field: any) => field.hidden).length };
}
