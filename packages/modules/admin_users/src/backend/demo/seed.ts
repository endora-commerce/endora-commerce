/**
 * `admin_users`' demo data (feature 113, T222 — contract §2).
 *
 * The three administrator accounts the quickstart signs in with, in the module
 * that owns the table. It writes `admin_users` and nothing else (§2.1) and
 * reads no other module's table (§2.2).
 *
 * **It resolves one port, `adminRolePort`, and writes `adminRoleId` with the
 * account.** `admin_users` declares `admin_roles` in its manifest, so the port
 * is this module's to read, and what crosses is a role id looked up by code —
 * no entity and no table of that module's. The earlier shape created the
 * account with no role and left the pairing to a composition step that ran
 * after every module's `seed`; an administrator without a role is refused, so
 * a run that stopped in between left accounts nobody could sign in with. The
 * account and its role are one statement now.
 *
 * Idempotent by an existence probe on the natural key (§2.4): a second run
 * creates nothing, re-hashes nothing and reports the same count.
 */
import type {
  AdminRolePort,
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
  /** `admin_roles`' published role surface — the role each account is created holding. */
  readonly adminRolePort: Pick<AdminRolePort, 'findByCode'>;
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
  const { emFactory, adminRolePort } = context.ctx.cradle<AdminUsersDemoCradle>();
  const em = emFactory();

  // Every account is created **already holding its role**, in the statement
  // that creates it. An administrator without a role is refused everywhere, so
  // an account that existed for even one step without one would be a demo
  // nobody can sign in to if the run stopped there. The role is `admin_roles`'
  // row, read through the port that module publishes and this one declares —
  // `admin_roles` seeds first, being a dependency — and a role that is not
  // there fails the run by name rather than leaving an account without one.
  const roleIds = new Map<string, string>();
  const roleIdFor = async (code: string): Promise<string> => {
    const known = roleIds.get(code);
    if (known !== undefined) return known;
    const role = await adminRolePort.findByCode(code);
    if (role === null) {
      throw new Error(
        `the demo administrators need the '${code}' role and it does not exist; ` +
          '`admin_roles` creates it, and its demo data is seeded before this module\'s',
      );
    }
    roleIds.set(code, role.id);
    return role.id;
  };

  // One hash for the three accounts, exactly as the host block did: Argon2 is
  // deliberately slow and the demo's password is one value.
  let passwordHash: string | undefined;
  for (const row of DEMO_ADMIN_USERS) {
    const existing = await em.findOne(AdminUser, { email: row.email });
    if (existing) {
      // Present already: left exactly as it is, password included. An operator
      // may have changed it, and overwriting it here would be this body
      // deciding its own literal outranks their change — `reset`'s question,
      // not `seed`'s. The one thing put right is an account with **no** role,
      // which is what an earlier run that stopped part-way left behind; a role
      // somebody chose is never replaced.
      if (!existing.adminRoleId) existing.adminRoleId = await roleIdFor(row.roleCode);
      continue;
    }
    const adminRoleId = await roleIdFor(row.roleCode);
    passwordHash ??= await hashPassword(DEMO_ADMIN_PASSWORD);
    em.create(AdminUser, {
      email: row.email,
      passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      adminRoleId,
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
