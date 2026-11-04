import { Worker } from 'node:worker_threads';

/** Offline, bounded regex preview. This never evaluates an Assessment or claims compliance. */
export interface RegexCaptureSpan { group: number; name?: string; start: number; end: number; text: string | undefined; }
export interface RegexPreview { dialect: 'ECMAScript-safe-preview'; pattern: string; input: string; matched: boolean; captures: string[]; namedCaptures: Record<string, string | undefined>; matchSpan?: [number, number]; spans: RegexCaptureSpan[]; error?: string; limited: boolean; timedOut?: boolean; }
const MAX_PATTERN = 10_000;
const MAX_INPUT = 100_000;
const UNSAFE_NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*{](?:[^()\\]|\\.)*\)(?:[+*{])/;
export function regexSafetyError(pattern: string, flags = ''): string | undefined {
  if (pattern.length > MAX_PATTERN) return 'Preview pattern exceeds the offline safety limit.';
  if (![...flags].every(flag => 'imsu'.includes(flag))) return 'Preview only permits ECMAScript i/m/s/u flags.';
  if (UNSAFE_NESTED_QUANTIFIER.test(pattern)) return 'Preview rejected a nested quantifier that may backtrack catastrophically.';
  if (/\\(?:\d{1,3}|k<[^>]+>)/.test(pattern)) return 'Preview rejects backreferences because their runtime is not bounded.';
  return undefined;
}
function result(pattern: string, input: string, error?: string, matched = false, captures: string[] = [], timedOut = false, namedCaptures: Record<string, string | undefined> = {}, matchSpan?: [number, number], spans: RegexCaptureSpan[] = []): RegexPreview {
  const bounded = input.slice(0, MAX_INPUT);
  return { dialect: 'ECMAScript-safe-preview', pattern, input: bounded, matched, captures, namedCaptures, matchSpan, spans, error, timedOut, limited: bounded.length !== input.length };
}
/** Synchronous helper for already-qualified safe patterns. The extension UI uses previewRegexSafe instead. */
export function previewRegex(pattern: string, input: string, flags = ''): RegexPreview {
  const safetyError = regexSafetyError(pattern, flags);
  if (input.length > MAX_INPUT) return result(pattern, input, 'Preview input exceeds the offline safety limit.', false, [], false);
  if (safetyError) return result(pattern, input, safetyError);
  try {
    const match = new RegExp(pattern, flags).exec(input);
    if (!match) return result(pattern, input, undefined, false, [], false, {});
    const captures = [...match].slice(1);
    const names = { ...(match.groups ?? {}) };
    const spans: RegexCaptureSpan[] = [{ group: 0, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, text: match[0] }];
    let cursor = 1;
    for (const value of captures) {
      const start = value === undefined ? -1 : input.indexOf(value, match.index ?? 0);
      spans.push({ group: cursor++, start, end: start < 0 ? -1 : start + value.length, text: value });
    }
    return result(pattern, input, undefined, true, captures, false, names, [match.index ?? 0, (match.index ?? 0) + match[0].length], spans);
  } catch (error) { return result(pattern, input, error instanceof Error ? error.message : String(error)); }
}
export async function previewRegexSafe(patterns: readonly string[], input: string, flags = '', timeoutMs = 100): Promise<RegexPreview[]> {
  const boundedPatterns = patterns.slice(0, 100);
  const immediate = boundedPatterns.map(pattern => regexSafetyError(pattern, flags));
  const results: Array<RegexPreview | undefined> = boundedPatterns.map((pattern, index) => immediate[index] ? result(pattern, input, immediate[index]) : undefined);
  const pending = boundedPatterns.map((pattern, index) => ({ pattern, index })).filter(item => !immediate[item.index]);
  if (!pending.length) return results as RegexPreview[];
  return await new Promise(resolve => {
    let settled = false;
    const worker = new Worker(new URL('./playground-worker.js', import.meta.url), { workerData: { patterns: pending.map(item => item.pattern), input: input.slice(0, MAX_INPUT), flags } });
    const finish = (values?: Array<{ matched: boolean; captures: string[]; namedCaptures?: Record<string, string | undefined>; matchSpan?: [number, number]; spans?: RegexCaptureSpan[]; error?: string }>, timedOut = false) => {
      if (settled) return; settled = true; clearTimeout(timer); void worker.terminate();
      for (let i = 0; i < pending.length; i++) { const item = pending[i]; const value = values?.[i]; results[item.index] = result(item.pattern, input, value?.error ?? (timedOut ? 'Preview timed out and was cancelled.' : undefined), value?.matched ?? false, value?.captures ?? [], timedOut, value?.namedCaptures ?? {}, value?.matchSpan, value?.spans ?? []); }
      resolve(results as RegexPreview[]);
    };
    const timer = setTimeout(() => finish(undefined, true), Math.max(1, Math.min(timeoutMs, 2_000)));
    worker.once('message', (values: Array<{ matched: boolean; captures: string[]; error?: string }>) => finish(values));
    worker.once('error', () => finish(undefined, false));
  });
}
