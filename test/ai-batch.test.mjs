import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureSharedAiBatchConcurrency, normalizeAiBatchConcurrency, runConcurrentStageBatch, runWithSharedAiBatchLimit } from '../dist/ai-batch.js';

test('batch concurrency is bounded to the default and maximum', () => {
  assert.equal(normalizeAiBatchConcurrency(undefined), 4);
  assert.equal(normalizeAiBatchConcurrency(0), 1);
  assert.equal(normalizeAiBatchConcurrency(99), 8);
  assert.equal(normalizeAiBatchConcurrency('6.9'), 6);
  assert.equal(normalizeAiBatchConcurrency('not-a-number'), 4);
});

test('accuracy stages are sequential per job while jobs run concurrently', async () => {
  configureSharedAiBatchConcurrency(8);
  const active = new Map();
  let max = 0;
  const events = [];
  const jobs = [0, 1, 2, 3].map(id => ({ id: String(id), value: 0 }));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const handle = runConcurrentStageBatch(jobs, [
    { name: 'generate', async run(value, context) { events.push(`${context.jobId}:generate`); active.set(context.jobId, (active.get(context.jobId) ?? 0) + 1); max = Math.max(max, [...active.values()].reduce((a, b) => a + b, 0)); await delay(5); active.set(context.jobId, active.get(context.jobId) - 1); return value + 1; } },
    { name: 'verify', async run(value, context) { events.push(`${context.jobId}:verify`); assert.equal(active.get(context.jobId) ?? 0, 0, 'a Rule must not overlap its own stages'); return value + 1; } }
  ], { concurrency: 2, maxAttempts: 1 });
  const result = await handle.promise;
  assert.equal(result.every(item => item.status === 'completed'), true);
  assert.ok(max <= 2);
  for (const id of ['0', '1', '2', '3']) assert.ok(events.indexOf(`${id}:generate`) < events.indexOf(`${id}:verify`));
});

test('quota failure is isolated and does not cancel peer jobs', async () => {
  configureSharedAiBatchConcurrency(4);
  const handle = runConcurrentStageBatch(
    [{ id: 'quota', value: 0 }, { id: 'good', value: 0 }],
    [{ name: 'generate', async run(value, context) { if (context.jobId === 'quota') throw Object.assign(new Error('provider quota exceeded'), { quotaOrRateLimit: true }); return value + 1; } }],
    { maxAttempts: 2, retryDelayMs: 0 }
  );
  const result = await handle.promise;
  assert.equal(result[0].status, 'quota-isolated');
  assert.equal(result[1].status, 'completed');
});

test('cancellation leaves queued and active jobs canceled', async () => {
  configureSharedAiBatchConcurrency(1);
  const controller = new AbortController();
  const handle = runConcurrentStageBatch(
    [{ id: 'one', value: 0 }, { id: 'two', value: 0 }],
    [{ name: 'generate', async run(value) { await new Promise(resolve => setTimeout(resolve, 50)); return value + 1; } }],
    { signal: controller.signal, concurrency: 2, maxAttempts: 1 }
  );
  setTimeout(() => controller.abort(), 5);
  const result = await handle.promise;
  assert.equal(result.every(item => item.status === 'cancelled'), true);
});

test('the shared limiter applies across simultaneously started batches', async () => {
  configureSharedAiBatchConcurrency(2);
  let active = 0;
  let max = 0;
  const stage = { name: 'generate', async run(value) { active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; return value + 1; } };
  const first = runConcurrentStageBatch([{ id: 'a', value: 0 }, { id: 'b', value: 0 }], [stage], { concurrency: 4, maxAttempts: 1 });
  const second = runConcurrentStageBatch([{ id: 'c', value: 0 }, { id: 'd', value: 0 }], [stage], { concurrency: 4, maxAttempts: 1 });
  const [one, two] = await Promise.all([first.promise, second.promise]);
  assert.equal(one.every(item => item.status === 'completed'), true);
  assert.equal(two.every(item => item.status === 'completed'), true);
  assert.ok(max <= 2);
});


test('interactive provider operations use the same shared limiter', async () => {
  configureSharedAiBatchConcurrency(1);
  let active = 0;
  let max = 0;
  const operation = async () => { active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 5)); active--; };
  await Promise.all([runWithSharedAiBatchLimit(operation), runWithSharedAiBatchLimit(operation)]);
  assert.equal(max, 1);
});
