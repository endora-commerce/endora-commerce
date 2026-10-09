/**
 * `admin_roles`' demo data (feature 113, T222 — contract §2).
 *
 * The two roles the demo shop signs in with, in the module that owns the table.
 * It writes `admin_roles` and nothing else (§2.1), reads no other module's table
 * and resolves no port (§2.2), so declaring it added no entry to this module's
 * manifest `dependencies` (§2.3).
 *
 * **Who holds which role is not this body's.** An `admin_users` row carrying an
 * `admin_roles` id is two modules' rows in one statement — a composition step
 * (§5.1), in `@endora-commerce/demo-composition`, which runs after every
 * module's `seed` and so finds both sides of the assignment already there.
 *
 * Idempotent by an existence probe on the natural key (§2.4): a second run
 * creates nothing and reports the same count. A role that is already there is
 * left as it is, except that a retired code an earlier seed wrote is withdrawn
 * from it (`RETIRED_DEMO_PERMISSION_CODES`).
 */
import type { DemoSeedResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AdminRole } from '../entities/admin-role.entity.js';
import { DEMO_ADMIN_ROLES, RETIRED_DEMO_PERMISSION_CODES } from './rows.js';

/** The one thing a demo body needs off its module's own cradle. */
interface AdminRolesDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function seedDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoSeedResult> {
  // command-coverage-ignore: demo data, reached only by `endora demo seed`,
  // whose entry point calls `mustBeNonProduction()` as its first statement and
  // outside every `try` (contract §2.7, §3.3). The guard is the enforcement:
  // this write has no operator, no tenant and no audit reader, and the command
  // refuses to run against a production database at all.
  const em = context.ctx.cradle<AdminRolesDemoCradle>().emFactory();

  for (const row of DEMO_ADMIN_ROLES) {
    const existing = await em.findOne(AdminRole, { code: row.code });
    // Present already: left exactly as it is. An operator may have narrowed
    // what the demo sales representative may reach, and overwriting it here
    // would be this body deciding its own literal outranks their change —
    // which is `reset`'s question, not `seed`'s.
    //
    // The one exception is a code this body itself wrote and has since
    // retired (issue #180): no operator can have granted it, and while it is
    // there the role cannot be saved from the role editor at all.
    if (existing) {
      if (existing.permissions.some((code) => RETIRED_DEMO_PERMISSION_CODES.includes(code))) {
        existing.permissions = existing.permissions.filter(
          (code) => !RETIRED_DEMO_PERMISSION_CODES.includes(code),
        );
      }
      continue;
    }
    em.create(AdminRole, {
      code: row.code,
      name: row.name,
      permissions: [...row.permissions],
    });
  }
  await em.flush();

  // What the demo *holds* after the run, not what this call inserted: seeding
  // twice must report the same counts (`DemoEntityCount`).
  return { created: [{ entity: 'AdminRole', count: DEMO_ADMIN_ROLES.length }] };
}
