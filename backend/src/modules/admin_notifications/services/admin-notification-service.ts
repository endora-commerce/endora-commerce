import type { EntityManager } from '@mikro-orm/postgresql';
import { AdminNotification, type AdminNotificationAudience } from '../entities/admin-notification.entity.js';
import { AdminNotificationRead } from '../entities/admin-notification-read.entity.js';

export interface RecordNotificationInput {
  audience: AdminNotificationAudience;
  targetAdminUserId?: string | null;
  kind: string;
  subjectType?: string | null;
  subjectId?: string | null;
  title: string;
  body?: string | null;
  linkPath?: string | null;
}

export interface ListNotificationsInput {
  adminUserId: string;
  unread?: boolean;
  limit?: number;
  /** Opaque cursor (currently the `created_at` ISO + id of the last row of the previous page). */
  cursor?: string | null;
}

export interface ListedNotification {
  id: string;
  audience: AdminNotificationAudience;
  kind: string;
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  body: string | null;
  linkPath: string | null;
  createdAt: Date;
  isRead: boolean;
}

export interface ListNotificationsResult {
  items: ListedNotification[];
  nextCursor: string | null;
  unreadCount: number;
}

/**
 * AdminNotificationService — owns the read + write paths for the admin
 * bell feed.
 *
 * `record()` is invoked by domain modules (e.g. organizations registration
 * notifier) to push entries. `listForAdmin()` is the bell's feed query and
 * carries the per-admin `isRead` resolution for `audience='all_admins'`
 * rows. Read marking is split between updating `read_at` (for
 * `audience='admin_user'`) and inserting into `admin_notification_reads`
 * (for `audience='all_admins'`).
 *
 * Bounded growth: `pruneStale()` archives entries older than
 * `maxUnreadPerAudience` per `audience`. Default cap = 50. The pruner is
 * intended to run on a schedule or on each new write; the first iteration
 * runs it inline on every `record()` call which keeps the table small
 * without a separate job.
 */
export class AdminNotificationService {
  private readonly maxUnreadPerAudience: number;

  constructor(
    private readonly emFactory: () => EntityManager,
    options?: { maxUnreadPerAudience?: number },
  ) {
    this.maxUnreadPerAudience = options?.maxUnreadPerAudience ?? 50;
  }

  async record(input: RecordNotificationInput): Promise<AdminNotification> {
    if (input.audience === 'admin_user' && !input.targetAdminUserId) {
      throw new Error(
        'AdminNotificationService.record: targetAdminUserId is required when audience="admin_user".',
      );
    }
    if (input.audience === 'all_admins' && input.targetAdminUserId) {
      throw new Error(
        'AdminNotificationService.record: targetAdminUserId must be null when audience="all_admins".',
      );
    }
    const em = this.emFactory();
    const entry = em.create(AdminNotification, {
      audience: input.audience,
      targetAdminUserId: input.targetAdminUserId ?? null,
      kind: input.kind,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      title: input.title,
      body: input.body ?? null,
      linkPath: input.linkPath ?? null,
    });
    await em.persistAndFlush(entry);
    await this.pruneStale(input.audience, input.targetAdminUserId ?? null);
    return entry;
  }

  async listForAdmin(input: ListNotificationsInput): Promise<ListNotificationsResult> {
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const em = this.emFactory();

    const cursor = input.cursor ? this.parseCursor(input.cursor) : null;
    const whereParts: string[] = [];
    // knex `raw` uses positional `?` placeholders (converted to $1..$n for pg
    // in textual order). The SELECT's isRead `?` is textually first, so its
    // binding is prepended when the final params array is assembled below.
    const whereParams: (string | number | boolean | null)[] = [];

    // Visible to this admin: their personal rows OR broadcasts.
    whereParts.push(
      `(n."audience" = 'all_admins' or (n."audience" = 'admin_user' and n."target_admin_user_id" = ?))`,
    );
    whereParams.push(input.adminUserId);

    whereParts.push(`n."archived_at" is null`);

    if (input.unread === true) {
      whereParts.push(
        `(
          (n."audience" = 'admin_user' and n."read_at" is null)
          or (n."audience" = 'all_admins'
              and not exists (
                select 1 from "admin_notification_reads" r
                where r."notification_id" = n."id" and r."admin_user_id" = ?
              ))
        )`,
      );
      whereParams.push(input.adminUserId);
    }

    if (cursor) {
      whereParts.push(`(n."created_at", n."id") < (?, ?)`);
      whereParams.push(cursor.createdAt.toISOString());
      whereParams.push(cursor.id);
    }

    const sql = `
      select
        n."id",
        n."audience",
        n."target_admin_user_id" as "targetAdminUserId",
        n."kind",
        n."subject_type" as "subjectType",
        n."subject_id" as "subjectId",
        n."title",
        n."body",
        n."link_path" as "linkPath",
        n."created_at" as "createdAt",
        n."read_at" as "readAt",
        case
          when n."audience" = 'admin_user' then n."read_at" is not null
          else exists (
            select 1 from "admin_notification_reads" r
            where r."notification_id" = n."id" and r."admin_user_id" = ?
          )
        end as "isRead"
      from "admin_notifications" n
      where ${whereParts.join(' and ')}
      order by n."created_at" desc, n."id" desc
      limit ${limit + 1};
    `;

    // The isRead CASE placeholder appears in the SELECT (textually before the
    // WHERE), so its binding (adminUserId) comes first.
    const params = [input.adminUserId, ...whereParams];
    const knex = em.getConnection().getKnex();
    const rows = (await knex.raw(sql, params)).rows as RawNotificationRow[];

    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;

    const items: ListedNotification[] = visibleRows.map((row) => ({
      id: row.id,
      audience: row.audience as AdminNotificationAudience,
      kind: row.kind,
      subjectType: row.subjectType ?? null,
      subjectId: row.subjectId ?? null,
      title: row.title,
      body: row.body ?? null,
      linkPath: row.linkPath ?? null,
      createdAt: new Date(row.createdAt),
      isRead: row.isRead,
    }));

    const nextCursor = hasMore
      ? this.serializeCursor({ createdAt: new Date(visibleRows[visibleRows.length - 1]!.createdAt), id: visibleRows[visibleRows.length - 1]!.id })
      : null;

    const unreadCount = await this.countUnreadForAdmin(input.adminUserId);

    return { items, nextCursor, unreadCount };
  }

  async markRead(notificationId: string, adminUserId: string): Promise<void> {
    const em = this.emFactory();
    const entry = await em.findOne(AdminNotification, { id: notificationId });
    if (!entry) {
      throw new NotificationNotFoundError(notificationId);
    }
    if (!this.isVisibleToAdmin(entry, adminUserId)) {
      throw new NotificationNotFoundError(notificationId);
    }
    if (entry.audience === 'admin_user') {
      if (entry.readAt) return;
      entry.readAt = new Date();
      await em.persistAndFlush(entry);
      return;
    }
    // Broadcast — record the per-admin read cursor (idempotent).
    const existing = await em.findOne(AdminNotificationRead, {
      notificationId,
      adminUserId,
    });
    if (existing) return;
    const cursor = em.create(AdminNotificationRead, {
      notificationId,
      adminUserId,
    });
    await em.persistAndFlush(cursor);
  }

  async markAllRead(adminUserId: string): Promise<number> {
    const em = this.emFactory();
    const knex = em.getConnection().getKnex();
    let count = 0;

    // Personal rows.
    const personalUpdate = (await knex.raw(
      `
      update "admin_notifications"
      set "read_at" = now()
      where "audience" = 'admin_user'
        and "target_admin_user_id" = ?
        and "read_at" is null
        and "archived_at" is null
      returning "id";
    `,
      [adminUserId],
    )) as { rows: Array<{ id: string }> };
    count += personalUpdate.rows.length;

    // Broadcasts — insert per-admin read cursors for every visible unread broadcast.
    const broadcastInsert = (await knex.raw(
      `
      insert into "admin_notification_reads" ("notification_id", "admin_user_id", "read_at")
      select n."id", ?, now()
        from "admin_notifications" n
        where n."audience" = 'all_admins'
          and n."archived_at" is null
          and not exists (
            select 1 from "admin_notification_reads" r
            where r."notification_id" = n."id" and r."admin_user_id" = ?
          )
      on conflict do nothing
      returning "notification_id";
    `,
      [adminUserId, adminUserId],
    )) as { rows: Array<{ notification_id: string }> };
    count += broadcastInsert.rows.length;

    return count;
  }

  async countUnreadForAdmin(adminUserId: string): Promise<number> {
    const em = this.emFactory();
    const knex = em.getConnection().getKnex();
    const sql = `
      select count(*)::int as "count"
        from "admin_notifications" n
       where n."archived_at" is null
         and (
           (n."audience" = 'admin_user'
             and n."target_admin_user_id" = ?
             and n."read_at" is null)
           or (n."audience" = 'all_admins'
             and not exists (
               select 1 from "admin_notification_reads" r
               where r."notification_id" = n."id" and r."admin_user_id" = ?
             ))
         );
    `;
    const result = (await knex.raw(sql, [adminUserId, adminUserId])) as {
      rows: Array<{ count: number }>;
    };
    return result.rows[0]?.count ?? 0;
  }

  /**
   * Soft-archive entries beyond `maxUnreadPerAudience` for the given audience.
   * Keeps the most-recent N alive; older ones get `archived_at = now()`.
   */
  private async pruneStale(
    audience: AdminNotificationAudience,
    targetAdminUserId: string | null,
  ): Promise<void> {
    const em = this.emFactory();
    const knex = em.getConnection().getKnex();
    if (audience === 'all_admins') {
      await knex.raw(
        `
        with ranked as (
          select "id",
                 row_number() over (order by "created_at" desc, "id" desc) as "rn"
            from "admin_notifications"
           where "audience" = 'all_admins'
             and "archived_at" is null
        )
        update "admin_notifications" n
           set "archived_at" = now()
          from ranked
         where n."id" = ranked."id"
           and ranked."rn" > ?;
      `,
        [this.maxUnreadPerAudience],
      );
    } else if (targetAdminUserId) {
      await knex.raw(
        `
        with ranked as (
          select "id",
                 row_number() over (order by "created_at" desc, "id" desc) as "rn"
            from "admin_notifications"
           where "audience" = 'admin_user'
             and "target_admin_user_id" = ?
             and "archived_at" is null
        )
        update "admin_notifications" n
           set "archived_at" = now()
          from ranked
         where n."id" = ranked."id"
           and ranked."rn" > ?;
      `,
        [targetAdminUserId, this.maxUnreadPerAudience],
      );
    }
  }

  private isVisibleToAdmin(entry: AdminNotification, adminUserId: string): boolean {
    if (entry.audience === 'all_admins') return true;
    return entry.targetAdminUserId === adminUserId;
  }

  private serializeCursor(input: { createdAt: Date; id: string }): string {
    return Buffer.from(`${input.createdAt.toISOString()}|${input.id}`).toString('base64url');
  }

  private parseCursor(raw: string): { createdAt: Date; id: string } | null {
    try {
      const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
      const [iso, id] = decoded.split('|');
      if (!iso || !id) return null;
      return { createdAt: new Date(iso), id };
    } catch {
      return null;
    }
  }
}

interface RawNotificationRow {
  id: string;
  audience: string;
  targetAdminUserId: string | null;
  kind: string;
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  body: string | null;
  linkPath: string | null;
  createdAt: string | Date;
  readAt: string | Date | null;
  isRead: boolean;
}

export class NotificationNotFoundError extends Error {
  constructor(public readonly notificationId: string) {
    super(`Admin notification ${notificationId} not found or not visible.`);
    this.name = 'NotificationNotFoundError';
  }
}
