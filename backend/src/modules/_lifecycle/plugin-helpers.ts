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
 * Wrap a BullMQ Worker so it pauses when its module is disabled.
 *
 * The wrapper attaches the worker to a per-module registry that the
 * orchestrator iterates on disable/enable. The returned worker is the
 * same instance — registration is the only side effect.
 */
const moduleWorkers = new Map<string, Set<Worker>>();

export function defineModuleWorker<W extends Worker>(
  moduleId: string,
  worker: W,
): W {
  const set = moduleWorkers.get(moduleId) ?? new Set<Worker>();
  set.add(worker);
  moduleWorkers.set(moduleId, set);
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
