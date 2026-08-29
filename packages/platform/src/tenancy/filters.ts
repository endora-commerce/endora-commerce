import {
  getTenantContext,
  MissingTenantContextError,
  noteOrganizationAttributionRefusal,
} from './tenant-context.js';

/**
 * MikroORM global-filter definitions for the tenant guard (feature 050).
 *
 * The `cond` functions read the ambient `TenantContext` DIRECTLY from
 * AsyncLocalStorage at query time (not from `setFilterParams`). This makes the
 * filter fork-independent: it applies correctly on the request-scoped EM, on
 * `em.transactional` sub-forks, and on any other fork — because the store is
 * read when the query runs, inside the caller's async context. A query executed
 * with no ambient context throws `MissingTenantContextError` (fail-closed).
 *
 * The filters are attached (default-on, `args: false`) by the classification
 * decorators in `org-scoped.decorator.ts`.
 */

export const ORG_FILTER = 'org';
export const CUSTOMER_FILTER = 'customerAccount';

/** The tenant key every `@CustomerScoped` entity carries, by definition. */
export const CUSTOMER_TENANT_KEY = 'customerAccountId';

/**
 * The organization column a `@CustomerScoped` entity carries **when it has
 * one**. `Cart` does; the other fifteen do not yet (feature 087, FR-003).
 */
export const CUSTOMER_ORGANIZATION_KEY = 'organizationId';

/**
 * Whether the filtered entity carries {@link CUSTOMER_ORGANIZATION_KEY}.
 *
 * Derived per entity by the decorator from the ORM's own discovered metadata —
 * never written down — so an entity that gains the column starts being filtered
 * on it in the same run, and one that loses it stops. See
 * `org-scoped.decorator.ts`.
 */
export type CustomerOrganizationColumn = 'present' | 'absent';

/** `where` fragment applied to `@OrgScoped` entities on their `organizationId`. */
export function orgFilterCond(): Record<string, unknown> {
  const ctx = getTenantContext();
  if (!ctx) throw new MissingTenantContextError(`filter '${ORG_FILTER}'`);
  switch (ctx.mode) {
    case 'all':
    case 'system':
      return {};
    case 'single-org':
      // The `?? null` is belt-and-braces and **matches nothing** since D-178.
      // A `single-org` context with a null organisation was producible by
      // exactly one thing — a signed-in customer whose `customer_accounts` row
      // had `organization_id IS NULL` — and that column is `NOT NULL` now.
      // Until it was, this line put every such customer into one shared tenant
      // bucket: two of them resolved the same predicate and saw each other's
      // `@OrgScoped` rows. The type keeps the coalesce (`TenantContext`'s field
      // is optional); the platform no longer has a caller for it.
      return { organizationId: ctx.organizationId ?? null };
    case 'allowed-set':
      return { organizationId: { $in: [...(ctx.allowedOrganizationIds ?? [])] } };
  }
}

/**
 * `where` fragment applied to `@CustomerScoped` entities on their
 * `customerAccountId` — and, for the `allowed-set` mode, on their own
 * organization column when they carry one (feature 087, FR-001/FR-002).
 *
 * ## The `allowed-set` arm, and why it used to be empty
 *
 * It returned `{}`. An `allowed-set` context is what a `sales_representative`
 * resolves to, so for that actor every one of the sixteen `@CustomerScoped`
 * classes behaved exactly as if it were `@GlobalEntity`, and the tenant
 * boundary on any admin surface over one was whatever that surface remembered
 * to do for itself. That is a guard whose green means *not looking*: the code
 * runs, returns successfully, and enforces nothing. Two surfaces did the work
 * by hand (`carts`, `customers`); every other one disclosed another
 * organization's rows, reads and writes alike.
 *
 * The arm now answers in one of two ways and never in a third:
 *
 *  - **the entity carries `organizationId`** — the column compare the owner
 *    ruled for (exit (a′), 2026-08-24): `{ organizationId: { $in: allowed } }`,
 *    on a column of the filtered row's own table, no join and no subquery
 *    (FR-002). `Cart` is the one class in this state today.
 *  - **it does not** — the predicate matches **nothing**. That is not a
 *    placeholder, it is FR-011 applied to the state those tables are in: they
 *    carry no organization at all, so no row in them is inside a scoped
 *    actor's authority, and a row is never visible because a predicate was
 *    absent. When feature 087's Group A and Group B land the column, the same
 *    arm starts matching without another edit here.
 *
 * `{ customerAccountId: { $in: [] } }` is the match-nothing spelling because
 * `customerAccountId` is the one column every `@CustomerScoped` entity carries
 * by classification, so FR-002 holds for the refusal exactly as it does for the
 * grant. An empty `allowed-set` therefore matches nothing on `@OrgScoped` and
 * on `@CustomerScoped` alike (FR-007) — the two used to give the same actor
 * opposite answers, and the `@CustomerScoped` one was "everything".
 *
 * **The refusal says so** (feature 087, owner decision of 2026-08-29). An empty
 * list and "nothing exists" are the same three bytes to every layer above this
 * one, so the refusing arm records itself on the ambient context's observation
 * sink (`TenantScopeNotices`) and the host puts a code on the response
 * envelope. That is derived rather than declared: no route sets a flag, no
 * screen is remembered, and the day a table gains its column the same arm
 * starts granting and the notice stops being emitted, in one edit that is this
 * file's `organizationColumn` answer changing.
 *
 * **A surface that has already established the caller's authority may still
 * read across this**, through the one sanctioned crossing (`withSystemScope`,
 * feature 050 FR-005) and never through a bare `catch`. `customers`'
 * `CustomerAddressService` is the worked example: it proves the caller may
 * reach the account through `customer_accounts`' `@OrgScoped` read model first,
 * and the widening covers only the rows of the account it just authorised.
 */
export function customerFilterCond(
  organizationColumn: CustomerOrganizationColumn,
): Record<string, unknown> {
  const ctx = getTenantContext();
  if (!ctx) throw new MissingTenantContextError(`filter '${CUSTOMER_FILTER}'`);
  switch (ctx.mode) {
    case 'all':
    case 'system':
      return {};
    case 'single-org':
      return { [CUSTOMER_TENANT_KEY]: ctx.customerAccountId ?? null };
    case 'allowed-set': {
      const allowed = [...(ctx.allowedOrganizationIds ?? [])];
      if (organizationColumn === 'present') {
        return { [CUSTOMER_ORGANIZATION_KEY]: { $in: allowed } };
      }
      // The predicate is unchanged; the line above it is a *record* that this
      // execution was refused a whole table, which the host discloses on the
      // response envelope (feature 087, owner decision of 2026-08-29). It is
      // written here because this is the only place that knows the difference
      // between "your reach excludes all of these" and "there are none", and
      // both answers look like `[]` from every layer above. Nothing in the
      // guard reads it back: it is an observation, not an input.
      noteOrganizationAttributionRefusal(ctx);
      return { [CUSTOMER_TENANT_KEY]: { $in: [] } };
    }
  }
}
