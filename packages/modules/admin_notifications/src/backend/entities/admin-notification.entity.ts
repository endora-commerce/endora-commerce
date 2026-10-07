import { randomUUID } from 'node:crypto';
import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * AdminNotification — one row per in-app notification entry.
 *
 * Two audience modes:
 *  - `all_admins`: every admin sees the entry. Per-admin read state is
 *    tracked in the `admin_notification_reads` bridge table.
 *  - `admin_user`: targets exactly one admin (the `target_admin_user_id`
 *    must be non-null). Read state lives on the row itself in `read_at`.
 *
 * `archived_at` is set by the application's `pruneStale()` helper so older
 * unread entries do not pile up forever. The schema does not cap the row
 * count — the pruner does.
 */
@GlobalEntity()
@Entity({ tableName: 'admin_notifications' })
export class AdminNotification {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'targetAdminUserId'
    | 'subjectType'
    | 'subjectId'
    | 'body'
    | 'linkPath'
    | 'titleMessage'
    | 'bodyMessage'
    | 'readAt'
    | 'archivedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 16 })
  audience!: AdminNotificationAudience;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  targetAdminUserId?: string | null;

  @Property({ type: 'string', length: 64 })
  kind!: string;

  @Property({ type: 'string', length: 64, nullable: true })
  subjectType?: string | null;

  @Property({ type: 'uuid', nullable: true })
  subjectId?: string | null;

  @Property({ type: 'string', length: 255 })
  title!: string;

  @Property({ type: 'text', nullable: true })
  body?: string | null;

  @Property({ type: 'string', length: 255, nullable: true })
  linkPath?: string | null;

  /**
   * `title`, translatable: the bundle namespace, the key and the params the
   * Admin UI resolves in the reader's language. `title` stays the sentence
   * shown when it cannot.
   */
  @Property({ type: 'json', nullable: true })
  titleMessage?: StoredNotificationMessage | null;

  /** `body`, translatable — never without a `body` to fall back to. */
  @Property({ type: 'json', nullable: true })
  bodyMessage?: StoredNotificationMessage | null;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  readAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  archivedAt?: Date | null;
}

export type AdminNotificationAudience = 'all_admins' | 'admin_user';

/** A message as it is stored: always with `params`, empty when it takes none. */
export interface StoredNotificationMessage {
  scope: string;
  key: string;
  params: Record<string, string | number>;
}
