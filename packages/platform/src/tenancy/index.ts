/**
 * Tenant guard core layer (feature 050 — Systemic Organization Tenant Scoping).
 * Peer of `events/`, `http/`, `kernel/`, `commands/`; becomes the `./tenancy`
 * subpath of `@endora-commerce/platform` (feature 080, D-160.1/D-160.7), and
 * that subpath is the boundary a future `@endora-commerce/tenancy` would take
 * (D-160.6). See specs/050-org-tenant-scoping/.
 *
 * **This barrel is a package boundary in waiting, so it carries this
 * directory's symbols and nothing else.** Re-exporting a kernel or commands
 * symbol here to save a consumer one import line spends the split option for a
 * convenience.
 *
 * **What is on it is decided by `contracts/host-package.md` §1.3, not by what
 * happens to be here** (T042f, applying T042c's rule to this directory for the
 * first time). Until T042f the barrel was an accumulation of 38 names over
 * seven files, of which modules took **two** through the barrel itself —
 * `getTenantContext` and `withSystemScope`, in four files — while the same
 * directory was reached 237 times by relative path, for ten distinct names.
 * Every one of those relative reaches becomes a bare specifier when its module
 * moves, so the surface is decided by §1.3's symbol column and not by what
 * happened to be re-exported here.
 *
 * So the rule is the kernel barrel's: a symbol is here when §1.3 records a
 * module taking it from a file it marks **P** (rows 2, 21, 28, 30 and 45 — every
 * file of this directory a module reaches is **P**), or when it is the argument,
 * return or thrown shape of one of those. Everything else is reachable by
 * relative path, which the composition roots and the tests have and a packaged
 * module does not. `test/unit/kernel/published-surface.test.ts` is the two-way
 * ratchet and carries the reason each removed name is not published.
 *
 * Two groups deserve naming here because a future author will look for them:
 *
 *  - **the request pipeline** — `resolveTenantContext`, `systemTenantContext`,
 *    `orgPinnedTenantContext` and the four actor-input shapes, plus
 *    `runWithTenantContext` / `runInTenantContext` / `enterTenantContext` /
 *    `runWithoutTenantContext` and `forkScopedEm`. A context is derived
 *    server-side from the authenticated actor and established by the host; a
 *    module *reads* it (`getTenantContext`) or widens it explicitly
 *    (`withSystemScope`), and §1.3 gives none of those files a row because no
 *    module reaches one. `enterSystemScope` (kernel, row 13) is the
 *    module-facing entry for an execution that starts outside a request.
 *  - **the runtime classification registry** — `tenantClassifications`,
 *    `ClassificationMeta`, `ScopeClass` and the two filter names. The
 *    decorators write into the registry and attach the MikroORM filters; the
 *    host and `check-entity-tenant-classification` read them. A module applies
 *    a decorator and never names what it wrote.
 */
export {
  /** Row 45 — `getTenantContext`'s return shape, and the parameter of every derived-scope helper. */
  type TenantContext,
  /**
   * The fail-closed guarantee: a tenant-scoped query with no ambient context
   * raises it, as does every derived-scope helper. A caller that cannot name it
   * cannot handle the refusal.
   */
  MissingTenantContextError,
  getTenantContext,
} from './tenant-context.js';
/** Row 2 — 219 reaches from 59 modules, the largest single reach in the contract. */
export {
  OrgScoped,
  CustomerScoped,
  GlobalEntity,
  TransitivelyScoped,
  RuleScoped,
} from './org-scoped.decorator.js';
/** Row 21 — the sanctioned cross-organization widening (FR-005/FR-013). */
export { withSystemScope } from './escape-hatch.js';
/** Row 28, plus `orgConstraintFor`'s return shape. */
export {
  orgConstraintFor,
  isOrgInScope,
  ruleVisibleForScope,
  type OrgConstraint,
} from './derived-scope.js';
