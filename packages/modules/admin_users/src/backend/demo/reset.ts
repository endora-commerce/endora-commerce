/**
 * Withdraw `admin_users`' demo data (feature 113, T222 — contract §2.5).
 *
 * By the fixed addresses `seed` assigns, never by a predicate over the table:
 * an operator's own administrator is indistinguishable from a demo one by every
 * other column, and this is the table the host's `truncate … cascade` emptied
 * outright — including the account a developer had created for themselves.
 *
 * The accounts are deleted **with their role still on them**. Nothing unassigns
 * it first: an account that outlived a withdrawal that stopped part-way would
 * otherwise be an administrator with no role. This module's withdrawal runs
 * before `admin_roles`' — the reverse of the order they are seeded in — so no
 * row references a role by the time that module removes its own.
 */
import type { DemoResetResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AdminUser } from '../entities/admin-user.entity.js';
import { DEMO_ADMIN_USER_EMAILS } from './rows.js';

interface AdminUsersDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function resetDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoResetResult> {
  // command-coverage-ignore: the withdrawal half of the demo data above. Same
  // entry point, same `mustBeNonProduction()` guard, same absence of an
  // operator to attribute the write to (contract §2.7).
  const em = context.ctx.cradle<AdminUsersDemoCradle>().emFactory();
  const removed = await em.nativeDelete(AdminUser, {
    email: { $in: [...DEMO_ADMIN_USER_EMAILS] },
  });
  return { removed: [{ entity: 'AdminUser', count: removed }] };
}
