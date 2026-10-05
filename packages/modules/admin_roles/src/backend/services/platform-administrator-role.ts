import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { AdminRole } from '../entities/admin-role.entity.js';

/**
 * The platform-administrator role: the one role every instance has.
 *
 * An administrator always holds a role — the permission check and the tenant
 * reach of an admin are both read off it — so a role has to exist before the
 * first administrator does. This is that role: full access, created by
 * installation, ensured again at every boot, and never deletable.
 *
 * The **code** is the one operators already hold rows for and is not renamed.
 * The stored `name` is the English default; the Admin UI shows the role under
 * its translated label (`adminRoles.seeded.platform_admin`), so an operator's
 * own rename is the only thing that changes what is stored.
 */
export const PLATFORM_ADMINISTRATOR_ROLE_CODE = 'platform_admin';
export const PLATFORM_ADMINISTRATOR_ROLE_NAME = 'Platform administrator';

/** The wildcard: every permission code, present and future. */
const FULL_ACCESS: readonly string[] = ['*'];

export type PlatformAdministratorRoleOutcome = 'created' | 'restored' | 'unchanged';

/**
 * Make sure the role exists and grants everything. Idempotent, and safe to run
 * from several processes at once.
 *
 * It takes an `EntityManager` and nothing else because its two callers have
 * nothing else in common: the install hook has no container (`module:install`
 * composes nothing), and the boot hook runs it for the instances that were
 * installed before the hook existed, or whose database was converged by a first
 * boot rather than by an install.
 *
 * An existing row keeps its `name` and its two-factor setting — those are the
 * operator's. Only the permission set is put back, and only when it is not the
 * wildcard: the role the platform guarantees has full access.
 */
export async function ensurePlatformAdministratorRole(
  em: EntityManager,
): Promise<PlatformAdministratorRoleOutcome> {
  // command-coverage-ignore: installation and boot have no acting principal
  // for the Command Bus to attribute the write to. This is the role the first
  // administrator is given, so it is written before anybody could sign in to
  // write it; every later role write goes through the audited admin surface.
  const before = await em.findOne(AdminRole, { code: PLATFORM_ADMINISTRATOR_ROLE_CODE });
  if (before === null) {
    // `insert … on conflict ("code") do nothing`, not a plain insert. Several
    // processes run this at once — an instance starts an API process and a
    // worker, and each ensures the role at boot — and on a database that does
    // not hold it yet they all found nothing a moment ago. One insert wins; the
    // others must be a no-op rather than a unique violation, which would fail
    // the boot hook and stop the process (and, inside the install's
    // transaction, abort it). Whoever lost reads the winner's row below.
    const now = new Date();
    const inserted = await em
      .createQueryBuilder(AdminRole)
      // Every column, spelled out: a query-builder insert is a statement, not
      // an entity, so none of `AdminRole`'s initialisers runs for it.
      .insert({
        id: randomUUID(),
        code: PLATFORM_ADMINISTRATOR_ROLE_CODE,
        name: PLATFORM_ADMINISTRATOR_ROLE_NAME,
        permissions: [...FULL_ACCESS],
        requiresTwoFactor: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflict('code')
      .ignore()
      .execute<{ affectedRows: number }>('run');
    if (inserted.affectedRows > 0) return 'created';
  }
  // `refresh`: the row this EntityManager may already hold is the one read
  // before a concurrent writer finished.
  const existing =
    before ??
    (await em.findOneOrFail(AdminRole, { code: PLATFORM_ADMINISTRATOR_ROLE_CODE }, { refresh: true }));
  const permissions = existing.permissions ?? [];
  if (permissions.length === 1 && permissions[0] === FULL_ACCESS[0]) return 'unchanged';
  existing.permissions = [...FULL_ACCESS];
  await em.flush();
  return 'restored';
}
