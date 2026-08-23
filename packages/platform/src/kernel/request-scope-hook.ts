import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import type { RequestMeta } from '@endora-commerce/contracts';
import type { TenantContext } from '../tenancy/tenant-context.js';
import { enterPlatformScope } from './scope.js';

/**
 * The HTTP entry into `enterPlatformScope` (feature 072, FR-015…FR-021).
 *
 * Registered by both the production composition root and the test harness, from
 * this one file on purpose: the two hand-written copies of the tenant hook it
 * replaces had already drifted apart in their comments, and a drift in *this*
 * hook is a silent cross-tenant leak rather than a failing test.
 *
 * ## Shape
 *
 * `done()` is called **synchronously inside** the store, which is what makes the
 * store propagate into every later hook and into the handler's awaited
 * continuations — `enterWith` from an async hook does not, and fails silently
 * (`tenancy/tenant-context.ts`). The work the scope wraps is therefore "the rest
 * of this request", expressed as a promise that settles when `reply.raw` emits
 * `close`. That one event covers success, error and client abort, so the scope
 * is disposed in all three cases with a single mechanism and no `try/finally`
 * spread across the response path.
 *
 * ## Ordering
 *
 * This hook must be registered **after** the auth hook (it derives tenancy from
 * `request.actor`) and **before** the sales-channel resolver (which fills the
 * scope's channel slot and whose refusal path writes an audit row, so it needs
 * tenancy). See the ordering note in `scope.ts` — that order is a constraint,
 * not an accident of registration.
 */

export interface RequestScopeHookOptions {
  /**
   * Derive the request's tenant context from the already-authenticated actor —
   * never from request inputs (Constitution XI). Rejecting here fails the
   * request through `done(err)`, exactly as the pre-kernel hook did.
   */
  buildTenantContext: (request: FastifyRequest) => Promise<TenantContext>;
}

function requestMetaOf(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers['user-agent'];
  return {
    requestId: request.id ? String(request.id) : null,
    ipAddress: request.ip ?? null,
    userAgent: Array.isArray(userAgent) ? (userAgent[0] ?? null) : (userAgent ?? null),
  };
}

export async function registerRequestScopeHook(
  app: FastifyInstance,
  options: RequestScopeHookOptions,
): Promise<void> {
  await app.register(
    fastifyPlugin(async (inner) => {
      inner.addHook('onRequest', (request, reply, done) => {
        options.buildTenantContext(request).then(
          (tenant) => {
            void enterPlatformScope(
              tenant,
              () =>
                new Promise<void>((resolve) => {
                  reply.raw.once('close', resolve);
                  done();
                }),
              { entryPoint: 'http', requestMeta: requestMetaOf(request) },
            ).catch((err: unknown) => {
              // Reaching here means the scope failed to close down, not that the
              // request failed — the response has already been written by then.
              request.log.error({ err }, 'platform scope disposal failed');
            });
          },
          (err: unknown) => done(err as Error),
        );
      });
    }),
  );
}
