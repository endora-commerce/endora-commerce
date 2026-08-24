import type { FastifyInstance } from 'fastify';
import { RateLimitError, type Worker } from 'bullmq';
import { ERROR_CODES, type ModuleDisabledDetails } from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { ModulePlugin } from '../../http/server.js';
import { effectiveState } from './effective-state.js';
import { FALLBACK_TTL_MS, registryCache } from './registry-cache.js';

/**
 * How long a client should wait before retrying a surface whose module is
 * absent — one enable-check window. Carried by the error itself, so a route
 * gate, a `requireModuleEnabled` call and a port resolution all answer the
 * same thing (feature 072, T059).
 */
const RETRY_AFTER_SECONDS = '60';

/**
 * Thrown when service-to-service code calls into a disabled module's
 * surface. Surfaces as `503 Service Unavailable` via the standard error
 * envelope, with `Retry-After` so a well-behaved client backs off rather than
 * treating the module as gone.
 *
 * **`details` names the module** (issue #161, `moduleDisabledDetailsSchema`).
 * The id was on the error object from the start, and every caller that catches
 * the throw could read it — but the envelope replaces an operator-visible
 * message with the registered sentence for its *code*, and this one code covers
 * every gated port in the platform, so the wire carried a generic "Module
 * Disabled." An operator refused a refund because a payment gateway is switched
 * off was not told which module to switch back on, which also undercut D-71's
 * own rationale: the remedy was named on the object, not on the response.
 * `details` is the part of the envelope that survives the replacement, and the
 * sentence interpolates `{module}` out of it. `carts` had already written the
 * same key by hand for its one contribution-point refusal
 * (`src/modules/carts/backend.ts`); this makes the platform-wide throw agree.
 */
export class ModuleDisabledError extends HttpError {
  constructor(public readonly moduleId: string) {
    super(
      503,
      ERROR_CODES.MODULE_DISABLED,
      `Module '${moduleId}' is currently disabled.`,
      { module: moduleId } satisfies ModuleDisabledDetails,
      { 'Retry-After': RETRY_AFTER_SECONDS },
    );
    this.name = 'ModuleDisabledError';
  }
}

/**
 * Let a module's presence answer through a `catch` that legitimately absorbs
 * everything else (issue #84 — the deferred half of feature 072's D-43).
 *
 * `lazyPort` resolves inside the forwarded call, so a switched-off owner
 * surfaces as {@link ModuleDisabledError} **at the call site**. A
 * `try { … } catch { return null }` around one silently converts fail-closed
 * into fail-open: the caller answers "no data" where the truthful answer is
 * "this capability is off", and the operator reads a working screen that is
 * lying to them.
 *
 * The first fix for that is to delete the `catch` — most of them exist only
 * because somebody was being defensive, and where a degrade genuinely belongs
 * it belongs **inside the owner's implementation**, expressed in the return
 * type (`allowedIdsFor(): Promise<string[] | null>` is the worked example).
 *
 * This helper is for the remainder: a tolerance that is correct *as a
 * tolerance* — a per-item import failure recorded as an issue rather than
 * failing the run, a compensating cleanup on a rollback path, a notification
 * that must not undo the write it announces. None of those wants to absorb the
 * presence answer too, because that answer is about the whole operation rather
 * than the one item, and the run that "completed with 4 000 failures" is a
 * worse report than the one that stopped saying `catalog` is switched off.
 *
 * ```ts
 * } catch (error) {
 *   rethrowIfModuleDisabled(error);
 *   state.countFailed();
 * }
 * ```
 *
 * It is deliberately greppable: `scripts/check-port-catches.ts` reads it as the
 * one spelling that distinguishes a narrowed tolerance from a bare `catch`.
 */
export function rethrowIfModuleDisabled(error: unknown): void {
  if (error instanceof ModuleDisabledError) throw error;
}

/**
 * Programmatic gate. Throw from anywhere outside an HTTP request when
 * an absent module's logic should not run. Surfaces consistently as
 * the same 503 envelope when reached from a route handler.
 *
 * "Absent" is the **effective** state — platform availability AND operator
 * activation (Constitution XVII). A caller never learns there are two axes;
 * it learns the module is not there.
 */
export function requireModuleEnabled(moduleId: string): void {
  if (!effectiveState.isPresent(moduleId)) {
    throw new ModuleDisabledError(moduleId);
  }
}

/**
 * Wrap a Fastify plugin so every route registered inside it is gated on
 * the module's effective state. Absent module → 503 with
 * `Retry-After: 60`; enabled module → handler runs normally.
 *
 * Use it at the top of every module's `routes.admin.ts` /
 * `routes.storefront.ts`:
 *
 *   export const blogRoutes = defineModuleRoutes('blog', async (app) => {
 *     app.get('/api/v1/admin/blog/posts', { preHandler: requireAdmin() }, h);
 *   });
 *
 * Two HTTP-level effects:
 *   1. The wrapper registers a child encapsulated context, so the
 *      preHandler hook only fires for routes registered inside `register`.
 *   2. The 503 response includes `Retry-After: 60` so well-behaved
 *      clients back off until the next enable-check window. The header now
 *      travels on {@link ModuleDisabledError} itself, so the same 503 from a
 *      service call or a port resolution carries it too.
 */
export function defineModuleRoutes(
  moduleId: string,
  register: (app: FastifyInstance) => Promise<void> | void,
): ModulePlugin {
  return async (app: FastifyInstance) => {
    await app.register(async (scoped) => {
      scoped.addHook('onRequest', async () => {
        if (!effectiveState.isPresent(moduleId)) {
          throw new ModuleDisabledError(moduleId);
        }
      });
      await register(scoped);
    });
  };
}

/**
 * Minimal structured-logger surface used for queue-consumer lifecycle logs.
 * Fastify's `app.log` (a pino instance) satisfies this; a console-style shim
 * does too. Kept narrow so `plugin-helpers` need not depend on Fastify types.
 */
export interface WorkerLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface DefineModuleWorkerOptions {
  /**
   * When provided, the worker's lifecycle events (ready / active / completed /
   * failed / stalled / error) are logged with this logger. This gives the
   * `worker` / `worker:dev` processes a visible heartbeat so operators can tell
   * a queue is actually consuming jobs (and see why one fails or stalls).
   */
  logger?: WorkerLogger;
}

/**
 * Attach structured lifecycle logging to a BullMQ worker. Every queue consumer
 * gets the same shape of log line — `{ module, queue, jobId, jobName, ... }` —
 * so the `worker` process output reads consistently across modules.
 */
function attachWorkerLogging(moduleId: string, worker: Worker, logger: WorkerLogger): void {
  const queue = worker.name;
  const base = { module: moduleId, queue };
  logger.info(base, 'queue consumer registered');
  worker.on('ready', () => {
    logger.info(base, 'queue consumer ready (connected to Redis)');
  });
  worker.on('active', (job) => {
    logger.info({ ...base, jobId: job.id, jobName: job.name, data: job.data }, 'queue job active');
  });
  worker.on('completed', (job) => {
    const durationMs =
      job.finishedOn != null && job.processedOn != null
        ? job.finishedOn - job.processedOn
        : undefined;
    logger.info(
      { ...base, jobId: job.id, jobName: job.name, durationMs },
      'queue job completed',
    );
  });
  worker.on('failed', (job, err) => {
    logger.error(
      {
        ...base,
        jobId: job?.id,
        jobName: job?.name,
        data: job?.data,
        attemptsMade: job?.attemptsMade,
        err,
      },
      'queue job failed',
    );
  });
  worker.on('stalled', (jobId) => {
    logger.warn({ ...base, jobId }, 'queue job stalled — moved back to wait list');
  });
  worker.on('error', (err) => {
    logger.error({ ...base, err }, 'queue consumer error');
  });
}

/**
 * Every worker a module registered, in **this** process.
 *
 * Which is the whole reason the registry alone was never the gate: a push into
 * it reaches the process that pushed and nothing else, and the two processes
 * that flip presence are exactly the two that hold no workers — the API process
 * serving `/api/v1/admin/modules/:id/activation`, and the `module:*` CLI, which
 * composes nothing (D-157.2) and therefore registers nothing. See
 * {@link reconcileModuleWorkers}.
 */
const moduleWorkers = new Map<string, Set<Worker>>();

/**
 * How long a worker backs off after refusing a job for an absent module.
 *
 * One presence-refresh window — the degraded-mode cadence, which is the longest
 * a process's answer can be behind the database when the notification channel
 * is down. That makes the backoff "ask again when this process could plausibly
 * have learned something new", which is the only thing it is for: once
 * {@link reconcileModuleWorkers} has paused the worker nothing is fetched at
 * all, so this is a fallback's cadence and never a steady state's.
 *
 * It is deliberately **not** {@link RETRY_AFTER_SECONDS}, the 60 s a 503'd HTTP
 * client is told to wait, and the difference was measured rather than reasoned
 * about: BullMQ's `waitForRateLimit` delays the fetch loop for the whole
 * remaining window, and it holds across a `resume()`. At 60 s a job caught in
 * the flip window sat for the better part of a minute after the operator
 * switched the module back on — correct, and indistinguishable from broken.
 */
const ABSENT_JOB_BACKOFF_MS = FALLBACK_TTL_MS;

/** Marks a worker whose processor already carries the work gate. */
const GATED = Symbol.for('endora.moduleWorker.presenceGated');

/**
 * The property BullMQ's `Worker.callProcessJob` reads at call time. It is
 * `protected`, which is a compile-time notion; the value is an ordinary own
 * property assigned in the constructor, and replacing it is how the work gate
 * gets in front of a processor the module has already bound.
 *
 * Named as a type rather than cast inline so the coupling has one place to be
 * found when BullMQ renames it — and {@link installWorkGate} **throws** rather
 * than shrugging when the property is not a function, because the alternative
 * is a gate that silently is not there.
 */
interface BullMqProcessorSlot {
  processFn?: (job: unknown, token?: string, signal?: AbortSignal) => Promise<unknown>;
  [GATED]?: true;
}

/**
 * The work gate — Constitution XVII, and AGENTS.md's rule for an entry point
 * with nowhere to throw to: *presence is decided before the work, first and
 * outside the `try`*.
 *
 * A BullMQ processor is such an entry point. The fetch gate below stops a
 * worker within one presence install of the flip, but a job already fetched
 * when presence moved would still run its module's business logic — which for
 * `google_analytics` means one more disclosure to a third party after the
 * operator withdrew it. So the decision is per job.
 *
 * **What happens to the job: it is left waiting.** `Worker.rateLimit` plus
 * `RateLimitError` is BullMQ's own idiom for "not now, put it back": the worker
 * handles that error with `job.moveToWait(token)`, which RPUSHes the job onto
 * the wait list, emits `waiting`, consumes no attempt and fires no `failed`
 * handler. Failing the job would burn its retries against a decision that is
 * not about the job, and completing it would drop work an operator never asked
 * to lose. Deactivation is "non-destructive and reversible" (Principle XVII),
 * so the job drains when the module comes back.
 */
function installWorkGate(moduleId: string, worker: Worker): void {
  const slot = worker as unknown as BullMqProcessorSlot;
  if (slot[GATED]) return;
  const inner = slot.processFn;
  if (typeof inner !== 'function') {
    throw new Error(
      `[kernel] module '${moduleId}' registered a queue consumer whose processor could not be ` +
        `found (BullMQ's \`Worker.processFn\`). Without it the worker would keep running the ` +
        `module's business logic after an operator switched the module off (Constitution XVII). ` +
        `If BullMQ has renamed the property, \`installWorkGate\` is the one place that names it.`,
    );
  }
  slot.processFn = async (job, token, signal) => {
    // First, and outside every `try`: a switched-off module and a genuine
    // failure must not share one silent no-op. `isPresent` throws on a cache
    // nothing has loaded, and "nothing has read the database yet" is not an
    // answer a processor can act on either — so it reads as absent, which is
    // the direction that loses no work.
    if (!isPresentOrUnresolved(moduleId)) {
      await worker.rateLimit(ABSENT_JOB_BACKOFF_MS);
      throw new RateLimitError();
    }
    return inner.call(worker, job, token, signal);
  };
  slot[GATED] = true;
}

/** Effective presence, with an unloaded cache reading as absent rather than throwing. */
function isPresentOrUnresolved(moduleId: string): boolean {
  return registryCache.isLoaded() && effectiveState.isPresent(moduleId);
}

/**
 * The fetch gate — bring every registered worker into agreement with its
 * module's effective state.
 *
 * Level-triggered and idempotent, so it is safe to run on every presence
 * install: BullMQ's own `pause()` and `resume()` are no-ops when the worker is
 * already there, and the comparison below keeps even those off the common path.
 *
 * This is what makes the repair work across processes. Every composed process —
 * API, `BACKEND_ROLE=worker`, `all` — keeps its own {@link registryCache} fresh
 * from the same `b2b:module:state-changed` channel (and from the degraded-mode
 * timer when Redis is unavailable), so following the cache means the worker
 * process reacts to a flip written anywhere, including by a CLI that composed
 * nothing.
 */
export function reconcileModuleWorkers(): void {
  if (!registryCache.isLoaded()) return;
  for (const [moduleId, workers] of moduleWorkers) {
    const present = effectiveState.isPresent(moduleId);
    for (const worker of workers) {
      if (present === !worker.isPaused()) continue;
      applyWorkerPresence(moduleId, worker, present);
    }
  }
}

/**
 * Pause or resume one worker, without waiting for it.
 *
 * A presence install is synchronous — it happens inside a pub/sub callback or a
 * timer tick — so this cannot be awaited, and `pause()` deliberately waits for
 * the jobs already running to finish (the non-destructive half: an in-flight job
 * completes, and nothing new is fetched).
 *
 * The `catch` is not a tolerance and is not a port catch (`Worker.pause` reaches
 * no module): it is what keeps a fire-and-forget promise from becoming an
 * **unhandled rejection**, which in a Node process is a crash rather than a
 * message. It is reachable — `pause()` reconnects the blocking connection to
 * wait for the active job, and a connection that is closing rejects — and it
 * costs nothing to say so out loud. The worker is left where it was; the next
 * presence install (the pub/sub message, or the degraded timer five seconds
 * later) tries again, which is what level-triggering buys.
 */
function applyWorkerPresence(moduleId: string, worker: Worker, present: boolean): void {
  const settled = present ? Promise.resolve(worker.resume()) : worker.pause();
  void settled.catch((err: unknown) => {
    console.warn(
      `[module-lifecycle] could not ${present ? 'resume' : 'pause'} a queue consumer of ` +
        `'${moduleId}' (${worker.name}); the next presence refresh will retry: ${
          err instanceof Error ? err.message : String(err)
        }`,
    );
  });
}

let reconcilerArmed = false;

function armWorkerReconciler(): void {
  if (reconcilerArmed) return;
  reconcilerArmed = true;
  registryCache.onPresenceInstalled(reconcileModuleWorkers);
}

/**
 * Register a BullMQ Worker as its module's, so both gates apply to it.
 *
 * Two things happen, and only the first was ever true: the worker joins the
 * per-module registry {@link pauseWorkersFor} iterates, **and** its processor is
 * wrapped in the work gate while the registry itself is reconciled against the
 * cache on every presence install. The returned worker is the same instance.
 *
 * A worker constructed outside this seam is a worker nothing can stop —
 * `check:worker-seam` is the ratchet for that, and `pwa`'s push consumer was
 * the live instance when it landed.
 */
export function defineModuleWorker<W extends Worker>(
  moduleId: string,
  worker: W,
  options?: DefineModuleWorkerOptions,
): W {
  const set = moduleWorkers.get(moduleId) ?? new Set<Worker>();
  set.add(worker);
  moduleWorkers.set(moduleId, set);
  if (options?.logger) {
    attachWorkerLogging(moduleId, worker, options.logger);
  }
  installWorkGate(moduleId, worker);
  armWorkerReconciler();
  // A closed worker is not a paused one, and resuming it would restart a queue
  // consumer whose owner has gone. Leaving it in the registry is also how the
  // map grew without bound across a long-lived process.
  worker.on('closed', () => {
    set.delete(worker);
    if (set.size === 0) moduleWorkers.delete(moduleId);
  });
  // If the module is currently absent at registration time, start paused.
  if (!isPresentOrUnresolved(moduleId)) {
    applyWorkerPresence(moduleId, worker, false);
  }
  return worker;
}

/**
 * Pause a module's workers now, without waiting for the next presence install.
 *
 * An **optimisation**, since the fetch gate above: the orchestrator's disable
 * path refreshes the cache and publishes the state change, which reconciles
 * every process including this one. Calling it here simply makes the local
 * process's answer immediate rather than one refresh away.
 */
export async function pauseWorkersFor(moduleId: string): Promise<void> {
  for (const w of moduleWorkers.get(moduleId) ?? []) {
    await w.pause();
  }
}

/**
 * Resume a module's workers now. The mirror of {@link pauseWorkersFor}, and an
 * optimisation on the same terms — note that it resumes on the **platform**
 * axis alone, which is safe only because the work gate re-asks for the
 * conjunction on every job.
 */
export async function resumeWorkersFor(moduleId: string): Promise<void> {
  for (const w of moduleWorkers.get(moduleId) ?? []) {
    await w.resume();
  }
}

/**
 * Test seam — empty the per-process worker registry.
 *
 * The suite shares one process per fork, so a worker registered by an earlier
 * test is still there for the reconcile the next one triggers. Production never
 * calls it: workers leave the registry when they close.
 */
export function resetModuleWorkersForTesting(): void {
  moduleWorkers.clear();
}

/**
 * Wrap an EventBus subscription so the handler is a no-op when the
 * owning module is absent. Mirrors `EventBus.on(eventName, handler)`'s
 * unsubscribe-returning shape.
 */
export function subscribeForModule<E, P>(
  moduleId: string,
  bus: { on(event: E, handler: (payload: P) => void | Promise<void>): () => void },
  event: E,
  handler: (payload: P) => void | Promise<void>,
): () => void {
  const wrapped = async (payload: P): Promise<void> => {
    if (!effectiveState.isPresent(moduleId)) return;
    await handler(payload);
  };
  return bus.on(event, wrapped);
}
