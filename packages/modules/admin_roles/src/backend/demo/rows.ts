/**
 * The admin roles this module's demo data creates (feature 113, T222).
 *
 * One place holding the data, imported by both bodies: `seed.ts` creates these
 * roles and `reset.ts` withdraws exactly them, by the `code` they are keyed on
 * (contract §2.5). A predicate over the table would take `blog_manager` and
 * `content_manager` with it — two roles `blog` and `cms` seed from their own
 * boot hooks, which share this table with the demo and are not the demo's.
 *
 * The values are the host seed's verbatim, moved rather than rewritten. The
 * frozen copy the parity comparison read them against is deleted with that
 * comparison (T226); what holds them now is
 * `test/integration/demo/demo-shop.test.ts`' recorded delta.
 *
 * ## Why the sales representative's permission list is here and is exported
 *
 * It was `backend/src/seeds/seeded-role-permissions.ts`, and it is a constant
 * rather than eight lines inside a seed for a reason that survives the move
 * unchanged: `platform_admin` and the bootstrap admin hold `['*']`, which
 * short-circuits in `PermissionService.hasPermission` before any code is
 * compared, and the two content roles hold their own module's codes. So a change
 * to what a catalogue code grants is felt by exactly this list, and the six
 * `permission-authority` contract tests that assert what the seeded sales
 * representative may reach have to read **the list the seed
 * actually writes** rather than a copy of it — a copy agrees with the seed on
 * the day it is written and never again.
 *
 * Which list that is moved with this batch. The composed path writes this one,
 * so it is re-exported from `../index.js` — the package's own `./backend`
 * subpath — and the six tests name it there. The frozen reference under
 * `backend/src/seeds/` keeps a literal copy of its own on purpose: the two sides
 * of the parity comparison have to be different code, or the comparison cannot
 * see a change to either.
 */

/** One demo admin role, in `AdminRole`'s own field names. */
export interface DemoAdminRoleRow {
  readonly code: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

/**
 * What the seeded `sales_representative` role may reach.
 *
 * Assignment-scoped visibility (feature 008): the quickstart signs in as this
 * role to exercise it. That scoping is a property of the account — which
 * Organizations the representative is assigned to — and not of a permission
 * code, so nothing here names it.
 *
 * Every code must be one the platform knows: the seed writes the list straight
 * onto the entity, while the role editor's save validates each code, so an
 * undeclared one makes the role impossible to save (issue #180).
 * `backend/test/contract/admin_users/permission-inventory.test.ts` holds that.
 */
export const SALES_REPRESENTATIVE_PERMISSIONS: readonly string[] = [
  'rfqs:handle',
  'catalog:read',
  // D-173 — the RFQ create screen prefills the agreed unit price from
  // `GET /admin/products/:id/resolved-price`, which is `price_lists`' own
  // endpoint and is gated on `price_lists:read` rather than on
  // `rfqs:handle`. Without this code the prefill answers 403.
  'price_lists:read',
  // Feature 143 — a Sales Rep is who a Sales Opportunity is assigned to and
  // who colleagues mention in its notes. Without `crm:read` the demo's reps
  // are offered by neither list, and without `crm:write` they cannot move
  // the Opportunities assigned to them.
  'crm:read',
  'crm:write',
];

/**
 * Codes an earlier version of this list seeded and no longer does, which `seed`
 * withdraws from a demo role that still holds them.
 *
 * `organizations:read.assigned` (issue #180) was declared by no manifest and by
 * no catalogue row and checked by no gate, so it granted nothing — and a role
 * holding it could not be saved, because the role service refuses an unknown
 * code and the editor offers no checkbox for one. An operator cannot have put
 * it there for the same reason, so taking it back overrides nobody's choice.
 */
export const RETIRED_DEMO_PERMISSION_CODES: readonly string[] = ['organizations:read.assigned'];

/**
 * The two roles the demo shop has.
 *
 * `['*']` on `platform_admin` is the wildcard `PermissionService` answers before
 * it compares a code, which is what makes the demo administrator able to open
 * every screen a fresh install ships.
 *
 * **Which account holds which role is not here.** An `admin_users` row carrying
 * an `admin_roles` id is two modules' rows in one statement, so the assignment
 * is a composition step (contract §5.1) and lives in
 * `@endora-commerce/demo-composition`. This body creates the roles that step
 * assigns.
 */
export const DEMO_ADMIN_ROLES: readonly DemoAdminRoleRow[] = [
  { code: 'platform_admin', name: 'Platform administrator', permissions: ['*'] },
  {
    code: 'sales_representative',
    name: 'Sales representative',
    permissions: SALES_REPRESENTATIVE_PERMISSIONS,
  },
];

/**
 * The codes `reset` withdraws — derived from the rows, never a second list.
 *
 * **`platform_admin` is not among them.** The demo signs in with that role but
 * does not own it: installation creates it on every instance and the
 * administrator an operator made for themselves holds it, so `seed` finds it
 * already there and withdrawing the demo must leave it where it was.
 */
export const DEMO_ADMIN_ROLE_CODES: readonly string[] = DEMO_ADMIN_ROLES.map(
  (row) => row.code,
).filter((code) => code !== 'platform_admin');
