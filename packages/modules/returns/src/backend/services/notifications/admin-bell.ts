import {
  ADMIN_PERMISSION_WILDCARD,
  type AdminNotificationRecordPort,
  type AdminUserReadPort,
  type PermissionReadPort,
  type RecordAdminNotificationInput,
} from '@endora-commerce/contracts';

/**
 * The admin bell entry for a new case (`specs/180-off-platform-complaints/` FR-A03,
 * FR-A04, research R-3).
 *
 * **Who.** One `admin_user` entry per active administrator whose effective
 * permissions include `returns:read` — the wildcard role included, as `requireAdmin`
 * judges it — resolved through `admin_users`' and `admin_roles`' published reads, as
 * `quote_requests`' operator side does (179 R-5).
 *
 * **What.** The case's kind, its reference and the day it was filed, linking to the
 * case. **No customer and no organization**: an organization-scoped administrator
 * may hold `returns:read` without being able to open that organization's case, and
 * the bell must not disclose what the case read refuses. The shop e-mail, which goes
 * to addresses the operator chose, carries the detail. Title and body travel as
 * translatable messages in the `returns` scope beside the English sentence.
 *
 * **Presence.** `admin_notifications` is deactivatable and declared
 * `degrades-without`: its presence is asked first, and an absent module is an
 * outcome (`not_present`), never a caught refusal (D-60).
 */

export const RETURNS_READ_PERMISSION = 'returns:read';
export const NEW_CASE_BELL_KIND = 'returns.case_submitted';

export interface BellCase {
  readonly id: string;
  readonly kind: 'return' | 'complaint';
  readonly reference: string;
  readonly submittedAt: Date;
}

export type BellOutcome = { status: 'recorded'; adminUserIds: string[] } | { status: 'not_present' };

/** Which administrators a recorded attempt already told — `bell:<adminUserId>` keys, added to as it goes. */
export interface BellAttempt {
  readonly done: Set<string>;
}

export interface AdminBell {
  announceNewCase(rc: BellCase, attempt: BellAttempt): Promise<BellOutcome>;
}

export interface AdminBellDeps {
  /** `effectiveState.isPresent('admin_notifications')`, asked before anything else. */
  readonly isPresent: () => boolean;
  readonly adminUsers: Pick<AdminUserReadPort, 'listAll'>;
  readonly permissions: Pick<PermissionReadPort, 'listPermissions'>;
  readonly notifications: Pick<AdminNotificationRecordPort, 'record'>;
}

export const bellKey = (adminUserId: string): string => `bell:${adminUserId}`;

/** The active administrators holding `returns:read`, in `listAll`'s order. */
export async function bellRecipients(deps: Pick<AdminBellDeps, 'adminUsers' | 'permissions'>): Promise<string[]> {
  const kept: string[] = [];
  for (const admin of await deps.adminUsers.listAll({ activeOnly: true })) {
    if (admin.status !== 'active' || admin.deletedAt !== null) continue;
    const held = await deps.permissions.listPermissions(admin.id);
    if (held.includes(ADMIN_PERMISSION_WILDCARD) || held.includes(RETURNS_READ_PERMISSION)) kept.push(admin.id);
  }
  return kept;
}

/** The entry for one administrator. */
export function newCaseBellEntry(rc: BellCase, adminUserId: string): RecordAdminNotificationInput {
  const day = rc.submittedAt.toISOString().slice(0, 10);
  return {
    audience: 'admin_user',
    targetAdminUserId: adminUserId,
    kind: NEW_CASE_BELL_KIND,
    subjectType: 'return_case',
    subjectId: rc.id,
    title: rc.kind === 'complaint' ? `New complaint ${rc.reference}` : `New return ${rc.reference}`,
    body: `Filed on ${day}.`,
    linkPath: `/returns/${rc.id}`,
    titleMessage: { scope: 'returns', key: `notifications.newCase.title.${rc.kind}`, params: { reference: rc.reference } },
    bodyMessage: { scope: 'returns', key: 'notifications.newCase.body', params: { date: day } },
  };
}

export function createAdminBell(deps: AdminBellDeps): AdminBell {
  return {
    async announceNewCase(rc, attempt) {
      if (!deps.isPresent()) return { status: 'not_present' };
      const told: string[] = [];
      for (const adminUserId of await bellRecipients(deps)) {
        const key = bellKey(adminUserId);
        if (attempt.done.has(key)) continue;
        await deps.notifications.record(newCaseBellEntry(rc, adminUserId));
        attempt.done.add(key);
        told.push(adminUserId);
      }
      return { status: 'recorded', adminUserIds: told };
    },
  };
}
