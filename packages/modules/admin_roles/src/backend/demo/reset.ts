/**
 * Withdraw `admin_roles`' demo data (feature 113, T222 — contract §2.5).
 *
 * By the fixed codes `seed` assigns, never by a predicate over the table. That
 * is not a precaution here, it is a measured one: `blog` and `cms` seed a
 * `blog_manager` and a `content_manager` role from their own boot hooks, and an
 * operator's own role is indistinguishable from a demo one by every other
 * column. This is the withdrawal that replaces `admin_roles`' line in the host's
 * `truncate … cascade`, which took all four with it — and, through the cascade,
 * the `admin_users` rows pointing at them.
 *
 * The demo administrators' **assignment** to these roles is withdrawn first, by
 * the composition: `reset` runs the composition's withdrawal before any module's
 * (§5.5), which is also what leaves no `admin_users` row referencing a role
 * deleted below.
 */
import type { DemoResetResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AdminRole } from '../entities/admin-role.entity.js';
import { DEMO_ADMIN_ROLE_CODES } from './rows.js';

interface AdminRolesDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function resetDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoResetResult> {
  // command-coverage-ignore: the withdrawal half of the demo data above. Same
  // entry point, same `mustBeNonProduction()` guard, same absence of an
  // operator to attribute the write to (contract §2.7).
  const em = context.ctx.cradle<AdminRolesDemoCradle>().emFactory();
  const removed = await em.nativeDelete(AdminRole, {
    code: { $in: [...DEMO_ADMIN_ROLE_CODES] },
  });
  return { removed: [{ entity: 'AdminRole', count: removed }] };
}
