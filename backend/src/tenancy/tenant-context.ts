import { AsyncLocalStorage } from 'async_hooks';

/**
 * Systemic Organization Tenant Scoping (feature 050).
 *
 * The ambient `TenantContext` is the single source of truth for "which tenant
 * is this async execution allowed to see?". It is derived server-side from the
 * authenticated actor (never from request inputs) and read by the scoped EM
 * factory to stamp MikroORM filter params.
 *
 * Modes:
 *  - `single-org`   — a customer (or an org-pinned job); confined to one org.
 *  - `allowed-set`  — a scoped sales-rep admin; confined to an assigned set.
 *  - `all`          — a platform admin; no org restriction (still explicit).
 *  - `system`       — worker / migration / escape hatch; crosses all orgs.
 *
 * Fail-closed: a query against a tenant-scoped entity with NO ambient context
 * raises `MissingTenantContextError` (see `filters.ts`) — it never returns
 * unscoped rows.
 */

export type TenantScopeMode = 'single-org' | 'allowed-set' | 'all' | 'system';

export interface TenantActor {
  readonly kind: 'customer' | 'admin' | 'system';
  readonly id?: string;
}

export interface TenantImpersonation {
  readonly realAdminUserId: string;
  readonly impersonatedCustomerAccountId: string;
}

export interface TenantContext {
  readonly mode: TenantScopeMode;
  /** Present for `single-org`. */
  readonly organizationId?: string | null;
  /** Present for `allowed-set`. */
  readonly allowedOrganizationIds?: readonly string[];
  /** Present for customer actors — drives the `customerAccount` filter. */
  readonly customerAccountId?: string | null;
  readonly actor: TenantActor;
  readonly impersonation?: TenantImpersonation;
  /** Required for `system` scope entered via the escape hatch. */
  readonly reason?: string;
}

/**
 * Thrown when a tenant-scoped entity is queried with no ambient context. This is
 * the fail-closed guarantee: forgetting to establish a context surfaces as a loud
 * error, never a silent cross-tenant read.
 */
export class MissingTenantContextError extends Error {
  constructor(detail?: string) {
    super(
      `No tenant context is active for a tenant-scoped query.${
        detail ? ` (${detail})` : ''
      } Establish one via the request pipeline, or opt out explicitly with withSystemScope()/withOrgScope().`,
    );
    this.name = 'MissingTenantContextError';
  }
}

const storage = new AsyncLocalStorage<TenantContext>();

/** The ambient context for the current async execution, or `undefined` if none is set. */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/** Run `fn` with `ctx` as the ambient context for its entire async subtree. */
export function runWithTenantContext<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Set the ambient context for the current async execution. NOTE: when called
 * inside an *async* Fastify hook this does not propagate to the route handler
 * (the handler resumes in the hook's parent async context). Prefer
 * `runInTenantContext` in the request pipeline; keep this only for synchronous
 * top-level entrypoints (e.g. a worker process bootstrap).
 */
export function enterTenantContext(ctx: TenantContext): void {
  storage.enterWith(ctx);
}

/**
 * Establish `ctx` for the remainder of a Fastify request via the callback-style
 * hook pattern: `addHook('onRequest', (req, reply, done) => runInTenantContext(ctx, done))`.
 * Fastify invokes the next hook/handler synchronously inside `callback`, so the
 * store propagates across the handler's awaited continuations. This is the
 * reliable AsyncLocalStorage-with-Fastify pattern (cf. @fastify/request-context).
 */
export function runInTenantContext(ctx: TenantContext, callback: () => void): void {
  storage.run(ctx, callback);
}
