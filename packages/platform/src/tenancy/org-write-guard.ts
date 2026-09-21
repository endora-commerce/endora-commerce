import type { EntityName, EventArgs, EventSubscriber } from '@mikro-orm/core';
import { tenantClassifications } from './org-scoped.decorator.js';
import { isOrgInScope } from './derived-scope.js';
import { OrgWriteOutOfScopeError } from './tenant-context.js';

/**
 * The tenant guard on the **write** side (D-260/A, feature 050 FR-003).
 *
 * `@OrgScoped()` attaches a MikroORM global filter and nothing else, and
 * MikroORM applies a filter to `SELECT` / `UPDATE` / `DELETE` and **not to
 * `INSERT`** (`specs/087-tenant-scope-enforcement/r1-spike.md` §4: *"A
 * tenant-scoped INSERT with no ambient context succeeds… The fail-closed
 * guarantee in `tenant-context.ts`'s header is a **read** guarantee."*). So a
 * classification bought a narrowed read and bought nothing on the write side,
 * and the two halves compose into an escalation wherever a handler diffs a
 * narrowed read against a caller-supplied set: an id the actor cannot see reads
 * as *absent* and is then inserted. Measured on
 * `PUT /api/v1/admin/stripe/methods/:id`, where a `sales_representative`
 * assigned to org A submitted `[orgA, orgB]`, was answered **200**, and created
 * org B's deny row.
 *
 * This subscriber closes that at the flush boundary, for every `scope === 'org'`
 * class at once, out of the registry the classification decorators already
 * write. There is no new declaration for a module to make and no per-route
 * discipline to remember — which is the whole reason it is here and not in five
 * payment-gateway packages that leave this repository in feature 134 wave 2.
 *
 * ## Why the flush boundary and not the Command Bus
 *
 * The bus is not on the path (D-260/A, *Alternatives rejected*): `mfa`'s org
 * policy, `webhooks`' create and `organizations`' sales-rep assignment all write
 * without one, so a command-level assertion would cover exactly the writes that
 * are already the most disciplined. And a refusal here is inside
 * `em.transactional`, so the bus's single transaction rolls back **whole** — no
 * orphan row, no audit row, no event. That is 087 §2.2's *"silent-and-complete
 * became loud-and-partial"* answered the other way round: loud **and** complete.
 *
 * ## Three deliberate limits, each with its reason
 *
 *  1. **`scope === 'org'` only, for v1** (D-260/A, step A3).
 *     `@TransitivelyScoped` children carry no organization column at all, so
 *     asserting one would mean loading the parent aggregate at flush time — a
 *     query inside a unit-of-work event, which is a different decision with a
 *     different cost. `@CustomerScoped` classes that *do* carry
 *     `organizationId` (`Cart` is the only one — `filters.ts:84-87`) are the
 *     second decision, and they need their own evidence: the customer axis is
 *     the primary key there and the organization column arrived later.
 *  2. **A null or absent `organizationId` is not refused.** D-260/A's subject is
 *     *"a write that **carries** a foreign organization"*; a row with no
 *     organization carries none, so there is nothing for this predicate to
 *     compare. Two classified classes are in that state — `ReturnCase` and
 *     `AnalyticsEvent`, both `organizationId?: string | null` — and what a null
 *     tenant key *means* is D-259's open question and the owner's, not this
 *     subscriber's to answer by refusing. It is worth being explicit that this
 *     is the permissive arm: a row written with a null organization is invisible
 *     to every scoped reader (`orgFilterCond`'s `$in` and `=` both exclude
 *     null), so the leak it would permit is a row nobody can read, not a row
 *     another tenant can.
 *  3. **`beforeCreate` and `beforeUpdate` only.** `beforeDelete` is not needed —
 *     a `DELETE` *is* filtered, so `em.remove` reaches only rows the narrowed
 *     read loaded. `beforeUpsert` is unsubscribed because nothing in this
 *     repository calls `em.upsert`, and `em.nativeUpdate` fires no event at all;
 *     both are recorded gaps rather than oversights, and both are reachable only
 *     by code that would have to *set* an organization id by hand.
 *
 * ## What "no ambient context" does
 *
 * `isOrgInScope` delegates to `orgConstraintFor`, which raises
 * `MissingTenantContextError` when no context is established — the same answer a
 * *read* of the same class gets today (`filters.ts`). A write with no scope
 * therefore fails closed for the same reason and with the same error, rather
 * than through a second arm here that would have to decide how much of the
 * fail-closed guarantee to keep.
 */
export class OrgWriteGuardSubscriber implements EventSubscriber<object> {
  /**
   * Which class names are `scope === 'org'`, recomputed when the registry grows.
   *
   * The registry is written by decorators at entity-import time, so its contents
   * depend on which modules a composition loaded. Caching on its **length**
   * keeps the lookup O(1) per write event without freezing an answer taken
   * before the last module's entities were imported — a real risk here, because
   * this subscriber is constructed while the ORM configuration is being built.
   */
  private cache: { readonly rows: number; readonly names: ReadonlySet<string> } | undefined;

  private orgScopedClassNames(): ReadonlySet<string> {
    const rows = tenantClassifications();
    if (!this.cache || this.cache.rows !== rows.length) {
      this.cache = {
        rows: rows.length,
        names: new Set(rows.filter((meta) => meta.scope === 'org').map((meta) => meta.className)),
      };
    }
    return this.cache.names;
  }

  /**
   * The subscribed set, as classes out of the classification registry.
   *
   * MikroORM reads this **once**, when the `EventManager` registers the
   * subscriber (`EventManager.registerSubscriber`), which is after the host has
   * handed `mikroOrmConfigFrom` its entity list and therefore after every
   * classification decorator has run.
   *
   * It is a narrowing for cost only, and never the guard's boundary: an empty
   * array is how MikroORM spells *"every entity"* (`entities.size === 0` in
   * `dispatchEvent`), so a registry this read too early would silently widen the
   * subscription to `@GlobalEntity` classes that happen to carry an
   * `organization_id` column — `Webhook`, `Promotion`, `MfaOrganizationPolicy`,
   * `OrganizationSalesRepAssignment`, every one of them D-260/**B**'s territory
   * and correctly classified. `assertInScope` therefore re-checks the class
   * against the registry on each event, so the wide subscription is at worst
   * wasted work and never a behaviour change.
   */
  getSubscribedEntities(): EntityName<object>[] {
    const names = this.orgScopedClassNames();
    return tenantClassifications()
      .filter((meta) => names.has(meta.className))
      .map((meta) => meta.target as EntityName<object>);
  }

  beforeCreate(args: EventArgs<object>): void {
    this.assertInScope(args);
  }

  beforeUpdate(args: EventArgs<object>): void {
    // `beforeUpdate` is what catches the **cross-organization move**: setting
    // `organizationId = B` on a row legitimately loaded under org A. The read
    // filter cannot see that write at all — the row was visible when it was
    // loaded — and the changed value is on the entity by the time this runs.
    this.assertInScope(args);
  }

  private assertInScope(args: EventArgs<object>): void {
    const entity = args.entity;
    const className = args.meta?.className ?? entity.constructor.name;
    if (!this.orgScopedClassNames().has(className)) return;
    const organizationId = (entity as { organizationId?: unknown }).organizationId;
    if (typeof organizationId !== 'string') return;
    if (isOrgInScope(organizationId)) return;
    throw new OrgWriteOutOfScopeError(className);
  }
}
