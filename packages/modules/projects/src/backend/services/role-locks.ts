import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The lock a Role delete and a write naming that Role share (issue #453,
 * architect ruling 4 of 2026-11-07).
 *
 * `responsible_role_ids` on `project_stages` and `project_template_stages` is a
 * uuid array with no foreign key, so the schema cannot stop a Stage save from
 * storing a Role a concurrent delete is removing: the delete asks "in use?"
 * of committed rows, the save asked "does it exist?" a moment earlier, and both
 * commit. So the two sides take one advisory lock per Role id:
 *
 * - the **delete** takes it exclusively ({@link lockRoleForDelete}) before it
 *   asks whether the Role is in use;
 * - every Stage, Stage Task, Template and Member write that names Roles takes
 *   each one **shared** ({@link lockRolesForWrite}), in sorted order so two writes can
 *   never wait on each other, and asks again, inside the lock, whether each
 *   still exists — `422` if one does not.
 *
 * Shared locks do not conflict with each other, so Stage saves never serialise
 * against one another; only a delete waits, or is waited for. Both are
 * transaction-scoped (`pg_advisory_xact_lock*`): they are released when the
 * Command's transaction commits or rolls back, so a caller MUST be inside one.
 */
export function roleLockKey(roleId: string): string {
  return `projects.role:${roleId}`;
}

/** The Role delete's side: exclusive, before its "in use" check. */
export async function lockRoleForDelete(em: EntityManager, roleId: string): Promise<void> {
  await em.execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [roleLockKey(roleId)]);
}

/** Each of `roleIds`' locks, shared, in sorted order — the caller then asks that they exist. */
export async function lockRolesShared(em: EntityManager, roleIds: readonly string[]): Promise<void> {
  const ids = [...new Set(roleIds.map((id) => id.toLowerCase()))].sort();
  for (const id of ids) {
    await em.execute('select pg_advisory_xact_lock_shared(hashtextextended(?, 0))', [roleLockKey(id)]);
  }
}

/**
 * A write naming `roleIds`: each one's lock shared, in sorted order, then each
 * one asked again to exist ({@link assertRolesExist}), refused with `refusal`.
 */
export async function lockRolesForWrite(
  em: EntityManager,
  roleIds: readonly string[],
  refusal?: () => HttpError,
): Promise<void> {
  await lockRolesShared(em, roleIds);
  await assertRolesExist(em, roleIds, refusal);
}

/**
 * 422 unless every one of `roleIds` is a Project Role (archived ones included —
 * a Stage may keep one). `refusal` names the error; a responsible Role's by default.
 */
export async function assertRolesExist(
  em: EntityManager,
  roleIds: readonly string[],
  refusal?: () => HttpError,
): Promise<void> {
  const ids = [...new Set(roleIds)];
  if (ids.length === 0) return;
  const rows = (await em.execute(`select r."id" from "project_roles" r where r."id" = any(?::uuid[])`, [
    `{${ids.join(',')}}`,
  ])) as Array<{ id: string }>;
  if (rows.length !== ids.length) {
    if (refusal) throw refusal();
    throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A responsible role is not a project role.');
  }
}
