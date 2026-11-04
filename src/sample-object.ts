import { isMap, isSeq, parseDocument } from 'yaml';
import { MetadataPack, sha256 } from './metadata.js';
import { previewRegexSafe } from './playground.js';

export interface ObjectContext {
  capability: string;
  testId?: string;
  path: (string | number)[];
  object: Record<string, unknown>;
  documentRevision: string;
}
export type SelectorStatus = 'matched' | 'mismatched' | 'indeterminate' | 'missing' | 'invalid';
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
export interface ObjectTestResult {
  capability: string;
  selectedItemIndices: number[];
  items: ItemTrace[];
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
        if (key === 'object' && (pair as any).value?.items && Array.isArray((pair as any).value.range) && wanted((pair as any).value.range)) {
          const tests = nextPath.indexOf('tests');
          const testId = tests >= 0 && typeof nextPath[tests + 1] === 'string' ? String(nextPath[tests + 1]) : undefined;
          const capability = tests >= 0 ? at(value, ['assessment', 'tests', testId ?? '', 'capability']) : undefined;
          const object = at(value, nextPath);
          if (typeof capability === 'string' && object && typeof object === 'object' && !Array.isArray(object)) {
            found = { capability, testId, path: nextPath, object, documentRevision: sha256(text) };
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
function fieldValue(item: any, field: string): { present: boolean; value?: unknown; datatype?: string; empty?: boolean; status?: string } {
  const fields = item?.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || !Object.hasOwn(fields, field)) return { present: false };
  const raw = fields[field];
  const typed = Array.isArray(raw) ? undefined : raw;
  if (Array.isArray(raw)) return { present: true, value: raw.map(entry => entry?.value), datatype: raw[0]?.datatype, status: raw[0]?.status, empty: raw.length === 0 };
  if (!typed || typeof typed !== 'object' || Array.isArray(typed) || !Object.hasOwn(typed, 'value')) return { present: true, value: undefined, datatype: typeof typed?.datatype === 'string' ? typed.datatype : undefined, status: typeof typed?.status === 'string' ? typed.status : undefined, empty: true };
  return { present: true, value: typed.value, datatype: typeof typed.datatype === 'string' ? typed.datatype : undefined, status: typeof typed.status === 'string' ? typed.status : undefined, empty: typed.value === '' || typed.value === null };
}
function unresolved(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && (Object.hasOwn(value, 'variable') || Object.hasOwn(value, 'input'));
}
function sameValue(actual: unknown, expected: unknown) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
function numeric(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }

async function evaluateSelector(field: string, predicate: unknown, item: any): Promise<SelectorTrace> {
  const operation = selectorOperation(predicate);
  if (!operation) return { field, operator: 'unresolved', expected: predicate, status: 'indeterminate', reason: 'The Object selector has no single concrete operator; Variables and compound selector forms are unavailable in this bounded preview.' };
  const [operator, expected] = operation;
  const actual = fieldValue(item, field);
  if (!actual.present) return { field, operator, expected, status: 'missing', reason: 'The collected Item does not contain this field; missing is distinct from an empty field.' };
  if (actual.status && actual.status !== 'exists') return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: `The field status is '${actual.status}'; non-existing/error/not-collected values are not coerced into a selector mismatch.` };
  if (actual.empty) return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: 'The field is present but empty; this preview does not convert empty values into absent values.' };
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
    return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: result.matched ? 'matched' : 'mismatched', reason: result.matched ? 'The bounded ECMAScript-safe-preview matched the Item value.' : 'The bounded ECMAScript-safe-preview did not match the Item value.' };
  }
  if (['greater_than', 'greater_than_or_equal', 'less_than', 'less_than_or_equal'].includes(operator)) {
    if (!numeric(actual.value) || !numeric(expected)) return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: 'Ordered comparison requires finite numeric values; no string coercion is performed.' };
    const result = operator === 'greater_than' ? actual.value > expected : operator === 'greater_than_or_equal' ? actual.value >= expected : operator === 'less_than' ? actual.value < expected : actual.value <= expected;
    return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: result ? 'matched' : 'mismatched', reason: result ? 'The typed numeric comparison succeeded.' : 'The typed numeric comparison failed.' };
  }
  return { field, operator, expected, actual: actual.value, datatype: actual.datatype, status: 'indeterminate', reason: `Operator '${operator}' is declared by the Object but has no qualified adapter in this offline preview.` };
}

function sampleItems(value: any): any[] | undefined {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (value && typeof value === 'object' && value.fields) return [value];
  return undefined;
}
function schemaDiagnostics(pack: MetadataPack | undefined, capability: string, item: any): string[] {
  if (!pack) return [];
  const uri = pack.manifest.capabilities[capability]?.schema_uri;
  if (!uri) return [`Capability '${capability}' is not present in the pinned metadata pack.`];
  try { return pack.validate(`${uri}#/$defs/collected_item`, item); } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}

export async function evaluateObjectSamples(object: Record<string, unknown>, capability: string, source: string, pack?: MetadataPack): Promise<ObjectTestResult> {
  const parsed = parseDocument(source, { uniqueKeys: true });
  if (parsed.errors.length) return { capability, selectedItemIndices: [], items: [], warnings: [], inputDiagnostics: parsed.errors.map(error => error.message), assessmentExecution: 'unavailable' };
  let value: any;
  try { value = parsed.toJS({ maxAliasCount: 50 }); } catch (error) { return { capability, selectedItemIndices: [], items: [], warnings: [], inputDiagnostics: [error instanceof Error ? error.message : String(error)], assessmentExecution: 'unavailable' }; }
  const items = sampleItems(value);
  if (!items) return { capability, selectedItemIndices: [], items: [], warnings: [], inputDiagnostics: ['Enter a canonical collected Item, an array of Items, or an object with an items array.'], assessmentExecution: 'unavailable' };
  const selectors = Object.entries(object).filter(([field, predicate]) => field !== 'capability' && field !== 'object_title' && field !== 'filters' && field !== 'for_each' && field !== 'set' && field !== 'traversal');
  const traces: ItemTrace[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index]; const diagnostics = schemaDiagnostics(pack, capability, item);
    const selectorTraces: SelectorTrace[] = [];
    for (const [field, predicate] of selectors) selectorTraces.push(await evaluateSelector(field, predicate, item));
    const hasMismatch = selectorTraces.some(trace => trace.status === 'mismatched' || trace.status === 'missing');
    const hasIndeterminate = selectorTraces.some(trace => trace.status === 'indeterminate' || trace.status === 'invalid') || diagnostics.length > 0;
    traces.push({ index, id: typeof item?.id === 'string' ? item.id : undefined, status: hasMismatch ? 'mismatched' : hasIndeterminate ? 'indeterminate' : 'matched', selectors: selectorTraces, schemaDiagnostics: diagnostics });
  }
  const selectedItemIndices = traces.filter(trace => trace.status === 'matched').map(trace => trace.index);
  const warnings = ['Offline sample data only; no scanner command, evidence collection, Test requirement rollup or compliance PASS/FAIL result was performed.'];
  if (!pack) warnings.push('No verified metadata pack was supplied; canonical Item schema validation was skipped.');
  if (selectors.length === 0) warnings.push('The Object contains no directly previewable selector members.');
  if (traces.some(trace => trace.status === 'indeterminate')) warnings.push('At least one Item or selector is indeterminate/unsupported; it was not converted to a mismatch.');
  return { capability, selectedItemIndices, items: traces, warnings, inputDiagnostics: [], assessmentExecution: 'unavailable' };
}

export function starterSampleItems(object: Record<string, unknown>, capability: string) {
  const fields: Record<string, unknown> = {};
  for (const [field, predicate] of Object.entries(object)) {
    const entry = selectorOperation(predicate);
    if (!entry) continue;
    const expected = entry[1];
    if (typeof expected === 'string' || typeof expected === 'number' || typeof expected === 'boolean') fields[field] = { datatype: typeof expected === 'number' ? 'integer' : typeof expected === 'boolean' ? 'boolean' : 'string', status: 'exists', value: expected };
  }
  return JSON.stringify([{ id: 'sample-item-1', capability, status: 'exists', fields, provenance: {} }], null, 2);
}
