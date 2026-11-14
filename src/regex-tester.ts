import { isMap, isScalar, isSeq, parseDocument, type Scalar } from 'yaml';
import { sha256 } from './metadata.js';
import type { RegexCaptureSpan } from './playground.js';

export type RegexSourceKind = 'matches_regex' | 'regex_capture';
export interface RegexContext {
  kind: RegexSourceKind;
  pattern: string;
  /** All selected patterns when a matches_regex sequence is selected. */
  patterns: string[];
  path: (string | number)[];
  paths: (string | number)[][];
  sourceRange: [number, number];
  sourceRanges: [number, number][];
  testId?: string;
  capability?: string;
  documentRevision: string;
  yamlStyle?: string;
  yamlStyles?: (string | undefined)[];
}
export interface RegexReplacement {
  replacement: string;
  nextText: string;
  range: [number, number];
}

/**
 * Finds a regex scalar using YAML CST ranges rather than reparsing/restringifying
 * the document. The caller supplies a caret/selection offset in source bytes.
 * `matches_regex` and `regex_capture.pattern` are deliberately the only source
 * shapes accepted here; ordinary strings named `pattern` are not regex inputs.
 */
export function findRegexContext(text: string, offset: number, selectionEnd = offset): RegexContext | undefined {
  const document = parseDocument(text, { keepSourceTokens: true, uniqueKeys: true });
  if (document.errors.length || !document.contents) return undefined;
  const value = document.toJS({ maxAliasCount: 50 });
  const wanted = (range: readonly number[]) => Math.max(offset, range[0]) <= Math.min(selectionEnd, range[1]);
  type Candidate = { kind: RegexSourceKind; pattern: string; path: (string | number)[]; range: [number, number]; style?: string };
  const candidates: Candidate[] = [];
  const visit = (node: any, path: (string | number)[]) => {
    if (isScalar(node) && Array.isArray(node.range) && wanted(node.range)) {
      const key = typeof path.at(-1) === 'string' ? String(path.at(-1)) : '';
      const isMatch = path.includes('matches_regex');
      const isCapture = key === 'pattern' && path.includes('regex_capture');
      if (isMatch || isCapture) {
        const scalarValue = (node as any).value;
        if (typeof scalarValue === 'string') candidates.push({
          kind: isCapture ? 'regex_capture' : 'matches_regex', pattern: scalarValue,
          path: [...path], range: [node.range[0], node.range[1]], style: node.type
        });
      }
    }
    if (isMap(node)) {
      for (const pair of node.items ?? []) {
        const key = (pair as any).key?.value;
        if (typeof key === 'string') visit((pair as any).value, [...path, key]);
      }
    } else if (isSeq(node)) {
      for (let index = 0; index < (node.items ?? []).length; index++) visit(node.items[index], [...path, index]);
    }
  };
  visit(document.contents, []);
  if (!candidates.length) return undefined;
  const first = candidates[0];
  // A selected sequence of matches_regex values is one authored expression
  // with multiple alternatives. Group only siblings from that exact sequence;
  // a caret in one scalar still opens just that scalar.
  const parent = first.path.slice(0, -1);
  const selected = first.kind === 'matches_regex' && selectionEnd > offset
    ? candidates.filter(candidate => candidate.kind === first.kind && JSON.stringify(candidate.path.slice(0, -1)) === JSON.stringify(parent))
    : [first];
  const tests = first.path.indexOf('tests');
  const testId = tests >= 0 && typeof first.path[tests + 1] === 'string' ? String(first.path[tests + 1]) : undefined;
  const capability = tests >= 0 ? valueAt(value, ['assessment', 'tests', testId ?? '', 'capability']) : undefined;
  const patterns = selected.map(candidate => candidate.pattern);
  const sourceRanges = selected.map(candidate => candidate.range);
  return {
    kind: first.kind, pattern: patterns[0], patterns, path: [...first.path], paths: selected.map(candidate => [...candidate.path]),
    sourceRange: [sourceRanges[0][0], sourceRanges[sourceRanges.length - 1][1]], sourceRanges, yamlStyles: selected.map(candidate => candidate.style),
    testId, capability: typeof capability === 'string' ? capability : undefined,
    documentRevision: sha256(text), yamlStyle: first.style
  };
}

/** Select the first schema-recognized expression when opening from a graphical
 * editor that has no native text-editor caret. A full-document selection also
 * groups sibling matches_regex sequence entries as one editable set. */
export function findFirstRegexContext(text: string): RegexContext | undefined {
  return findRegexContext(text, 0, text.length);
}

function valueAt(root: any, path: (string | number)[]) {
  let value = root;
  for (const part of path) value = value?.[part as any];
  return value;
}

function safePlain(value: string) {
  return value.length > 0 && value.trim() === value &&
    !/^[\-?:,\[\]{}#&*!|>'"%@`]/.test(value) &&
    !/[\n\r\t]|\s#|:\s|\s:$/.test(value) &&
    !/^(?:true|false|null|~|[-+]?\d+(?:\.\d+)?)$/i.test(value);
}

/** Encode one replacement while retaining the existing scalar style where safe. */
export function encodeRegexScalar(value: string, source: string, range: readonly number[], style?: string): string {
  const original = source.slice(range[0], range[1]);
  if (style === 'QUOTE_SINGLE' || original.startsWith("'")) return `'${value.replace(/'/g, "''")}'`;
  if (style === 'QUOTE_DOUBLE' || original.startsWith('"')) return JSON.stringify(value);
  if (style === 'BLOCK_LITERAL' || style === 'BLOCK_FOLDED' || /^\|[+-]?|^>[+-]?/.test(original)) {
    const lineStart = source.lastIndexOf('\n', range[0] - 1) + 1;
    const headerIndent = source.slice(lineStart, range[0]).match(/^\s*/)?.[0].length ?? 0;
    const indent = ' '.repeat(headerIndent + 2);
    const lines = value.replace(/\r?\n$/, '').split(/\r?\n/);
    return `|-\n${lines.map(line => indent + line).join('\n')}`;
  }
  return safePlain(value) ? value : `'${value.replace(/'/g, "''")}'`;
}

export function replaceRegexScalars(text: string, context: RegexContext, patterns: readonly string[]): { replacements: Array<{ replacement: string; range: [number, number] }>; nextText: string; range: [number, number] } {
  if (sha256(text) !== context.documentRevision) throw new Error('The YAML document changed; reopen the Regex Tester before applying.');
  const ranges = context.sourceRanges?.length ? context.sourceRanges : [context.sourceRange];
  if (ranges.length !== patterns.length) throw new Error('The selected regex alternatives changed; reopen the Regex Tester before applying.');
  const replacements = ranges.map((range, index) => ({ replacement: encodeRegexScalar(patterns[index], text, range, context.yamlStyles?.[index] ?? context.yamlStyle), range }));
  let nextText = text;
  for (let index = replacements.length - 1; index >= 0; index--) {
    const edit = replacements[index];
    nextText = nextText.slice(0, edit.range[0]) + edit.replacement + nextText.slice(edit.range[1]);
  }
  const parsed = parseDocument(nextText, { uniqueKeys: true });
  if (parsed.errors.length) throw new Error(`The proposed regex edit would break YAML: ${parsed.errors[0].message}`);
  return { replacements, nextText, range: context.sourceRange };
}

export function replaceRegexScalar(text: string, context: RegexContext, pattern: string): RegexReplacement {
  const edit = replaceRegexScalars(text, context, [pattern]);
  return { replacement: edit.replacements[0].replacement, nextText: edit.nextText, range: edit.replacements[0].range };
}
