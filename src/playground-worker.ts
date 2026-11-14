import { parentPort, workerData } from 'node:worker_threads';
import { createPCRE2, parseFlags } from 'pcre2-wasm';

const data = workerData as { patterns: string[]; input: string; flags: string; matchLimit: number; depthLimit: number };
try {
  const pcre2 = await createPCRE2();
  parentPort?.postMessage({ type: 'ready' });
  const results = data.patterns.map(pattern => {
    try {
      const match = pcre2.match(pattern, data.input, parseFlags(data.flags), { matchLimit: data.matchLimit, depthLimit: data.depthLimit });
      if (!match) return { matched: false, captures: [], namedCaptures: {}, spans: [] };
      const captures = match.groups.map(value => value ?? undefined);
      const namedCaptures = Object.fromEntries(Object.entries(match.namedGroups ?? {}).map(([name, value]) => [name, value ?? undefined]));
      const spans: Array<{ group: number; start: number; end: number; text: string | undefined }> = [{ group: 0, start: match.index, end: match.index + match.match.length, text: match.match }];
      captures.forEach((value, index) => {
        const start = value === undefined ? -1 : data.input.indexOf(value, match.index);
        spans.push({ group: index + 1, start, end: start < 0 || value === undefined ? -1 : start + value.length, text: value });
      });
      return { matched: true, captures, namedCaptures, matchSpan: [match.index, match.index + match.match.length], spans };
    } catch (error) { return { matched: false, captures: [], namedCaptures: {}, spans: [], error: error instanceof Error ? error.message : String(error) }; }
  });
  parentPort?.postMessage({ type: 'results', values: results });
} catch (error) {
  throw error;
}
