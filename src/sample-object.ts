import { isMap, isSeq, parseDocument } from 'yaml';
import { MetadataPack, sha256 } from './metadata.js';
import { previewRegexSafe } from './playground.js';

export interface ObjectContext {
  capability: string;
  testId?: string;
  path: (string | number)[];
  object: Record<string, unknown>;
  require?: Record<string, unknown>;
  documentRevision: string;
}
export type SelectorStatus = 'matched' | 'mismatched' | 'indeterminate' | 'missing' | 'invalid';
export type SampleEvidenceState = 'complete' | 'known-empty' | 'scalar-empty' | 'missing' | 'incomplete' | 'error' | 'unsupported';
export interface SelectorTrace {
  field: string;
  operator: string;
  expected: unknown;
  actual?: unknown;
  datatype?: string;
  status: SelectorStatus;
  reason: string;
}
export interface ItemTrace {
  index: number;
  id?: string;
  status: 'matched' | 'mismatched' | 'indeterminate' | 'invalid';
  selectors: SelectorTrace[];
  schemaDiagnostics: string[];
}
export interface CardinalityTrace {
  kind: 'items' | 'values' | 'matching-items' | 'matching-values';
  cardinality: string;
  observed: number;
  status: SelectorStatus;
  reason: string;
}
export interface RequirementTrace {
  status: SelectorStatus;
  item?: CardinalityTrace;
  itemsSatisfying?: CardinalityTrace;
  fields: Array<{ field: string; valuesFound?: CardinalityTrace; valuesMatching?: CardinalityTrace }>;
}
export interface PopulationTrace {
  state: SampleEvidenceState;
  itemsFound: number;
  reason: string;
}
export interface ObjectTestResult {
  capability: string;
  selectedItemIndices: number[];
  items: ItemTrace[];
  population: PopulationTrace;
  requirement?: RequirementTrace;
  warnings: string[];
  inputDiagnostics: string[];
  assessmentExecution: 'unavailable';
}

function at(root: any, path: (string | number)[]) {
  let value = root;
  for (const part of path) value = value?.[part as any];
  return value;
}
function mapKey(node: any, key: string) { return node?.items?.find((pair: any) => pair?.key?.value === key); }

/** Resolve only the enclosing Test Object; sibling Tests are never consulted. */
export function findObjectContext(text: string, offset: number, selectionEnd = offset): ObjectContext | undefined {
  const document = parseDocument(text, { keepSourceTokens: true, uniqueKeys: true });
  if (document.errors.length || !document.contents) return undefined;
  const value = document.toJS({ maxAliasCount: 50 }) as any;
  const wanted = (range: readonly number[]) => Math.max(offset, range[0]) <= Math.min(selectionEnd, range[1]);
  let found: ObjectContext | undefined;
  const visit = (node: any, path: (string | number)[]) => {
    if (isMap(node)) {
      for (const pair of node.items ?? []) {
        const key = (pair as any).key?.value;
        if (typeof key !== 'string') continue;
        const nextPath = [...path, key];
        // Accept the Object key itself as well as any nested member. A block
        // mapping's value range starts at its first child, so requiring only
        // the value range makes a caret on `object:` appear to be outside the
        // Object even though it is the natural place to invoke this command.
        const objectKeyRange = (pair as any).key?.range;
        const objectValueRange = (pair as any).value?.range;
        const insideObject = (Array.isArray(objectKeyRange) && wanted(objectKeyRange)) ||
          (Array.isArray(objectValueRange) && wanted(objectValueRange));
        if (key === 'object' && (pair as any).value?.items && insideObject) {
          const tests = nextPath.indexOf('tests');
          const testId = tests >= 0 && typeof nextPath[tests + 1] === 'string' ? String(nextPath[tests + 1]) : undefined;
          const capability = tests >= 0 ? at(value, ['assessment', 'tests', testId ?? '', 'capability']) : undefined;
          const object = at(value, nextPath);
          const require = tests >= 0 ? at(value, ['assessment', 'tests', testId ?? '', 'require']) : undefined;
          if (typeof capability === 'string' && object && typeof object === 'object' && !Array.isArray(object)) {
            found = { capability, testId, path: nextPath, object, require: require && typeof require === 'object' && !Array.isArray(require) ? require : undefined, documentRevision: sha256(text) };
          }
        }
        visit((pair as any).value, nextPath);
      }
    } else if (isSeq(node)) {
      for (let index = 0; index < (node.items ?? []).length; index++) visit(node.items[index], [...path, index]);
    }
  };
  visit(document.contents, []);
  return found;
}

function selectorOperation(predicate: unknown): [string, unknown] | undefined {
  if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate)) return undefined;
  const ignored = new Set(['datatype', 'value_match', 'redact_result']);
  const entry = Object.entries(predicate as Record<string, unknown>).find(([key]) => !ignored.has(key));
  return entry as [string, unknown] | undefined;
}
function concreteSampleValue(predicate: unknown): [string, string | number | boolean] | undefined {
  const entry = selectorOperation(predicate);
  if (!entry || entry[0] === 'variable' || entry[0] === 'input' || unresolved(predicate) || unresolved(entry[1])) return undefined;
  const [operator, expected] = entry;
  return typeof expected === 'string' || typeof expected === 'number' || typeof expected === 'boolean' ? [operator, expected] : undefined;
}
export interface ObjectTesterGuidance {
  message: string;
  canPreview: boolean;
  previewableFields: string[];
  unresolvedFields: string[];
  unsupportedFields: string[];
}
export function objectTesterGuidance(object: Record<string, unknown>, capability?: string): ObjectTesterGuidance {
  const previewableFields: string[] = [];
  const unresolvedFields: string[] = [];
  const unsupportedFields: string[] = [];
  for (const [field, predicate] of Object.entries(object)) {
    if (concreteSampleValue(predicate)) previewableFields.push(field);
    else {
      const operation = selectorOperation(predicate);
      if (unresolved(predicate) || operation?.[0] === 'variable' || operation?.[0] === 'input' || unresolved(operation?.[1])) unresolvedFields.push(field);
      else unsupportedFields.push(field);
    }
  }
  let message = 'Replace the generated starter below with one or more sanitized collected Item records. Paste a canonical Item—not raw command output and not the Assessment YAML. The tester compares the Item fields with the selected Object; it does not collect evidence.';
  if (!previewableFields.length && unresolvedFields.length) {
    message = `This Object is not available to this bounded sample tester. It uses unresolved Variable/Input-backed members (${unresolvedFields.join(', ')}), so no sample replacement is needed here. The preview cannot resolve Variables, execute commands, or evaluate require; use a direct-selector Test or a qualified evaluator instead.`;
  }
  return { message, canPreview: previewableFields.length > 0, previewableFields, unresolvedFields, unsupportedFields };
}
interface FieldObservation {
  present: boolean;
  values: unknown[];
  datatype?: string;
  status?: string;
  state: SampleEvidenceState;
  value?: unknown;
}

function statusState(status: unknown): SampleEvidenceState {
  if (status === 'does_not_exist') return 'known-empty';
  if (status === 'not_collected') return 'incomplete';
  if (status === 'error') return 'error';
  if (status === 'exists') return 'complete';
  return 'unsupported';
}

/**
 * Normalize the bounded Item fixture without collapsing absence into an empty
 * string. An empty array and a typed does_not_exist field are known empty
 * populations; a missing field is not evidence of absence.
 */
function fieldValue(item: any, field: string): FieldObservation {
  const fields = item?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.hasOwn(fields, field)) {
    return { present: false, values: [], state: 'missing' };
  }
  const raw = fields[field];
  if (Array.isArray(raw)) {
    const values: unknown[] = [];
    let datatype: string | undefined;
    let firstStatus: string | undefined;
    let state: SampleEvidenceState = 'complete';
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { state = 'unsupported'; continue; }
      datatype ??= typeof entry.datatype === 'string' ? entry.datatype : undefined;
      firstStatus ??= typeof entry.status === 'string' ? entry.status : undefined;
      const entryState = entry.status === undefined && Object.hasOwn(entry, 'value') ? 'complete' : statusState(entry.status);
      if (entryState === 'error') state = 'error';
      else if (entryState === 'incomplete' && state === 'complete') state = 'incomplete';
      else if (entryState === 'unsupported' && state === 'complete') state = 'unsupported';
      else if (entryState === 'known-empty' && state === 'complete' && values.length === 0) state = 'known-empty';
      else if (entryState === 'complete' && state === 'known-empty') state = 'complete';
      if (entryState === 'complete' && Object.hasOwn(entry, 'value')) values.push(entry.value);
    }
    if (!raw.length) state = 'known-empty';
    if (!values.length && state === 'complete') state = 'known-empty';
    if (values.length && values.some(value => value === '')) state = 'scalar-empty';
    return { present: true, values, datatype, status: firstStatus, state, value: values.length === 1 ? values[0] : values };
  }
  if (!raw || typeof raw !== 'object') return { present: true, values: [], state: 'unsupported' };
  const datatype = typeof raw.datatype === 'string' ? raw.datatype : undefined;
  const status = typeof raw.status === 'string' ? raw.status : undefined;
  const state = status === undefined && Object.hasOwn(raw, 'value') ? 'complete' : statusState(status);
  if (state !== 'complete') return { present: true, values: [], datatype, status, state };
  if (!Object.hasOwn(raw, 'value')) return { present: true, values: [], datatype, status, state: 'incomplete' };
  // A typed value with an array is accepted by the offline fixture adapter to
  // exercise zero-value variables; native runtime Items normally use arrays of
  // typed_value for multi-valued fields.
  const values = Array.isArray(raw.value) ? raw.value : [raw.value];
  const finalState: SampleEvidenceState = !values.length ? 'known-empty' : values.some((value: unknown) => value === '') ? 'scalar-empty' : 'complete';
  return { present: true, values, datatype, status, state: finalState, value: values.length === 1 ? values[0] : values };
}

function unresolved(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.hasOwn(value, 'variable') || Object.hasOwn(value, 'input'));
}
function sameValue(actual: unknown, expected: unknown) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
function numeric(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

async function evaluateSelector(field: string, predicate: unknown, item: any): Promise<SelectorTrace> {
  if (predicate && typeof predicate === 'object' && !Array.isArray(predicate) && Object.hasOwn(predicate, 'values_found')) {
    const actual = fieldValue(item, field);
    if (!actual.present) return { field, operator: 'values_found', expected: (predicate as any).values_found, status: 'missing', reason: 'The collected Item does not contain this field; missing is distinct from an empty field.' };
    const complete = ['complete', 'known-empty', 'scalar-empty'].includes(actual.state);
    const trace = cardinalityTrace('values', (predicate as any).values_found, actual.values.length, complete);
    return { field, operator: 'values_found', expected: (predicate as any).values_found, actual: actual.values, datatype: actual.datatype, status: trace.status, reason: trace.reason };
  }
  const operation = selectorOperation(predicate);
  if (!operation) return { field, operator: 'unresolved', expected: predicate, status: 'indeterminate', reason: 'The Object selector has no single concrete operator; Variables and compound selector forms are unavailable in this bounded preview.' };
  const [operator, expected] = operation;
  const actual = fieldValue(item, field);
  if (!actual.present) return { field, operator, expected, status: 'missing', reason: 'The collected Item does not contain this field; missing is distinct from an empty field.' };
  if (actual.state === 'known-empty') return { field, operator, expected, actual: [], datatype: actual.datatype, status: 'indeterminate', reason: 'The field is authoritatively empty; zero values are distinct from a missing field and cannot satisfy a scalar selector.' };
  if (actual.state === 'error' || actual.state === 'incomplete' || actual.state === 'unsupported') return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: `The field evidence is ${actual.state}; non-success collection states are not coerced into empty or mismatched values.` };
  if (actual.status && actual.status !== 'exists' && actual.values.length === 0) return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: `The field status is '${actual.status}'; non-existing/error/not-collected values are not coerced into a selector mismatch.` };
  if (unresolved(expected)) return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: 'The selector operand references an unresolved Variable or Input.' };
  if (Array.isArray(expected)) return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: 'Multiple selector operands require canonical runtime semantics and are not approximated by this adapter.' };
  if (operator === 'equals' || operator === 'not_equal') {
    const equal = sameValue(actual.value, expected);
    return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: operator === 'equals' ? (equal ? 'matched' : 'mismatched') : (!equal ? 'matched' : 'mismatched'), reason: equal ? 'Values are equal under strict typed comparison.' : 'Values differ under strict typed comparison.' };
  }
  if (operator === 'case_insensitive_equals' || operator === 'case_insensitive_not_equal') {
    if (typeof actual.value !== 'string' || typeof expected !== 'string') return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: 'Case-insensitive comparison is defined here only for string values; datatype coercion is not performed.' };
    const equal = actual.value.toLowerCase() === expected.toLowerCase();
    return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: operator === 'case_insensitive_equals' ? (equal ? 'matched' : 'mismatched') : (!equal ? 'matched' : 'mismatched'), reason: 'Strings were compared using Unicode lower-case normalization; no locale or datatype coercion was used.' };
  }
  if (operator === 'matches_regex') {
    if (typeof actual.value !== 'string' || typeof expected !== 'string') return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: 'Regex preview requires string selector and Item values.' };
    const result = (await previewRegexSafe([expected], actual.value, '', 500))[0];
    if (result.error || result.timedOut) return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: result.error ?? 'Regex preview timed out and was cancelled.' };
    return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: result.matched ? 'matched' : 'mismatched', reason: result.matched ? 'The bounded PCRE2-safe-preview matched the Item value.' : 'The bounded PCRE2-safe-preview did not match the Item value.' };
  }
  if (['greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal'].includes(operator)) {
    if (!numeric(actual.value) || !numeric(expected)) return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: 'Ordered comparison requires finite numeric values; no string coercion is performed.' };
    const result = operator === 'greater_than' ? actual.value > expected : operator === 'greater_than_or_equal' ? actual.value >= expected : operator === 'less_than' ? actual.value < expected : actual.value <= expected;
    return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: result ? 'matched' : 'mismatched', reason: result ? 'The typed numeric comparison succeeded.' : 'The typed numeric comparison failed.' };
  }
  return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: `Operator '${operator}' is declared by the Object but has no qualified adapter in this offline preview.` };
}

function samplePopulation(value: any): { items: any[]; state: SampleEvidenceState; reason: string } | undefined {
  if (Array.isArray(value)) return { items: value, state: 'complete', reason: value.length ? 'The supplied Item array is treated as a complete sample population.' : 'The supplied Item array is a complete known-empty population.' };
  if (value && typeof value === 'object' && Array.isArray(value.items)) {
    const declared = value.status ?? value.completeness;
    const state = declared === 'error' ? 'error' : declared === 'incomplete' || declared === 'not_collected' ? 'incomplete' : 'complete';
    return { items: value.items, state, reason: state === 'complete' && value.items.length === 0 ? 'The supplied Item array is a complete known-empty population.' : state === 'complete' ? 'The supplied Item array is treated as a complete sample population.' : `The supplied population is ${state}; zero observed Items are not treated as successful emptiness.` };
  }
  if (value && typeof value === 'object' && value.fields) return { items: [value], state: 'complete', reason: 'The supplied Item is treated as one complete sample population member.' };
  return undefined;
}
function cardinalityTrace(kind: CardinalityTrace['kind'], cardinality: unknown, observed: number, complete: boolean): CardinalityTrace {
  const token = String(cardinality ?? '');
  if (!complete) return { kind, cardinality: token, observed, status: 'indeterminate', reason: 'The sample population is incomplete or has an acquisition error; absence cannot be inferred from zero observed values.' };
  let matched: boolean | undefined;
  if (token === 'none') matched = observed === 0;
  else if (token === 'exactly_one') matched = observed === 1;
  else if (token === 'one_or_more') matched = observed >= 1;
  else if (token === 'zero_or_more') matched = true;
  else if (token === 'every') matched = true;
  if (matched === undefined) return { kind, cardinality: token, observed, status: 'indeterminate', reason: `Cardinality '${token}' is not supported by this bounded sample adapter.` };
  const vacuity = observed === 0 && (token === 'none' || token === 'every' || token === 'zero_or_more');
  return { kind, cardinality: token, observed, status: matched ? 'matched' : 'mismatched', reason: vacuity ? `Complete empty population; '${token}' is true by finite cardinality semantics.` : `${observed} observed ${kind.replace('-', ' ')} satisfy '${token}'.` };
}

function fieldValuesForRequirement(items: any[], field: string) {
  const observations = items.map(item => ({ item, observation: fieldValue(item, field) }));
  const values = observations.flatMap(entry => entry.observation.values.map(value => ({ ...entry, value })));
  const invalid = observations.some(({ observation }) => ['missing', 'incomplete', 'error', 'unsupported'].includes(observation.state));
  return { observations, values, complete: !invalid };
}

async function evaluateRequirement(requirement: Record<string, unknown> | undefined, items: any[], traces: ItemTrace[], population: PopulationTrace): Promise<RequirementTrace | undefined> {
  if (!requirement || typeof requirement !== 'object') return undefined;
  const itemRequirement = (requirement.item_requirement && typeof requirement.item_requirement === 'object' ? requirement.item_requirement : {}) as Record<string, unknown>;
  const fieldRequirement = (requirement.field_requirement && typeof requirement.field_requirement === 'object' ? requirement.field_requirement : {}) as Record<string, unknown>;
  const fields = (requirement.fields && typeof requirement.fields === 'object' && !Array.isArray(requirement.fields) ? requirement.fields : {}) as Record<string, unknown>;
  const result: RequirementTrace = { status: 'matched', fields: [] };
  const checks: CardinalityTrace[] = [];
  if (Object.hasOwn(itemRequirement, 'items_found')) checks.push(result.item = cardinalityTrace('items', itemRequirement.items_found, items.length, population.state === 'complete'));
  const satisfying = traces.filter(trace => trace.status === 'matched').length;
  if (Object.hasOwn(itemRequirement, 'items_satisfying')) checks.push(result.itemsSatisfying = cardinalityTrace('matching-items', itemRequirement.items_satisfying, satisfying, population.state === 'complete'));
  for (const [field, predicate] of Object.entries(fields)) {
    const collected = fieldValuesForRequirement(items, field);
    const entry: { field: string; valuesFound?: CardinalityTrace; valuesMatching?: CardinalityTrace } = { field };
    if (Object.hasOwn(fieldRequirement, 'values_found')) entry.valuesFound = cardinalityTrace('values', fieldRequirement.values_found, collected.values.length, population.state === 'complete' && collected.complete);
    if (Object.hasOwn(fieldRequirement, 'values_matching')) {
      let matching = 0;
      let comparisonComplete = population.state === 'complete' && collected.complete;
      for (const { item, observation, value } of collected.values) {
        if (observation.state !== 'complete' && observation.state !== 'scalar-empty') { comparisonComplete = false; continue; }
        const synthetic = { ...item, fields: { ...item.fields, [field]: { datatype: observation.datatype, status: 'exists', value } } };
        const trace = await evaluateSelector(field, predicate, synthetic);
        if (trace.status === 'matched') matching++;
        else if (trace.status === 'indeterminate' || trace.status === 'invalid' || trace.status === 'missing') comparisonComplete = false;
      }
      entry.valuesMatching = cardinalityTrace('matching-values', fieldRequirement.values_matching, matching, comparisonComplete);
    }
    result.fields.push(entry);
  }
  if (checks.some(check => check.status === 'indeterminate') || result.fields.some(field => [field.valuesFound, field.valuesMatching].some(check => check?.status === 'indeterminate'))) result.status = 'indeterminate';
  else if (checks.some(check => check.status === 'mismatched') || result.fields.some(field => [field.valuesFound, field.valuesMatching].some(check => check?.status === 'mismatched'))) result.status = 'mismatched';
  return result;
}

function schemaDiagnostics(pack: MetadataPack | undefined, capability: string, item: any): string[] {
  if (!pack) return [];
  const uri = pack.manifest.capabilities[capability]?.schema_uri;
  if (!uri) return [`Capability '${capability}' is not present in the pinned metadata pack.`];
  try { return pack.validate(`${uri}#/$defs/collected_item`, item); } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}

export async function evaluateObjectSamples(object: Record<string, unknown>, capability: string, source: string, pack?: MetadataPack, require?: Record<string, unknown>): Promise<ObjectTestResult> {
  const parsed = parseDocument(source, { uniqueKeys: true });
  if (parsed.errors.length) return { capability, selectedItemIndices: [], items: [], population: { state: 'unsupported', itemsFound: 0, reason: 'The sample YAML could not be parsed.' }, warnings: [], inputDiagnostics: parsed.errors.map(error => error.message), assessmentExecution: 'unavailable' };
  let value: any;
  try { value = parsed.toJS({ maxAliasCount: 50 }); } catch (error) { return { capability, selectedItemIndices: [], items: [], population: { state: 'unsupported', itemsFound: 0, reason: 'The sample YAML could not be converted into canonical data.' }, warnings: [], inputDiagnostics: [error instanceof Error ? error.message : String(error)], assessmentExecution: 'unavailable' }; }
  const populationInput = samplePopulation(value);
  if (!populationInput) return { capability, selectedItemIndices: [], items: [], population: { state: 'unsupported', itemsFound: 0, reason: 'Enter a canonical collected Item, an array of Items, or an object with an items array.' }, warnings: [], inputDiagnostics: ['Enter a canonical collected Item, an array of Items, or an object with an items array.'], assessmentExecution: 'unavailable' };
  const items = populationInput.items;
  const itemError = items.some(item => item?.status === 'error');
  const itemIncomplete = items.some(item => item?.status === 'not_collected');
  const populationState: SampleEvidenceState = populationInput.state !== 'complete' ? populationInput.state : itemError ? 'error' : itemIncomplete ? 'incomplete' : 'complete';
  const population: PopulationTrace = { state: populationState, itemsFound: items.length, reason: populationState === 'complete' ? populationInput.reason : `At least one supplied Item is ${populationState}; the collection is not complete evidence.` };
  const selectors = Object.entries(object).filter(([field, predicate]) => field !== 'capability' && field !== 'object_title' && field !== 'filters' && field !== 'for_each' && field !== 'set' && field !== 'traversal');
  const traces: ItemTrace[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index]; const diagnostics = schemaDiagnostics(pack, capability, item);
    const selectorTraces: SelectorTrace[] = [];
    for (const [field, predicate] of selectors) selectorTraces.push(await evaluateSelector(field, predicate, item));
    const hasMismatch = selectorTraces.some(trace => trace.status === 'mismatched' || trace.status === 'missing');
    const itemState = item?.status === 'error' || item?.status === 'not_collected' ? 'indeterminate' : undefined;
    const hasIndeterminate = itemState === 'indeterminate' || selectorTraces.some(trace => trace.status === 'indeterminate' || trace.status === 'invalid') || diagnostics.length > 0;
    traces.push({ index, id: typeof item?.id === 'string' ? item.id : undefined, status: hasMismatch ? 'mismatched' : hasIndeterminate ? 'indeterminate' : 'matched', selectors: selectorTraces, schemaDiagnostics: diagnostics });
  }
  const selectedItemIndices = traces.filter(trace => trace.status === 'matched').map(trace => trace.index);
  const warnings = ['Offline sample data only; no scanner command, evidence collection, Test requirement rollup or compliance PASS/FAIL result was performed.'];
  if (population.state !== 'complete') warnings.push(`The supplied sample population is ${population.state}; an empty observation is not treated as successful complete evidence.`);
  else if (population.itemsFound === 0) warnings.push('The supplied sample is a complete known-empty Item population. Zero Items is valid evidence; cardinality still decides whether the requirement matches.');
  if (!pack) warnings.push('No verified metadata pack was supplied; canonical Item schema validation was skipped.');
  if (selectors.length === 0) warnings.push('The Object contains no directly previewable selector members.');
  if (traces.some(trace => trace.status === 'indeterminate')) warnings.push('At least one Item or selector is indeterminate/unsupported; it was not converted to a mismatch.');
  const requirement = await evaluateRequirement(require as Record<string, unknown> | undefined, items, traces, population);
  return { capability, selectedItemIndices, items: traces, population, requirement, warnings, inputDiagnostics: [], assessmentExecution: 'unavailable' };
}

export function starterSampleItems(object: Record<string, unknown>, capability: string) {
  const fields: Record<string, unknown> = {};
  for (const [field, predicate] of Object.entries(object)) {
    const entry = concreteSampleValue(predicate);
    if (!entry) continue;
    const expected = entry[1];
    fields[field] = { datatype: typeof expected === 'number' ? 'integer' : typeof expected === 'boolean' ? 'boolean' : 'string', status: 'exists', value: expected };
  }
  return JSON.stringify([{ id: 'sample-item-1', capability, status: 'exists', fields, provenance: {} }], null, 2);
}
