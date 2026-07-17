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
  /** Parent-aggregate accessor + FK for `transitive`. */
  readonly parent?: () => EntityClass;
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

/** Scoped through a parent aggregate's org (e.g. Invoice → Order). No own column. */
export function TransitivelyScoped(parent: () => EntityClass, fk: string): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'transitive', parent, fk });
  };
}

/** Org targeting lives in a rule (e.g. price_lists `applicationRule`), not a column. */
export function RuleScoped(): (target: EntityClass) => void {
  return (target) => {
    registry.push({ target, className: target.name, scope: 'rule' });
  };
}
