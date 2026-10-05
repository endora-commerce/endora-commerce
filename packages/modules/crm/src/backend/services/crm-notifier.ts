import type { AdminNotificationRecordPort } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';

/** `not-present` is the operator's choice — the bell is switched off — never a failure. */
export type CrmNotificationOutcome = 'recorded' | 'not-present';

export type CrmNotificationKind = 'crm.opportunity.assigned' | 'crm.opportunity.message';

export interface CrmNotification {
  kind: CrmNotificationKind;
  /** The administrator the bell entry is for. */
  targetAdminUserId: string;
  opportunityId: string;
  /**
   * A finished English sentence. `adminNotificationRecordPort` takes a title
   * and no key/params pair, as it does for every caller of that port;
   * `specs/093-backend-delivered-prose/` is where that changes for all of them.
   */
  title: string;
  body?: string | null;
}

export interface CrmNotifier {
  notify(notification: CrmNotification): Promise<CrmNotificationOutcome>;
}

/** Where a bell entry about an Opportunity leads: its detail screen in the Admin UI. */
export function opportunityLinkPath(opportunityId: string): string {
  return `/crm/opportunities/${opportunityId}`;
}

/**
 * Bell entries about an Opportunity, through `admin_notifications`' own port.
 *
 * That module is operator-switchable and this module only *degrades* without
 * it (the manifest's `degrades-without` edge): an assignment or a message
 * succeeds either way, and with the bell off nobody is told. So presence is
 * **decided first**, outside any `try` — a closed gate throws rather than
 * answering, and a refusal caught afterwards would be indistinguishable from a
 * defect. Nothing here catches anything.
 *
 * A function rather than an object literal at the composition site, as
 * `catalog`'s recorder is and for its reason: `check:port-catches` follows the
 * port through the value.
 */
export function createCrmNotifier(adminNotifications: AdminNotificationRecordPort): CrmNotifier {
  return {
    async notify(notification: CrmNotification): Promise<CrmNotificationOutcome> {
      if (!effectiveState.isPresent('admin_notifications')) return 'not-present';
      await adminNotifications.record({
        audience: 'admin_user',
        targetAdminUserId: notification.targetAdminUserId,
        kind: notification.kind,
        subjectType: 'crm_opportunity',
        subjectId: notification.opportunityId,
        title: notification.title,
        body: notification.body ?? null,
        linkPath: opportunityLinkPath(notification.opportunityId),
      });
      return 'recorded';
    },
  };
}
