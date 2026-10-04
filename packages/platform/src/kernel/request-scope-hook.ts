import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { SCOPE_NOTICE_CODES, type RequestMeta } from '@endora-commerce/contracts';
import {
  getTenantContext,
  RequestTenantContextCell,
  type TenantContext,
} from '../tenancy/tenant-context.js';
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
 *
 * ## Disclosure
 *
 * It also carries the *outbound* half (feature 087, owner decision of
 * 2026-08-29): `preSerialization` puts `meta.scopeNotice` on a successful body
 * when the tenant filter refused a whole table for want of an organization
 * column. It lives here, and not on each route, because that is the only place
 * both facts are in hand at once — the context this hook opened, and the body
 * about to go out — and because a per-route flag is a flag somebody forgets.
 * Both composition roots register this hook, so neither can disclose less than
 * the other.
 *
 * ## The route's gate decides whose request it is
 *
 * This hook runs in `onRequest`, before any route-level `preHandler`, so the
 * context it opens is derived from the actor the session cookies resolved to —
 * and a browser may hold two sessions. The route's own gate is what settles
 * which of them the request runs as, and it does so later. A context that
 * stayed as first derived would leave a request authorized as one actor and
 * scoped as another.
 *
 * So the context is held in a per-request cell, and {@link scopeRequestToActor}
 * derives it again — through the same mapping, over the same request — when
 * the gate has accepted an actor other than the one the context was derived
 * from. Authorization and scope then have one source: the gate. There is no
 * second declaration of a route's class to keep in step with it, which is what
 * a URL prefix or a per-route flag would be.
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

/**
 * What this hook remembers about one request: where its context lives, which
 * actor that context was derived from, and the mapping that derived it.
 *
 * Keyed by the request and holding no reference back to it, so the cell — which
 * is what the `AsyncLocalStorage` frame retains — pins neither the request nor
 * the reply (see `createPlatformScope` in `scope.ts` for what that costs).
 */
interface RequestScopeBinding {
  readonly cell: RequestTenantContextCell;
  derivedFrom: unknown;
  readonly buildTenantContext: (request: FastifyRequest) => Promise<TenantContext>;
}

const bindings = new WeakMap<FastifyRequest, RequestScopeBinding>();

/** `request.actor`, or `undefined` where no auth plugin decorated one. */
function actorOf(request: FastifyRequest): unknown {
  return (request as { actor?: unknown }).actor;
}

/**
 * Make the request's tenant context the one its **current** actor maps to.
 *
 * Called by a route gate once it has accepted an actor — `auth`'s admin and
 * customer guards both do. When that actor is the one the context was derived
 * from, which is every request carrying a single session, nothing happens.
 * When the gate has put a different actor on the request — an admin route
 * requested by a browser that also holds a customer session — the context is
 * derived again by the composition's own mapping, with every refusal that
 * mapping makes, and replaces the first for the rest of the request: the
 * tenant filters, the Command Bus's audit actor and the scope notice all read
 * the ambient context when they need it, not when the request began.
 *
 * It takes no context and no actor. What a request is scoped to stays a
 * function of `request.actor` and the mapping, exactly as in `onRequest`; this
 * only says *when* that function is asked again.
 *
 * It rejects when the mapping does, and the context is then left as it was —
 * so a gate that awaits it refuses the request rather than letting it through
 * on the earlier actor's scope.
 *
 * A request this hook never saw — a composition that mounts a gate without
 * the scope hook — has nothing to rebind, and the call is a no-op.
 */
export async function scopeRequestToActor(request: FastifyRequest): Promise<void> {
  const binding = bindings.get(request);
  if (binding === undefined) return;
  const actor = actorOf(request);
  if (binding.derivedFrom === actor) return;
  binding.cell.current = await binding.buildTenantContext(request);
  binding.derivedFrom = actor;
}

export async function registerRequestScopeHook(
  app: FastifyInstance,
  options: RequestScopeHookOptions,
): Promise<void> {
  await app.register(
    fastifyPlugin(async (inner) => {
      inner.addHook('onRequest', (request, reply, done) => {
        // Read before the mapping runs: the actor this context is derived
        // from is the one on the request now.
        const derivedFrom = actorOf(request);
        options.buildTenantContext(request).then(
          (tenant) => {
            const cell = new RequestTenantContextCell(tenant);
            bindings.set(request, {
              cell,
              derivedFrom,
              buildTenantContext: options.buildTenantContext,
            });
            void enterPlatformScope(
              tenant,
              () =>
                new Promise<void>((resolve) => {
                  reply.raw.once('close', resolve);
                  done();
                }),
              {
                entryPoint: 'http',
                requestMeta: requestMetaOf(request),
                requestTenantCell: cell,
              },
            ).catch((err: unknown) => {
              // Reaching here means the scope failed to close down, not that the
              // request failed — the response has already been written by then.
              request.log.error({ err }, 'platform scope disposal failed');
            });
          },
          (err: unknown) => done(err as Error),
        );
      });

      // The disclosure (feature 087). `preSerialization` runs inside the store
      // this hook opened — the `onRequest` callback calls `done()`
      // synchronously inside it, so the whole lifecycle continues in that async
      // context — which is what lets the sink written by the filter during the
      // handler be read here.
      inner.addHook('preSerialization', (_request, reply, payload, done) => {
        done(null, withScopeNotice(payload, reply.statusCode));
      });
    }),
  );
}

/**
 * Put `meta.scopeNotice` on `payload` when this execution's tenant filter
 * refused a whole table, and return `payload` untouched otherwise.
 *
 * Three things it deliberately does not do. It does not touch an **error**
 * body: a 4xx/5xx envelope is `{ error: … }` and already says why, and a notice
 * about emptiness on a refusal is noise. It does not touch a **non-object**
 * body — the newsletter CSV export is a string, and a Buffer or a stream is
 * nobody's envelope. And it does not overwrite an existing `meta`, it merges
 * into it, because `meta` is where two of the three surfaces already keep their
 * pagination.
 */
export function withScopeNotice(payload: unknown, statusCode: number): unknown {
  if (statusCode >= 400) return payload;
  if (!getTenantContext()?.notices?.organizationAttributionRefused) return payload;
  if (typeof payload !== 'object' || payload === null) return payload;
  if (Array.isArray(payload) || Buffer.isBuffer(payload)) return payload;
  const body = payload as { meta?: unknown };
  const existingMeta =
    typeof body.meta === 'object' && body.meta !== null && !Array.isArray(body.meta)
      ? (body.meta as Record<string, unknown>)
      : {};
  return {
    ...body,
    meta: { ...existingMeta, scopeNotice: SCOPE_NOTICE_CODES.ORGANIZATION_ATTRIBUTION_PENDING },
  };
}
