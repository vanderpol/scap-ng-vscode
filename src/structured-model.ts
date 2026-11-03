import { MetadataPack, sha256, type Json } from './metadata.js';
import { SourceBuffer } from './source.js';
import { GuidedCatalog } from './guided.js';

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

export function modelFor(document: any, pack?: MetadataPack) {
  try {
    const value = new SourceBuffer(document.getText()).json(); const root = schemaRoot(pack);
    return { ok: true, revision: sha256(document.getText()), version: document.version, explanation: explainAssessment(value, pack), fields: scalarEntries(value).map(field => {
      const help = schemaHelp(pack, root, field.path);
      const hidden = help && pack ? pack.control(help.uri, field.value, { documentVersion: pack.pin.schemaVersion, schemaValid: true, isOverride: false, diagnostics: [] }, 'hide-defaults').hidden : false; return { ...field, label: help?.title || pathLabel(field.path), description: help?.description || '', choices: help?.choices || [], suggested: help?.suggested, hasSuggestion: help?.hasSuggestion ?? false, hidden, kind: field.value === null ? 'null' : typeof field.value };
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
function objectFieldLabel(capability: string, name: string, fallback: string) {
  if (capability === 'windows.registry') return ({ hive: 'Registry hive', key: 'Registry key', name: 'Value name' } as Record<string, string>)[name] ?? fallback;
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
  const value: any = new SourceBuffer(document.getText()).json(); const assessment = value.assessment;
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
