import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * AdminNotificationRead — per-admin read cursor for `audience='all_admins'`
 * broadcast notifications. One row per (notification, admin).
 *
 * For `audience='admin_user'` notifications the read state lives on the
 * notification row itself (`AdminNotification.readAt`).
 */
@GlobalEntity()
@Entity({ tableName: 'admin_notification_reads' })
export class AdminNotificationRead {
  [OptionalProps]?: 'readAt';

  @PrimaryKey({ type: 'uuid' })
  notificationId!: string;

  @PrimaryKey({ type: 'uuid' })
  adminUserId!: string;

  @Property({ type: 'datetime' })
  readAt: Date = new Date();
}
