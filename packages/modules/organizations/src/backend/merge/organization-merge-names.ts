import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminUserReadPort, OrganizationMergeRecord, OrganizationMergeView } from '@endora-commerce/contracts';
import { Organization } from '../entities/organization.entity.js';

/**
 * Organization names by id, **archived ones included**: a merge's loser is
 * soft-deleted once it completes, and the merge screens still name it.
 */
export async function organizationNames(em: EntityManager, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await em.fork({ clear: true }).find(Organization, { id: { $in: unique } }, { fields: ['id', 'name'] });
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** Administrator display names by id ("First Last", else the e-mail), deleted ones included. */
export async function adminDisplayNames(
  admins: Pick<AdminUserReadPort, 'findByIds'>,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await admins.findByIds(unique);
  return new Map(
    rows.map((row) => {
      const full = `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim();
      return [row.id, full.length > 0 ? full : row.email];
    }),
  );
}

/**
 * The merge as the Admin UI reads it (`OrganizationMergeView`): the record,
 * with the names of both Organizations and of the administrator who started
 * it beside their ids. A name that cannot be read is `null`, and the screen
 * shows the id.
 */
export async function organizationMergeViews(
  records: readonly OrganizationMergeRecord[],
  resolve: {
    readonly organizationNames: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
    readonly adminNames: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  },
): Promise<OrganizationMergeView[]> {
  if (records.length === 0) return [];
  const organizations = await resolve.organizationNames(records.flatMap((r) => [r.survivorId, r.loserId]));
  const actorIds = records.flatMap((r) => (r.actorAdminUserId === null ? [] : [r.actorAdminUserId]));
  const admins = actorIds.length === 0 ? new Map<string, string>() : await resolve.adminNames(actorIds);
  return records.map((record) => ({
    ...record,
    survivorName: organizations.get(record.survivorId) ?? null,
    loserName: organizations.get(record.loserId) ?? null,
    actorName: record.actorAdminUserId === null ? null : (admins.get(record.actorAdminUserId) ?? null),
  }));
}
