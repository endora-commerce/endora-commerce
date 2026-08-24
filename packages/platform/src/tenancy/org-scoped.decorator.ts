import { Filter } from '@mikro-orm/core';
import { ORG_FILTER, CUSTOMER_FILTER, orgFilterCond, customerFilterCond } from './filters.js';

/**
 * Per-entity tenant-scope classification (feature 050, FR-006).
 *
 * Exactly one decorator MUST be applied to every persisted entity. `@OrgScoped`
 * and `@CustomerScoped` also attach a default-on MikroORM global filter, so the
 * data-layer guard applies automatically. The other three record classification
 * only (enforcement is via `derived-scope.ts` or, for globals, none).
 *
 * The `check-entity-tenant-classification.ts` CI check reads the source to prove
 * the classification is total; the runtime registry here supports introspection
 * and tests.
 */

export type ScopeClass = 'org' | 'customer' | 'global' | 'transitive' | 'rule';

// A class constructor; `unknown[]` args keep the decorator usable on any entity.
type EntityClass = new (...args: never[]) => object;

export interface ClassificationMeta {
  readonly target: EntityClass;
  readonly className: string;
  readonly scope: ScopeClass;
  /** Tenant-key column for `org` / `customer`. */
  readonly key?: string;
  /**
   * Parent-aggregate class name + FK for `transitive` — see
   * {@link TransitivelyScoped} for why the parent is a name and not a class.
   */
  readonly parentClassName?: string;
  readonly fk?: string;
}

const registry: ClassificationMeta[] = [];

/** All classified entities registered at import time. */
export function tenantClassifications(): readonly ClassificationMeta[] {
  return registry;
}

function applyMikroFilter(
  target: EntityClass,
  name: string,
  cond: () => Record<string, unknown>,
): void {
  // MikroORM's `Filter` is a class decorator; apply it programmatically.
  // `args: false` — the cond reads the ambient context from AsyncLocalStorage at
  // query time, so no per-fork `setFilterParams` is needed (fork-independent).
  (Filter({ name, cond: () => cond(), default: true, args: false }) as (t: EntityClass) => void)(target);
}

/** Direct `organizationId` column. Filtered by the `org` global filter. */
export function OrgScoped(): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'org', key: 'organizationId' });
    applyMikroFilter(target, ORG_FILTER, orgFilterCond);
  };
}

/** Direct `customerAccountId` column, no org column. Filtered by the `customerAccount` filter. */
export function CustomerScoped(): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'customer', key: 'customerAccountId' });
    applyMikroFilter(target, CUSTOMER_FILTER, customerFilterCond);
  };
}

/** Platform-global, exempt from all tenant filters. */
export function GlobalEntity(): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'global' });
  };
}

/**
 * Scoped through a parent aggregate's org (e.g. Invoice → Order). No own column.
 *
 * **The parent is named by its class name, not by the class** (feature 080,
 * T049; ruling D-169). Both of this platform's transitive chains cross a module
 * boundary — `Invoice` → `Order` and `KsefSubmission` → `Invoice` — and D-168
 * says a module that has become a package publishes an `entities` array and no
 * named entity class, so the symbol the old `() => Order` thunk closed over is
 * one the child cannot import. Those two lines were the whole reason `invoices`
 * and `ksef` could not be packaged. Nothing else in the tree took the thunk
 * form, so there is one form and not two (Constitution IV).
 *
 * **Why the class name and not the table name.** {@link ClassificationMeta}
 * already keys every row by `className`, so the lookup needs no second index
 * and no per-module token registry; MikroORM refuses two entities sharing a
 * class name at discovery (`MetadataValidator`), so the name is a
 * platform-wide unique key the ORM already enforces rather than an assumption
 * written down here; and no reader of this registry — `filters.ts`,
 * `derived-scope.ts`, `kernel/scope.ts`, `check-entity-tenant-classification`
 * — asks for a table. Resolving a table name would mean re-deriving it through
 * the naming strategy or reading `MetadataStorage`, which is only populated
 * after ORM discovery, i.e. later than the moment this has to answer.
 *
 * The name is resolved lazily by {@link resolveTransitiveParent}: entity
 * classes register in import order and a child is routinely imported before its
 * parent, so resolving here would refuse a chain that is perfectly good.
 */
export function TransitivelyScoped(
  parentClassName: string,
  fk: string,
): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'transitive', parentClassName, fk });
  };
}

/**
 * A `@TransitivelyScoped` chain that does not resolve.
 *
 * It is an error and never a fallback. A transitively scoped entity carries no
 * tenant column of its own, so an unresolved parent leaves it reachable with no
 * tenant predicate at all — Principle XI (non-negotiable) defeated by a silence,
 * which is exactly the failure mode a name-addressed parent would otherwise
 * introduce. Resolution therefore has two outcomes and no third: the one
 * classified entity carrying that name, or this.
 */
export class UnresolvableTenantParentError extends Error {
  constructor(detail: string) {
    super(`Unresolvable @TransitivelyScoped parent — ${detail}`);
    this.name = 'UnresolvableTenantParentError';
  }
}

/**
 * Why `child`'s parent does not resolve, or `null` when it does.
 *
 * Shared by the single resolution and the whole-registry reconciliation so the
 * two cannot come to disagree about what "resolves" means — and so neither has
 * to `catch` the other's throw.
 */
function transitiveParentIssue(child: ClassificationMeta): string | null {
  const where = `${child.className} (fk '${child.fk ?? '?'}')`;
  if (child.scope !== 'transitive' || child.parentClassName === undefined) {
    return `${where} is classified '${child.scope}' and names no transitive parent`;
  }
  const matches = registry.filter((meta) => meta.className === child.parentClassName);
  if (matches.length === 1) return null;
  if (matches.length === 0) {
    return (
      `${where} is scoped through '${child.parentClassName}', and no classified entity of ` +
      'that name is registered in this platform. Either the parent entity is not part of ' +
      'this composition — check the owning module is installed and that this module ' +
      'declares it in its manifest `dependencies` — or the name in the decorator is wrong.'
    );
  }
  return (
    `${where} is scoped through '${child.parentClassName}', and ${matches.length} classified ` +
    'entities carry that class name. A class name is the platform-wide key here, so an ' +
    'ambiguous one is refused rather than resolved to whichever registered first.'
  );
}

/**
 * The classification of `child`'s parent aggregate, resolved by class name.
 *
 * Lazy and order-independent by construction: it reads the registry when it is
 * called, never when the decorator ran. Throws {@link UnresolvableTenantParentError}
 * — see that class for why there is no other outcome.
 */
export function resolveTransitiveParent(child: ClassificationMeta): ClassificationMeta {
  const issue = transitiveParentIssue(child);
  if (issue !== null) throw new UnresolvableTenantParentError(issue);
  return registry.find((meta) => meta.className === child.parentClassName) as ClassificationMeta;
}

/**
 * Reconcile every transitive chain in the registry, and refuse if any is broken.
 *
 * **This is where the refusal lives, and the placement is the decision.** The
 * decorator cannot refuse — a child is routinely decorated before its parent is
 * imported, so an eager check would reject working chains. The *first
 * resolution* cannot be the only refusal either: nothing in this repository
 * resolves a parent on a request path today, so a chain that stopped resolving
 * would sit there unmeasured, which is the silence this exists to remove. So
 * the host reconciles the whole registry once, at the moment it enumerates the
 * entity classes it is about to configure the ORM with
 * (`backend/src/db/configured-entities.ts`) — the first instant at which every
 * classification decorator has run, core and installed package alike, and still
 * before a single query can be issued.
 *
 * It reports **every** broken chain, not the first: an author who renamed an
 * entity wants the whole list in one boot, not one per restart.
 */
export function assertTransitiveParentsResolve(): void {
  const failures = registry
    .filter((meta) => meta.scope === 'transitive')
    .map(transitiveParentIssue)
    .filter((issue): issue is string => issue !== null);
  if (failures.length === 0) return;
  throw new UnresolvableTenantParentError(
    `${failures.length} tenancy chain(s) do not resolve:\n  - ${failures.join('\n  - ')}`,
  );
}

/** Org targeting lives in a rule (e.g. price_lists `applicationRule`), not a column. */
export function RuleScoped(): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'rule' });
  };
}
