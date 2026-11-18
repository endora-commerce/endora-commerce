import type { AdminUserReadPort, ReturnCaseAuthorizer } from '@endora-commerce/contracts';

/**
 * Who authorized a case, named at read (`specs/180-off-platform-complaints/` FR-A41 –
 * FR-A43, research R-8).
 *
 * One batched `adminUserReadPort.findByIds` for every case on a page — the wider
 * read, so an administrator removed since is still named where the port keeps the
 * record. An id the port does not know answers `name: null` (*former
 * administrator*, FR-A42); an authorized case with no id answers `adminUserId: null`
 * (*unknown*, FR-A43); a case not authorized answers `null`.
 */
export async function resolveAuthorizers(
  adminUsers: Pick<AdminUserReadPort, 'findByIds'>,
  cases: ReadonlyArray<{ id: string; authorizedAt?: Date | null; authorizedByAdminUserId?: string | null }>,
): Promise<Map<string, ReturnCaseAuthorizer | null>> {
  const ids = [
    ...new Set(
      cases
        .filter((rc) => rc.authorizedAt)
        .map((rc) => rc.authorizedByAdminUserId)
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    for (const admin of await adminUsers.findByIds(ids)) {
      names.set(admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email);
    }
  }
  const out = new Map<string, ReturnCaseAuthorizer | null>();
  for (const rc of cases) {
    if (!rc.authorizedAt) {
      out.set(rc.id, null);
      continue;
    }
    const adminUserId = rc.authorizedByAdminUserId ?? null;
    out.set(rc.id, { adminUserId, name: adminUserId ? (names.get(adminUserId) ?? null) : null });
  }
  return out;
}
