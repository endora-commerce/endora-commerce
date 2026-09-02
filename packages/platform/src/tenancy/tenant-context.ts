import { AsyncLocalStorage } from 'async_hooks';

/**
 * Systemic Organization Tenant Scoping (feature 050).
 *
 * The ambient `TenantContext` is the single source of truth for "which tenant
 * is this async execution allowed to see?". It is derived server-side from the
 * authenticated actor (never from request inputs) and read by the MikroORM
 * filter's `cond` thunk **when a query is built** (`filters.ts`) — never stamped
 * onto an EntityManager. `forkScopedEm` is a bare `orm.em.fork()`; a manager
 * therefore carries no tenancy of its own, and the same fork yields different
 * rows under different ambient contexts (feature 072, T038).
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
  /** `api_key` (feature 062) = a bound distributor key acting as the tenant principal. */
  readonly kind: 'customer' | 'admin' | 'system' | 'api_key';
  readonly id?: string;
}

export interface TenantImpersonation {
  readonly realAdminUserId: string;
  readonly impersonatedCustomerAccountId: string;
}

/**
 * What the tenant guard **did** to this execution, as opposed to what it was
 * allowed to do (feature 087, owner decision of 2026-08-29).
 *
 * A predicate that refuses every row of a table is correct and silent, and the
 * two properties are in tension: the caller receives an empty result and cannot
 * tell "your reach excludes all of these" from "there are none". The filter is
 * the only thing that knows which it meant, so it records it here and the host
 * discloses it on the response envelope (`kernel/request-scope-hook.ts`).
 *
 * Mutable, and deliberately so: one object per request, created beside the
 * context it hangs off, written by the filter as queries run and read once the
 * handler has answered. It is an observation of this execution, never an input
 * to a decision — nothing in the guard reads it, so a stale or missing sink can
 * widen no authority.
 */
export interface TenantScopeNotices {
  /**
   * Set when the `customerAccount` filter answered its `allowed-set` arm with
   * the match-nothing predicate, i.e. the filtered entity carries no
   * organization column of its own. See `customerFilterCond`.
   */
  organizationAttributionRefused: boolean;
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
  /**
   * Per-request observation sink. Attached by `resolveTenantContext` to the
   * contexts whose predicates can refuse wholesale (`allowed-set`), absent
   * everywhere else — a mode that never refuses has nothing to disclose.
   */
  readonly notices?: TenantScopeNotices;
}

/**
 * Record that the ambient execution was refused a whole table for want of an
 * organization column. A context with no sink (every mode but `allowed-set`,
 * and any context a caller built by hand) drops the observation, which is the
 * right failure: the disclosure goes missing, never the refusal.
 */
export function noteOrganizationAttributionRefusal(ctx: TenantContext): void {
  if (ctx.notices) ctx.notices.organizationAttributionRefused = true;
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

/**
 * The store is `TenantContext | undefined` rather than `TenantContext` so that
 * `runWithoutTenantContext` can express "no context" as a value it *runs* with
 * — see the note on that function for why it may not use `exit()`.
 */
const storage = new AsyncLocalStorage<TenantContext | undefined>();

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

/**
 * Run `fn` with NO ambient context (fail-closed testing / explicit clears).
 *
 * **`storage.run(undefined, fn)`, never `storage.exit(fn)`.** On the
 * pre-`AsyncContextFrame` runtime — which is every Node before 24, and this
 * repository's floor is 22.17 — `exit` is `disable(); try { fn() } finally
 * { enable() }`: a *synchronous* try/finally around a callback that may be
 * `async`. Where the caller's context was installed with `enterWith` and `fn`
 * opens a nested `run()` of its own, the re-enable resurfaces the caller's
 * store and everything after that point reads it, so the "no context" this
 * function promises silently ends partway through. Node 24 made
 * `AsyncContextFrame` the default and `exit` frame-scoped, which is why the
 * defect was invisible on a developer's machine and red in CI for as long as it
 * stood (`test/unit/seeds/seed-scope.test.ts`,
 * `test/unit/kernel/registry-cache-scope.test.ts`).
 *
 * Running with `undefined` as the store is the same observable contract —
 * `getStore()` answers `undefined`, and the caller's context is restored on
 * both return and throw — and it is a real frame, so it holds across `await`
 * on both runtimes. Verified on 22.17 and on 26.
 */
export function runWithoutTenantContext<T>(fn: () => T): T {
  return storage.run(undefined, fn);
}
