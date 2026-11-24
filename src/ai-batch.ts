/**
 * Generic scheduler for AI authoring batches.
 *
 * A Rule is one job. Its accuracy stages always run in order (for example,
 * generate -> independently verify); different Rules may run concurrently.
 * This module is deliberately unaware of SCAP-NG syntax or Rule-specific
 * heuristics so the orchestration policy cannot become another content
 * generator.
 */

export const DEFAULT_AI_BATCH_CONCURRENCY = 4;
export const MAX_AI_BATCH_CONCURRENCY = 8;

export function normalizeAiBatchConcurrency(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_AI_BATCH_CONCURRENCY;
  return Math.min(MAX_AI_BATCH_CONCURRENCY, Math.max(1, Math.floor(numeric)));
}


class SharedBatchLimiter {
  private limit = DEFAULT_AI_BATCH_CONCURRENCY;
  private active = 0;
  private readonly waiters: Array<{ resolve: () => void; reject: (error: unknown) => void; signal: AbortSignal }> = [];
  setLimit(value: unknown) { this.limit = normalizeAiBatchConcurrency(value); this.drain(); }
  async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw new Error('Batch canceled.');
    if (this.active < this.limit) { this.active++; return () => { this.active--; this.drain(); }; }
    return new Promise((resolve, reject) => {
      const waiter = { resolve: () => { this.active++; resolve(() => { this.active--; this.drain(); }); }, reject, signal };
      this.waiters.push(waiter);
      signal.addEventListener('abort', () => { const index = this.waiters.indexOf(waiter); if (index >= 0) this.waiters.splice(index, 1); reject(new Error('Batch canceled.')); }, { once: true });
    });
  }
  private drain() {
    while (this.active < this.limit && this.waiters.length) {
      const waiter = this.waiters.shift()!;
      if (waiter.signal.aborted) { waiter.reject(new Error('Batch canceled.')); continue; }
      waiter.resolve();
    }
  }
}

/** One process-wide quota/concurrency gate shared by interactive and overnight batches. */
export const sharedAiBatchLimiter = new SharedBatchLimiter();

/** Run one provider operation under the same process-wide gate used by batch jobs.
 * Interactive authoring uses this helper directly; batch orchestration disables
 * its outer gate so a Rule's generation and verification do not acquire twice.
 */
export async function runWithSharedAiBatchLimit<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const localSignal = signal ?? new AbortController().signal;
  const release = await sharedAiBatchLimiter.acquire(localSignal);
  try { return await operation(); }
  finally { release(); }
}

export function configureSharedAiBatchConcurrency(value: unknown): number {
  const normalized = normalizeAiBatchConcurrency(value);
  sharedAiBatchLimiter.setLimit(normalized);
  return normalized;
}

export type BatchJobStatus = 'completed' | 'failed' | 'quota-isolated' | 'cancelled';

export interface BatchStageContext {
  readonly jobId: string;
  readonly stage: string;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export interface BatchStage<T> {
  readonly name: string;
  run(value: T, context: BatchStageContext): Promise<T>;
}

export interface BatchJob<T> {
  readonly id: string;
  readonly value: T;
}

export interface BatchJobResult<T> {
  readonly id: string;
  readonly status: BatchJobStatus;
  readonly value?: T;
  readonly error?: unknown;
  readonly failedStage?: string;
  readonly attempts: number;
  readonly quotaIsolated?: boolean;
}

export interface BatchProgress {
  readonly total: number;
  readonly completed: number;
  readonly active: number;
  readonly queued: number;
  readonly failed: number;
  readonly quotaIsolated: number;
  readonly cancelled: number;
  readonly jobId?: string;
  readonly stage?: string;
  readonly attempt?: number;
}

export interface ConcurrentStageBatchOptions {
  concurrency?: number;
  /** Attempts per accuracy stage, including the first attempt. */
  maxAttempts?: number;
  /** Backoff before a retry. It is not applied after cancellation. */
  retryDelayMs?: number | ((attempt: number, error: unknown, stage: string) => number);
  /** Quota errors are isolated to the affected Rule and never stop peers. */
  isQuotaError?: (error: unknown) => boolean;
  signal?: AbortSignal;
  /** Set false when each nested provider operation uses runWithSharedAiBatchLimit. */
  useSharedLimiter?: boolean;
  onProgress?: (progress: BatchProgress) => void;
  onStage?: (event: { jobId: string; stage: string; attempt: number; state: 'started' | 'retrying' | 'completed' | 'failed' }) => void;
}

export interface ConcurrentStageBatchHandle<T> {
  readonly promise: Promise<BatchJobResult<T>[]>;
  cancel(): void;
  cancelJob(jobId: string): void;
}

function defaultQuotaError(error: unknown): boolean {
  return Boolean((error as any)?.quotaOrRateLimit) || /\b(?:quota|rate[ -]?limit|insufficient[_ -]?quota|credits?|billing|tokens? exhausted)\b/i.test(error instanceof Error ? error.message : String(error));
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && /\b(?:cancel(?:led|ed)|abort(?:ed)?)\b/i.test(error.message));
}

function sleep(delay: number, signal: AbortSignal): Promise<void> {
  if (delay <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error('Batch canceled.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
    if (signal.aborted) { clearTimeout(timer); reject(new Error('Batch canceled.')); return; }
    signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Start a bounded batch. The returned handle permits cancellation without
 * leaking provider requests. Results retain the order of the input jobs.
 */
export function runConcurrentStageBatch<T>(jobs: readonly BatchJob<T>[], stages: readonly BatchStage<T>[], options: ConcurrentStageBatchOptions = {}): ConcurrentStageBatchHandle<T> {
  const concurrency = normalizeAiBatchConcurrency(options.concurrency);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 2));
  const quotaError = options.isQuotaError ?? defaultQuotaError;
  const controller = new AbortController();
  const unlink = options.signal ? (() => {
    const abort = () => controller.abort();
    if (options.signal!.aborted) controller.abort();
    else options.signal!.addEventListener('abort', abort, { once: true });
    return () => options.signal!.removeEventListener('abort', abort);
  })() : () => undefined;
  const jobControllers = new Map<string, AbortController>();
  const results: Array<BatchJobResult<T> | undefined> = new Array(jobs.length);
  let next = 0;
  let active = 0;
  let settled = 0;
  let completed = 0;
  let failed = 0;
  let quotaIsolated = 0;
  let cancelled = 0;
  let resolveBatch!: (value: BatchJobResult<T>[]) => void;
  let rejectBatch!: (reason: unknown) => void;
  const promise = new Promise<BatchJobResult<T>[]>((resolve, reject) => { resolveBatch = resolve; rejectBatch = reject; });
  const report = (jobId?: string, stage?: string, attempt?: number) => options.onProgress?.({ total: jobs.length, completed, active, queued: Math.max(0, jobs.length - settled - active), failed, quotaIsolated, cancelled, jobId, stage, attempt });
  const finish = () => {
    if (settled !== jobs.length) return;
    unlink();
    resolveBatch(results as BatchJobResult<T>[]);
  };
  const assign = () => {
    while (active < concurrency && next < jobs.length && !controller.signal.aborted) {
      const index = next++;
      const job = jobs[index];
      active++;
      const jobController = new AbortController();
      jobControllers.set(job.id, jobController);
      const onBatchAbort = () => jobController.abort();
      controller.signal.addEventListener('abort', onBatchAbort, { once: true });
      void execute(job, jobController.signal).then(result => {
        results[index] = result;
        if (result.status === 'completed') completed++;
        else if (result.status === 'failed') failed++;
        else if (result.status === 'quota-isolated') quotaIsolated++;
        else cancelled++;
      }).catch(error => {
        results[index] = { id: job.id, status: 'failed', error, attempts: 1 };
        failed++;
      }).finally(() => {
        active--; settled++; jobControllers.delete(job.id); controller.signal.removeEventListener('abort', onBatchAbort);
        report(job.id);
        if (settled === jobs.length) finish(); else { assign(); finish(); }
      });
    }
    if (controller.signal.aborted) {
      while (next < jobs.length) {
        const index = next++; const job = jobs[index];
        results[index] = { id: job.id, status: 'cancelled', error: new Error('Batch canceled.'), attempts: 0 };
        cancelled++; settled++;
      }
      report(); finish();
    }
  };
  const execute = async (job: BatchJob<T>, signal: AbortSignal): Promise<BatchJobResult<T>> => {
    let value = job.value;
    let attempts = 0;
    for (const stage of stages) {
      let stageSucceeded = false;
      for (let stageAttempt = 1; stageAttempt <= maxAttempts; stageAttempt++) {
        attempts++;
        if (signal.aborted) return { id: job.id, status: 'cancelled', error: new Error('Batch canceled.'), failedStage: stage.name, attempts };
        options.onStage?.({ jobId: job.id, stage: stage.name, attempt: stageAttempt, state: 'started' });
        report(job.id, stage.name, stageAttempt);
        let release: (() => void) | undefined;
        try {
          release = options.useSharedLimiter === false ? () => undefined : await sharedAiBatchLimiter.acquire(signal);
          value = await stage.run(value, { jobId: job.id, stage: stage.name, attempt: stageAttempt, signal });
          if (signal.aborted) {
            release?.(); release = undefined;
            return { id: job.id, status: 'cancelled', error: new Error('Batch canceled.'), failedStage: stage.name, attempts };
          }
          stageSucceeded = true;
          options.onStage?.({ jobId: job.id, stage: stage.name, attempt: stageAttempt, state: 'completed' });
          release?.(); release = undefined;
          break;
        } catch (error) {
          release?.(); release = undefined;
          if (isAbort(error, signal)) return { id: job.id, status: 'cancelled', error, failedStage: stage.name, attempts };
          const quota = quotaError(error);
          if (stageAttempt >= maxAttempts) {
            options.onStage?.({ jobId: job.id, stage: stage.name, attempt: stageAttempt, state: 'failed' });
            return { id: job.id, status: quota ? 'quota-isolated' : 'failed', error, failedStage: stage.name, attempts, quotaIsolated: quota };
          }
          options.onStage?.({ jobId: job.id, stage: stage.name, attempt: stageAttempt, state: 'retrying' });
          const delay = typeof options.retryDelayMs === 'function' ? options.retryDelayMs(stageAttempt, error, stage.name) : (options.retryDelayMs ?? 250) * 2 ** (stageAttempt - 1);
          await sleep(Math.max(0, delay), signal);
        }
      }
      if (!stageSucceeded) return { id: job.id, status: 'failed', error: new Error(`Stage ${stage.name} did not complete.`), failedStage: stage.name, attempts };
    }
    return { id: job.id, status: 'completed', value, attempts };
  };
  const handle: ConcurrentStageBatchHandle<T> = {
    promise,
    cancel: () => { controller.abort(); for (const item of jobControllers.values()) item.abort(); report(); finish(); },
    cancelJob: (jobId: string) => { jobControllers.get(jobId)?.abort(); }
  };
  try { assign(); } catch (error) { rejectBatch(error); }
  return handle;
}
