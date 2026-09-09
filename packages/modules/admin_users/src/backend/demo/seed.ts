/**
 * `admin_users`' demo data (feature 113, T222 — contract §2).
 *
 * The three administrator accounts the quickstart signs in with, in the module
 * that owns the table. It writes `admin_users` and nothing else (§2.1), reads no
 * other module's table and resolves no port (§2.2), so declaring it added no
 * entry to this module's manifest `dependencies` (§2.3).
 *
 * **It writes no `adminRoleId`, and that is the boundary the batch was cut on.**
 * The host block these rows come from created each account with an
 * `admin_roles` id in hand, which is two modules' rows in one statement — a
 * composition step (§5.1). The column is nullable, so the account is this
 * module's and the assignment is the instance's; the composition runs after
 * every module's `seed` and finds both sides already there. Contrast the demo
 * *buyer*, whose `customer_accounts.organization_id` is `NOT NULL`: there no
 * split exists and the composition creates the row outright.
 *
 * Idempotent by an existence probe on the natural key (§2.4): a second run
 * creates nothing, re-hashes nothing and reports the same count.
 */
import type {
  DemoCredential,
  DemoSeedResult,
  ModuleDemoContext,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { hashPassword } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AdminUser } from '../entities/admin-user.entity.js';
import { DEMO_ADMIN_PASSWORD, DEMO_ADMIN_USERS } from './rows.js';

/** The one thing a demo body needs off its module's own cradle. */
interface AdminUsersDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function seedDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoSeedResult> {
  // command-coverage-ignore: demo data, reached only by `endora demo seed`,
  // whose entry point calls `mustBeNonProduction()` as its first statement and
  // outside every `try` (contract §2.7, §3.3). The guard is the enforcement:
  // this write has no operator, no tenant and no audit reader, and the command
  // refuses to run against a production database at all — which is also what
  // makes a known password in `rows.ts` defensible.
  const em = context.ctx.cradle<AdminUsersDemoCradle>().emFactory();

  // One hash for the three accounts, exactly as the host block did: Argon2 is
  // deliberately slow and the demo's password is one value.
  let passwordHash: string | undefined;
  for (const row of DEMO_ADMIN_USERS) {
    const existing = await em.findOne(AdminUser, { email: row.email });
    // Present already: left exactly as it is, password included. An operator
    // may have changed it, and overwriting it here would be this body deciding
    // its own literal outranks their change — `reset`'s question, not `seed`'s.
    if (existing) continue;
    passwordHash ??= await hashPassword(DEMO_ADMIN_PASSWORD);
    em.create(AdminUser, {
      email: row.email,
      passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      status: row.status,
    });
  }
  await em.flush();

  const credentials: DemoCredential[] = DEMO_ADMIN_USERS.map((row) => ({
    label: row.credentialLabel,
    value: `${row.email} / ${DEMO_ADMIN_PASSWORD}`,
  }));

  // The count is what the demo *holds* after the run, not what this call
  // inserted: seeding twice must report the same counts (`DemoEntityCount`).
  return {
    created: [{ entity: 'AdminUser', count: DEMO_ADMIN_USERS.length }],
    credentials,
  };
}
