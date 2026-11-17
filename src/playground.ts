import { Worker } from 'node:worker_threads';
import { createPCRE2, parseFlags, type PCRE2 } from 'pcre2-wasm';

/** Offline, bounded PCRE2 preview. This never evaluates an Assessment or claims compliance. */
export interface RegexCaptureSpan { group: number; name?: string; start: number; end: number; text: string | undefined; }
export interface RegexPreview { dialect: 'PCRE2-safe-preview'; pattern: string; input: string; matched: boolean; captures: (string | undefined)[]; namedCaptures: Record<string, string | undefined>; matchSpan?: [number, number]; spans: RegexCaptureSpan[]; error?: string; limited: boolean; timedOut?: boolean; }
const MAX_PATTERN = 10_000;
const MAX_INPUT = 100_000;
const MATCH_LIMIT = 1_000_000;
const DEPTH_LIMIT = 1_000;
const ALLOWED_FLAGS = 'imsxuUADg';
let pcrePromise: Promise<PCRE2> | undefined;
function pcre() { return pcrePromise ??= createPCRE2(); }
function result(pattern: string, input: string, error?: string, matched = false, captures: (string | undefined)[] = [], timedOut = false, namedCaptures: Record<string, string | undefined> = {}, matchSpan?: [number, number], spans: RegexCaptureSpan[] = []): RegexPreview {
  const bounded = input.slice(0, MAX_INPUT);
  return { dialect: 'PCRE2-safe-preview', pattern, input: bounded, matched, captures, namedCaptures, matchSpan, spans, error, timedOut, limited: bounded.length !== input.length };
}
export function regexSafetyError(pattern: string, flags = ''): string | undefined {
  if (pattern.length > MAX_PATTERN) return 'Preview pattern exceeds the offline safety limit.';
  if (![...flags].every(flag => ALLOWED_FLAGS.includes(flag))) return `Preview only permits PCRE2 flags: ${ALLOWED_FLAGS.split('').filter((flag, index, all) => all.indexOf(flag) === index && flag !== 'g').join(', ')}.`;
  try { parseFlags(flags); } catch (error) { return error instanceof Error ? error.message : String(error); }
  return undefined;
}
function spansFor(match: { match: string; index: number; groups: (string | null)[]; namedGroups?: Record<string, string | null> }, input: string): RegexCaptureSpan[] {
  const spans: RegexCaptureSpan[] = [{ group: 0, start: match.index, end: match.index + match.match.length, text: match.match }];
  let cursor = 1;
  for (const value of match.groups) {
    const text = value ?? undefined;
    const start = text === undefined ? -1 : input.indexOf(text, match.index);
    spans.push({ group: cursor++, start, end: start < 0 || text === undefined ? -1 : start + text.length, text });
  }
  return spans;
}
function previewFromMatch(pattern: string, input: string, match: { match: string; index: number; groups: (string | null)[]; namedGroups?: Record<string, string | null> }): RegexPreview {
  const captures = match.groups.map(value => value ?? undefined);
  const namedCaptures = Object.fromEntries(Object.entries(match.namedGroups ?? {}).map(([name, value]) => [name, value ?? undefined]));
  return result(pattern, input, undefined, true, captures, false, namedCaptures, [match.index, match.index + match.match.length], spansFor(match, input));
}
/** Synchronous compatibility is intentionally not provided: PCRE2 is initialized asynchronously. */
export async function previewRegex(pattern: string, input: string, flags = ''): Promise<RegexPreview> {
  const safetyError = regexSafetyError(pattern, flags);
  if (input.length > MAX_INPUT) return result(pattern, input, 'Preview input exceeds the offline safety limit.', false, [], false);
  if (safetyError) return result(pattern, input, safetyError);
  try {
    const match = (await pcre()).match(pattern, input, parseFlags(flags), { matchLimit: MATCH_LIMIT, depthLimit: DEPTH_LIMIT });
    return match ? previewFromMatch(pattern, input, match) : result(pattern, input);
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
    const worker = new Worker(new URL('./playground-worker.js', import.meta.url), { workerData: { patterns: pending.map(item => item.pattern), input: input.slice(0, MAX_INPUT), flags, matchLimit: MATCH_LIMIT, depthLimit: DEPTH_LIMIT }, execArgv: [] });
    const finish = (values?: Array<{ matched: boolean; captures: (string | undefined)[]; namedCaptures?: Record<string, string | undefined>; matchSpan?: [number, number]; spans?: RegexCaptureSpan[]; error?: string }>, timedOut = false, workerError?: string) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(initializationTimer); void worker.terminate();
      for (let i = 0; i < pending.length; i++) { const item = pending[i]; const value = values?.[i]; results[item.index] = result(item.pattern, input, value?.error ?? workerError ?? (timedOut ? 'Preview timed out and was cancelled.' : undefined), value?.matched ?? false, value?.captures ?? [], timedOut, value?.namedCaptures ?? {}, value?.matchSpan, value?.spans ?? []); }
      resolve(results as RegexPreview[]);
    };
    let timer: NodeJS.Timeout;
    const initializationTimer = setTimeout(() => finish(undefined, true), 2_000);
    worker.on('message', (message: { type: 'ready' | 'results'; values?: Array<{ matched: boolean; captures: (string | undefined)[]; error?: string }> }) => {
      if (message.type === 'ready') timer = setTimeout(() => finish(undefined, true), Math.max(1, Math.min(timeoutMs, 2_000)));
      else finish(message.values);
    });
    worker.once('error', (error: Error) => finish(undefined, false, `Preview worker failed: ${error.message}`));
  });
}
