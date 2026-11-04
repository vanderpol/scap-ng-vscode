import { isMap, isScalar, isSeq, parseDocument, type Scalar } from 'yaml';
import { sha256 } from './metadata.js';
import type { RegexCaptureSpan } from './playground.js';

export type RegexSourceKind = 'matches_regex' | 'regex_capture';
export interface RegexContext {
  kind: RegexSourceKind;
  pattern: string;
  path: (string | number)[];
  sourceRange: [number, number];
  testId?: string;
  capability?: string;
  documentRevision: string;
  yamlStyle?: string;
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
  const wanted = (range: readonly number[]) => Math.max(offset, range[0]) <= Math.min(selectionEnd, range[1]);
  const visit = (node: any, path: (string | number)[], ancestors: string[]): RegexContext | undefined => {
    if (isScalar(node) && Array.isArray(node.range) && wanted(node.range)) {
      const key = typeof path.at(-1) === 'string' ? String(path.at(-1)) : '';
      const isMatch = path.includes('matches_regex');
      const isCapture = key === 'pattern' && path.includes('regex_capture');
      if (isMatch || isCapture) {
        const value = (node as any).value;
        if (typeof value !== 'string') return undefined;
        const tests = path.indexOf('tests');
        const testId = tests >= 0 && typeof path[tests + 1] === 'string' ? String(path[tests + 1]) : undefined;
        const capability = tests >= 0 ? valueAt(document.toJS({ maxAliasCount: 50 }), ['assessment', 'tests', testId ?? '', 'capability']) : undefined;
        return {
          kind: isCapture ? 'regex_capture' : 'matches_regex', pattern: value,
          path: [...path], sourceRange: [node.range[0], node.range[1]], testId,
          capability: typeof capability === 'string' ? capability : undefined,
          documentRevision: sha256(text), yamlStyle: node.type
        };
      }
    }
    if (isMap(node)) {
      for (const pair of node.items ?? []) {
        const key = (pair as any).key?.value;
        if (typeof key !== 'string') continue;
        const found = visit(pair.value, [...path, key], [...ancestors, key]);
        if (found) return found;
      }
    } else if (isSeq(node)) {
      for (let index = 0; index < (node.items ?? []).length; index++) {
        const found = visit(node.items[index], [...path, index], ancestors);
        if (found) return found;
      }
    }
    return undefined;
  };
  return visit(document.contents, [], []);
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
    const column = range[0] - lineStart;
    const indent = ' '.repeat(column);
    const lines = value.split(/\r?\n/);
    return `|-\n${lines.map(line => indent + '  ' + line).join('\n')}`;
  }
  return safePlain(value) ? value : `'${value.replace(/'/g, "''")}'`;
}

export function replaceRegexScalar(text: string, context: RegexContext, pattern: string): RegexReplacement {
  if (sha256(text) !== context.documentRevision) throw new Error('The YAML document changed; reopen the Regex Tester before applying.');
  const replacement = encodeRegexScalar(pattern, text, context.sourceRange, context.yamlStyle);
  const nextText = text.slice(0, context.sourceRange[0]) + replacement + text.slice(context.sourceRange[1]);
  const parsed = parseDocument(nextText, { uniqueKeys: true });
  if (parsed.errors.length) throw new Error(`The proposed regex edit would break YAML: ${parsed.errors[0].message}`);
  return { replacement, nextText, range: context.sourceRange };
}
