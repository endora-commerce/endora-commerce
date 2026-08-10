import { asFunction } from 'awilix';
import type { RequestMeta } from '@b2b/contracts';
import { runWithTenantContext, type TenantContext } from '../tenancy/tenant-context.js';
import type { ResolvedChannel } from './ports/sales-channel.js';
import { getRootContainer, type KernelContainer, type KernelCradle } from './container.js';

/**
 * `enterPlatformScope` — the one entry into a scoped execution (feature 072,
 * FR-015…FR-021). Five callers: the HTTP `onRequest` hook, BullMQ processors,
 * the 15 CLI scripts, the four boot reconcilers and the four `setInterval`
 * sweeps.
 *
 * ## Three rules, none of them negotiable
 *
 * **1. AsyncLocalStorage stays the tenancy carrier.** `@OrgScoped` attaches a
 * MikroORM filter with `args: false` whose `cond` is a zero-argument thunk that
 * reads `getTenantContext()` **when the query is built**
 * (`tenancy/org-scoped.decorator.ts` → `tenancy/filters.ts`). The EntityManager
 * is therefore stateless with respect to tenancy, and that is exactly what makes
 * `forkScopedEm(orm) = orm.em.fork()` correct. Registering tenancy in the
 * container instead would require `setFilterParams` on a scoped EM and would
 * break every `em.transactional` sub-fork and every service that forks its own
 * manager. `test/integration/tenancy/fault-injection.test.ts` is this design's
 * unit test: it calls one EM factory inside five different ambient stores and
 * asserts five different result sets. Any design in which a scoped EM captures
 * tenancy at construction inverts every assertion in that file.
 *
 * **2. The ALS `run()` is the outermost wrapper of the work.** It is the
 * callback form (`storage.run`), never `storage.enterWith`: `enterWith` called
 * inside an *async* Fastify hook does not propagate into the handler, and it
 * fails **silently** (`tenancy/tenant-context.ts`). The consequence is
 * structural — the awilix scope cannot be created in a separate, earlier hook,
 * because its disposal and the store's lifetime would then not coincide.
 *
 * **3. The channel goes into the scope; tenancy does not.** The channel is
 * already per-request and has no non-HTTP counterpart. Tenancy must stay
 * establishable by CLI scripts, workers, boot reconcilers and interval timers
 * that will never have a request scope.
 *
 * ## `onRequest` hook ordering is load-bearing
 *
 * The three global `onRequest` hooks run in array order (`http/server.ts`):
 *
 *     auth  →  tenant  →  sales channel
 *
 * **This ordering is a constraint, not an accident of registration.** The
 * channel resolver performs database reads through `emFactory`, and would throw
 * `MissingTenantContextError` if it ran before the tenant hook and `SalesChannel`
 * were tenant-scoped. `SalesChannel` is `@GlobalEntity` today, so either order
 * survives — which is precisely why the kernel must not reorder them on the
 * assumption that it is free. Classify `SalesChannel` any other way and the
 * reversed order breaks every request.
 *
 * Three call sites already run inside a request but *before* tenancy exists and
 * use `withSystemScope` for it: auth resolving the customer organisation, mfa,
 * and `customer-rollup-scope.ts` called from inside the context builder itself.
 * They are the precedent this ordering has to preserve.
 *
 * ## Using it from the HTTP hook
 *
 * The hook must call the next stage **synchronously inside** the store and keep
 * the scope alive for the whole request, so the shape is a promise that settles
 * when the response does:
 *
 * ```ts
 * app.addHook('onRequest', (request, reply, done) => {
 *   buildTenantContext(request).then(
 *     (tenant) => {
 *       void enterPlatformScope(
 *         tenant,
 *         () =>
 *           new Promise<void>((resolve) => {
 *             reply.raw.once('close', resolve);
 *             done();
 *           }),
 *         { requestMeta: requestMetaOf(request) },
 *       );
 *     },
 *     (err: unknown) => done(err as Error),
 *   );
 * });
 * ```
 *
 * `done()` runs inside `storage.run`, so the store propagates across the
 * handler's awaited continuations; `close` fires on success, on error and on
 * client abort, so the scope is disposed in all three cases.
 */

/** A scoped execution: an awilix child container plus the ambient tenant store. */
export interface PlatformScope {
  /** Resolution surface for this execution. */
  readonly cradle: KernelCradle;
  /**
   * The ambient tenant context. Present here for inspection only — it is **not**
   * a container registration, and reading it back from a scope is never a
   * substitute for `getTenantContext()`, which is what the ORM filter uses.
   */
  readonly tenant: TenantContext;
  /** The resolved sales channel; absent outside HTTP. */
  readonly channel: ResolvedChannel | null;
  /** Correlation id and client info; absent outside HTTP. */
  readonly requestMeta: RequestMeta | null;
  dispose(): Promise<void>;
}

export interface EnterPlatformScopeOptions {
  readonly channel?: ResolvedChannel | undefined;
  readonly requestMeta?: RequestMeta | undefined;
  /** Root to branch from. Defaults to the process-wide root container. */
  readonly container?: KernelContainer | undefined;
}

/**
 * Run `run` inside a fresh resolution scope with `tenant` as the ambient tenant
 * context. The scope is disposed when `run` settles — on success, on error and
 * on abort.
 */
export async function enterPlatformScope<T>(
  tenant: TenantContext,
  run: (scope: PlatformScope) => T | Promise<T>,
  opts: EnterPlatformScopeOptions = {},
): Promise<T> {
  const root = opts.container ?? getRootContainer();
  const child = root.createScope<KernelCradle>();

  const channel = opts.channel ?? null;
  const requestMeta = opts.requestMeta ?? null;

  let disposed = false;
  const scope: PlatformScope = {
    cradle: child.cradle,
    tenant,
    channel,
    requestMeta,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await child.dispose();
    },
  };

  // Per-scope values. `salesChannel` is the registration that lets the 49
  // `getResolvedChannel(request)` call sites stop threading `request`.
  //
  // `asFunction(...).scoped()` rather than `asValue(...)` deliberately: awilix
  // marks an `asValue` registration `isLeakSafe`, so a **singleton** could
  // capture the first request's channel and hold it for the life of the
  // process — a Constitution XII violation with no test to catch it. A scoped
  // resolver is not leak-safe, so strict mode refuses that capture at the
  // resolution that makes it.
  child.register({
    salesChannel: asFunction(() => channel).scoped(),
    requestMeta: asFunction(() => requestMeta).scoped(),
    platformScope: asFunction(() => scope).scoped(),
  });

  // The ALS run is the OUTERMOST wrapper of the work — see rule 2 above.
  return runWithTenantContext(tenant, async () => {
    try {
      return await run(scope);
    } finally {
      await scope.dispose();
    }
  });
}
