import { parentPort, workerData } from 'node:worker_threads';
const results = (workerData.patterns as string[]).map(pattern => {
  try {
    const match = new RegExp(pattern, workerData.flags as string).exec(workerData.input as string);
    if (!match) return { matched: false, captures: [], namedCaptures: {}, spans: [] };
    const captures = [...match].slice(1);
    const namedCaptures = { ...(match.groups ?? {}) };
    const spans = [{ group: 0, start: match.index, end: match.index + match[0].length, text: match[0] }];
    captures.forEach((value, index) => {
      const start = value === undefined ? -1 : (workerData.input as string).indexOf(value, match.index);
      spans.push({ group: index + 1, start, end: start < 0 ? -1 : start + value.length, text: value });
    });
    return { matched: true, captures, namedCaptures, matchSpan: [match.index, match.index + match[0].length], spans };
  } catch (error) { return { matched: false, captures: [], namedCaptures: {}, spans: [], error: error instanceof Error ? error.message : String(error) }; }
});
parentPort?.postMessage(results);
