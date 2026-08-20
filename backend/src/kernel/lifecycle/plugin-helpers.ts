import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import { ERROR_CODES, type ModuleDisabledDetails } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { ModulePlugin } from '../../http/server.js';
import { effectiveState } from './effective-state.js';

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
 * Wrap a BullMQ Worker so it pauses when its module is absent.
 *
 * The wrapper attaches the worker to a per-module registry that the
 * orchestrator iterates on disable/enable. The returned worker is the
 * same instance — registration is the only side effect (plus optional
 * lifecycle logging when `options.logger` is supplied).
 */
const moduleWorkers = new Map<string, Set<Worker>>();

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
  // If the module is currently disabled at registration time, start paused.
  if (!effectiveState.isPresent(moduleId)) {
    void worker.pause();
  }
  return worker;
}

/** Used by the orchestrator's disable path. */
export async function pauseWorkersFor(moduleId: string): Promise<void> {
  for (const w of moduleWorkers.get(moduleId) ?? []) {
    await w.pause();
  }
}

/** Used by the orchestrator's enable path. */
export async function resumeWorkersFor(moduleId: string): Promise<void> {
  for (const w of moduleWorkers.get(moduleId) ?? []) {
    await w.resume();
  }
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
