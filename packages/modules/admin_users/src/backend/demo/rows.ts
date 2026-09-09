/**
 * The administrator accounts this module's demo data creates (feature 113,
 * T222).
 *
 * One place holding the data, imported by both bodies: `seed.ts` creates these
 * accounts and `reset.ts` withdraws exactly them, by the `email` they are keyed
 * on (contract §2.5). The values are `dev-catalog-seed.ts`' verbatim, moved
 * rather than rewritten — `backend/src/seeds/demo-relocated-reference.ts` holds
 * the block this replaced, and `test/integration/demo/demo-parity.test.ts`
 * compares the two databases row for row while both exist.
 *
 * ## The role each account holds is deliberately not here
 *
 * An `admin_users` row carrying an `admin_roles` id is two modules' rows in one
 * statement, so the assignment is a composition step (§5.1). `roleCode` below is
 * **not** written by this body: it records which role the demo shop means each
 * account to hold, so that `reset` and this module's own test can say what the
 * composition is expected to have done. `AdminUser.adminRoleId` is nullable —
 * `[OptionalProps]` names it — which is what makes the split available at all,
 * and it is the difference from the demo *buyer*, whose
 * `customer_accounts.organization_id` is `NOT NULL` and who therefore has to be
 * created by the composition outright.
 *
 * ## The password is a real one and is printed
 *
 * It is reported as a {@link DemoCredential} rather than logged, so the runner
 * formats it once (§3.7). `mustBeNonProduction()` at the entry point is what
 * makes shipping a known password defensible: the command refuses to run
 * against a production database at all.
 */

/** One demo administrator, in `AdminUser`'s own field names plus its role. */
export interface DemoAdminUserRow {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly status: 'active' | 'inactive';
  /** The `admin_roles` code the composition assigns — never written here. */
  readonly roleCode: string;
  /** How the report announces this account. */
  readonly credentialLabel: string;
}

/** The one password every demo administrator signs in with. */
export const DEMO_ADMIN_PASSWORD = 'ChangeMe!123';

/** The platform administrator's address, which the demo's report leads with. */
export const DEMO_ADMIN_EMAIL = 'admin@demo.local';

export const DEMO_ADMIN_USERS: readonly DemoAdminUserRow[] = [
  {
    email: DEMO_ADMIN_EMAIL,
    firstName: 'Demo',
    lastName: 'Admin',
    status: 'active',
    roleCode: 'platform_admin',
    credentialLabel: 'Platform Administrator',
  },
  // Feature 008 — two accounts on the sales_representative role, so the
  // quickstart can exercise assignment-scoped visibility: one representative
  // sees their own organisations and the other's are invisible to them.
  {
    email: 'sales-rep@demo.local',
    firstName: 'Anna',
    // A Polish surname, and it stays one. `check:default-language-prose` reads
    // a literal as prose at two word tokens, or at one in the prop-default
    // position, and this is one token in neither — measured, not assumed. It is
    // also not prose in the sense the rule is about: a person's name is not a
    // sentence a reader is meant to understand, and translating it would be
    // renaming somebody.
    lastName: 'Wiśniewska',
    status: 'active',
    roleCode: 'sales_representative',
    credentialLabel: 'Sales Representative',
  },
  {
    email: 'sales-rep-other@demo.local',
    firstName: 'Tomasz',
    lastName: 'Nowak',
    status: 'active',
    roleCode: 'sales_representative',
    credentialLabel: 'Sales Rep (other)',
  },
];

/** The addresses `reset` withdraws — derived from the rows, never a second list. */
export const DEMO_ADMIN_USER_EMAILS: readonly string[] = DEMO_ADMIN_USERS.map((row) => row.email);
