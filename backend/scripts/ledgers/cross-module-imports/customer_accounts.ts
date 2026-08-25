/**
 * Cross-module imports still standing in `customer_accounts` (feature 075,
 * FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * **This module had no shard at all until D-178, and both entries below arrive
 * `permanent: true` rather than as debt.** They are one seam written twice: the
 * account row and the individual's personal Organization, created inside one
 * transaction, held together by `customer_accounts_organization_fk`. Neither
 * counts toward `ledger-size`, on D-77's ground that an edge a foreign key
 * holds co-transactional is not a boundary the sweep is measured against.
 *
 * The interface they reach is `organizations`' own port declaration, kept
 * outside `@endora-commerce/contracts` because its signature carries the
 * caller's MikroORM `EntityManager` and FR-034 keeps a MikroORM type out of that
 * package — the shape `credit_limits`' `CreditLimitPort` and `promotions`'
 * `PromotionUsageFinalizer` already have, for the identical reason. The matching
 * `RESOLUTIONS_OF_UNPUBLISHED_NAMES` entry in `check-port-shape.ts` is the other
 * half of the same statement.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

const SEAM_REASON =
  'PERMANENT (D-78 point 2), and the seam D-178 exists to create. ' +
  '`customer_accounts.organization_id` carries a declared foreign key into ' +
  '`organizations.id` — `customer_accounts_organization_fk`, `on delete restrict`, added by ' +
  '`organizations/migrations/20260424T205317_organizations_init.ts` — and D-178 makes that ' +
  'column `NOT NULL`, so the account row cannot be written before its Organization exists. ' +
  'Both account-creating paths (self-registration and federated sign-in) therefore provision ' +
  'the individual`s personal Organization and insert the account inside **one** ' +
  '`em.transactional`. A second transaction opened by a port on the `organizations` side ' +
  'cannot satisfy a foreign key against a row it cannot see: `emFactory` forks per call, so a ' +
  'port executes on the owner`s own EntityManager. That is exactly the split D-178 closed — ' +
  'the two writes used to be two committed units of work, and a failure between them left a ' +
  'durable account with `organization_id = NULL`, no session for the visitor to retry from, ' +
  'and nothing anywhere that re-ran the provisioning. D-78 rules such a seam kept, on the ' +
  'caller`s EntityManager, and **declared**: `organizations` is already in this module`s ' +
  'manifest `dependencies` (the tenancy direction feature 051 established), this entry names ' +
  'the constraint, and both sides carry a doc comment saying which transaction the write runs ' +
  'in. The reverse direction is not available — `organizations` acknowledges this module`s ' +
  'ports rather than declaring it, because declaring it would close a cycle.';

const SEAM_RETIRED_BY =
  'F4 gives `organizations` a package entry point that exports this interface on a type-only ' +
  '`./ports` subpath — then it is a package dependency and not an import of internals, which ' +
  'is how the identical `credit_limits` and `promotions` entries retired under D-171. Moving ' +
  'the provisioning out of the account`s transaction would retire it too, and would cost ' +
  'precisely what D-178 bought: it reopens the window in which an account commits without a ' +
  'tenant, which `customer_accounts.organization_id NOT NULL` now refuses outright.';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/customer_accounts/services/customer-account-lifecycle-ports.ts:organizations/ports/personal-organization-provision':
    {
      permanent: true,
      reason: SEAM_REASON,
      retiredBy: SEAM_RETIRED_BY,
    },
  'modules/customer_accounts/backend.ts:organizations/ports/personal-organization-provision': {
    permanent: true,
    reason: SEAM_REASON,
    retiredBy: SEAM_RETIRED_BY,
  },
};
