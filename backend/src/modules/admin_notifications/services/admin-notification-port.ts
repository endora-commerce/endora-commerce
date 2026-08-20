import type {
  AdminNotificationRecord,
  AdminNotificationRecordPort,
} from '@b2b/contracts';
import type { AdminNotification } from '../entities/admin-notification.entity.js';
import type { AdminNotificationService } from './admin-notification-service.js';

/**
 * The published face of `admin_notifications` (feature 075, Phase P).
 *
 * One cross-module consumer — `organizations` records a notification when a
 * new organisation registers — so the port is that one method, not the
 * module's five. The other four are its own admin surface: listing, marking
 * read, archiving, counting.
 *
 * The adapter exists for the usual reason: `record` answers with the
 * `AdminNotification` entity, and the port answers with the record.
 */
export function createAdminNotificationRecordPort(
  getService: () => AdminNotificationService,
): AdminNotificationRecordPort {
  return {
    async record(input) {
      return toAdminNotificationRecord(await getService().record(input));
    },
  };
}

export function toAdminNotificationRecord(
  notification: AdminNotification,
): AdminNotificationRecord {
  return {
    id: notification.id,
    audience: notification.audience,
    targetAdminUserId: notification.targetAdminUserId ?? null,
    kind: notification.kind,
    subjectType: notification.subjectType ?? null,
    subjectId: notification.subjectId ?? null,
    title: notification.title,
    body: notification.body ?? null,
    linkPath: notification.linkPath ?? null,
    createdAt: notification.createdAt,
  };
}
