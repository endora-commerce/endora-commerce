import type { Worker } from 'bullmq';

/**
 * The BullMQ `Worker` surface `defineModuleWorker` actually touches, as a stub.
 *
 * There is one of these rather than a hand-rolled object per file because the
 * seam grew obligations: since the Principle XVII worker repair it installs a
 * **work gate** in front of `processFn`, reconciles the worker against the
 * registry cache (`isPaused`) on every presence install, and drops it from the
 * registry when it emits `closed`. A stub missing any of the three used to be a
 * lie the type system was told with `as never`; now it makes the seam throw or
 * makes the reconcile skip, which is the loudness that keeps a half-registered
 * consumer from looking registered.
 *
 * `paused` is real state, not a call counter, because the reconcile is
 * level-triggered: it acts only on a mismatch, so a test that counted calls
 * would be measuring how many times presence was installed.
 */
export interface FakeModuleWorkerState {
  paused: boolean;
  pauseCalls: number;
  resumeCalls: number;
  /** Every `on(event, …)` the seam or the logging attached, in order. */
  listenedEvents: string[];
}

export type FakeJob = Record<string, unknown>;

export interface FakeModuleWorker {
  /** Pass this to `defineModuleWorker` (it is a `Worker` for the seam's purposes). */
  readonly worker: Worker;
  readonly state: FakeModuleWorkerState;
  /** Run the worker's processor the way BullMQ's `callProcessJob` would. */
  process(job?: FakeJob, token?: string): Promise<unknown>;
  /** Fire a BullMQ lifecycle event at the handlers the seam attached. */
  emit(event: string, ...args: unknown[]): void;
  /** The last backoff `Worker.rateLimit` was asked for, or `null`. */
  rateLimitedForMs(): number | null;
}

export interface FakeModuleWorkerOptions {
  readonly name?: string;
  /** The module's own processor, i.e. what the work gate must guard. */
  readonly processor?: (job: FakeJob, token?: string) => Promise<unknown>;
}

export function makeFakeModuleWorker(options: FakeModuleWorkerOptions = {}): FakeModuleWorker {
  const state: FakeModuleWorkerState = {
    paused: false,
    pauseCalls: 0,
    resumeCalls: 0,
    listenedEvents: [],
  };
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let rateLimited: number | null = null;

  const worker = {
    name: options.name ?? 'fixture.queue',
    processFn: async (job: unknown, token?: string) =>
      (options.processor ?? (async () => undefined))(job as FakeJob, token),
    pause: async (): Promise<void> => {
      state.pauseCalls += 1;
      state.paused = true;
    },
    resume: (): void => {
      state.resumeCalls += 1;
      state.paused = false;
    },
    isPaused: (): boolean => state.paused,
    rateLimit: async (expireTimeMs: number): Promise<void> => {
      rateLimited = expireTimeMs;
    },
    on(event: string, handler: (...args: unknown[]) => void) {
      state.listenedEvents.push(event);
      const bucket = handlers.get(event) ?? [];
      bucket.push(handler);
      handlers.set(event, bucket);
      return this;
    },
  };

  return {
    worker: worker as unknown as Worker,
    state,
    process: async (job: FakeJob = {}, token = 'token') =>
      (worker as unknown as { processFn: (j: unknown, t?: string) => Promise<unknown> }).processFn(
        job,
        token,
      ),
    emit: (event: string, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
    rateLimitedForMs: () => rateLimited,
  };
}
