/**
 * Kernel composition contracts (feature 072).
 *
 * **Scope note — a correction to `tasks.md` T003/T004.** Those tasks ask for
 * `ModuleContext`, `Registration`, `RegistrationBuilder` and `PlatformScope` to
 * live here. They cannot: this package declares exactly one dependency (`zod`)
 * and is consumed by the admin app and the storefront, whereas those four types
 * reference `FastifyInstance`, `bullmq`'s `Worker`, MikroORM's `EntityManager`,
 * `TenantContext` and awilix's resolver types. Putting them here would drag the
 * backend's entire framework surface into every browser bundle, and would need
 * new dependencies on a feature whose budget is one (`awilix`).
 *
 * So the split is: **framework-agnostic data shapes and vocabulary here**, the
 * framework-coupled composition types in `backend/src/kernel/`. That is also
 * what `plan.md`'s "Source Code" tree and `contracts/module-context.md`'s own
 * example import (`from '../../kernel/index.js'`) already assume.
 */

/**
 * How long the container keeps an instance of a registration.
 *
 * `transient` is not a fallback — it is what `emFactory` uses, so every
 * resolution hands out a fresh `EntityManager` fork exactly as the pre-kernel
 * composition root did (research R-1b).
 */
export type RegistrationLifetime = 'singleton' | 'scoped' | 'transient';

/**
 * The five classes of entry point that establish a scoped execution. Every one
 * of them goes through `enterPlatformScope`; before this feature only the HTTP
 * path and (most of) the worker path established a tenant context at all.
 */
export type ScopeEntryPointKind = 'http' | 'worker' | 'cli' | 'boot' | 'interval';

/**
 * Per-execution metadata carried by a scope. Field names match the Command
 * Bus's `CommandRequestMeta` deliberately, so the audit row a Command writes can
 * be fed from the scope without a translation step.
 */
export interface RequestMeta {
  /** Correlation id — the inbound `X-Request-Id`, or one generated at the edge. */
  readonly requestId?: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}
