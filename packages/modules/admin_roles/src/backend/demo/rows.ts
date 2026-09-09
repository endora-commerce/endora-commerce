/**
 * The admin roles this module's demo data creates (feature 113, T222).
 *
 * One place holding the data, imported by both bodies: `seed.ts` creates these
 * roles and `reset.ts` withdraws exactly them, by the `code` they are keyed on
 * (contract §2.5). A predicate over the table would take `blog_manager` and
 * `content_manager` with it — two roles `blog` and `cms` seed from their own
 * boot hooks, which share this table with the demo and are not the demo's.
 *
 * The values are `dev-catalog-seed.ts`' verbatim, moved rather than rewritten:
 * `backend/src/seeds/demo-relocated-reference.ts` holds the block this replaced
 * and `test/integration/demo/demo-parity.test.ts` compares the two databases
 * row for row while both exist.
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
 * role to exercise it.
 */
export const SALES_REPRESENTATIVE_PERMISSIONS: readonly string[] = [
  'rfqs:handle',
  'organizations:read.assigned',
  'catalog:read',
  // D-173 — the RFQ create screen prefills the agreed unit price from
  // `GET /admin/products/:id/resolved-price`, which is `price_lists`' own
  // endpoint and is gated on `price_lists:read` rather than on
  // `rfqs:handle`. Without this code the prefill answers 403.
  'price_lists:read',
];

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
 * `backend/src/seeds/demo-composition.ts`. This body creates the roles that step
 * assigns.
 */
export const DEMO_ADMIN_ROLES: readonly DemoAdminRoleRow[] = [
  { code: 'platform_admin', name: 'Platform Admin', permissions: ['*'] },
  {
    code: 'sales_representative',
    name: 'Sales representative',
    permissions: SALES_REPRESENTATIVE_PERMISSIONS,
  },
];

/** The codes `reset` withdraws — derived from the rows, never a second list. */
export const DEMO_ADMIN_ROLE_CODES: readonly string[] = DEMO_ADMIN_ROLES.map((row) => row.code);
