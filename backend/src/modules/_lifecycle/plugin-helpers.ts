import type { FastifyInstance } from 'fastify';
import type { Worker } from 'bullmq';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { ModulePlugin } from '../../http/server.js';
import { registryCache } from './services/registry-cache.js';

/**
 * Thrown when service-to-service code calls into a disabled module's
 * surface. Surfaces as `503 Service Unavailable` via the standard error
 * envelope.
 */
export class ModuleDisabledError extends HttpError {
  constructor(public readonly moduleId: string) {
    super(
      503,
      ERROR_CODES.MODULE_DISABLED,
      `Module '${moduleId}' is currently disabled.`,
    );
    this.name = 'ModuleDisabledError';
  }
}

/**
 * Programmatic gate. Throw from anywhere outside an HTTP request when
 * a disabled module's logic should not run. Surfaces consistently as
 * the same 503 envelope when reached from a route handler.
 */
export function requireModuleEnabled(moduleId: string): void {
  if (!registryCache.isEnabled(moduleId)) {
    throw new ModuleDisabledError(moduleId);
  }
}

/**
 * Wrap a Fastify plugin so every route registered inside it is gated on
 * the module's enabled state. Disabled module → 503 with
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
 *      clients back off until the next enable-check window.
 */
export function defineModuleRoutes(
  moduleId: string,
  register: (app: FastifyInstance) => Promise<void> | void,
): ModulePlugin {
  return async (app: FastifyInstance) => {
    await app.register(async (scoped) => {
      scoped.addHook('onRequest', async (_request, reply) => {
        if (!registryCache.isEnabled(moduleId)) {
          reply.header('Retry-After', '60');
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
 * Wrap a BullMQ Worker so it pauses when its module is disabled.
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
  if (!registryCache.isEnabled(moduleId)) {
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
 * owning module is disabled. Mirrors `EventBus.on(eventName, handler)`'s
 * unsubscribe-returning shape.
 */
export function subscribeForModule<E, P>(
  moduleId: string,
  bus: { on(event: E, handler: (payload: P) => void | Promise<void>): () => void },
  event: E,
  handler: (payload: P) => void | Promise<void>,
): () => void {
  const wrapped = async (payload: P): Promise<void> => {
    if (!registryCache.isEnabled(moduleId)) return;
    await handler(payload);
  };
  return bus.on(event, wrapped);
}
