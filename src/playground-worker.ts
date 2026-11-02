import { parentPort, workerData } from 'node:worker_threads';
const results = (workerData.patterns as string[]).map(pattern => {
  try {
    const match = new RegExp(pattern, workerData.flags as string).exec(workerData.input as string);
    return { matched: Boolean(match), captures: match ? [...match].slice(1) : [] };
  } catch (error) { return { matched: false, captures: [], error: error instanceof Error ? error.message : String(error) }; }
});
parentPort?.postMessage(results);
