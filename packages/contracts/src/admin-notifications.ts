/**
 * `admin_notifications` module contracts — the in-process port surface
 * (feature 075, Phase P).
 *
 * The cross-module demand is one method wherever it comes from: something
 * finished, and the administrator who asked for it should see a bell entry.
 * `organizations` records one when a new organisation registers; `catalog`,
 * `product_feeds` and `pim_ergonode` record one when a bulk operation, a feed
 * generation or an import run ends. So the port is that one method, not the
 * module's five — the other four are its own admin surface (listing, marking
 * read, archiving, counting) and stay unpublished.
 *
 * Plain TypeScript rather than Zod: this describes an in-process call.
 */

export type AdminNotificationAudience = 'admin_user' | 'all_admins';

export interface RecordAdminNotificationInput {
  audience: AdminNotificationAudience;
  /** Required when `audience` is `admin_user`; rejected otherwise. */
  targetAdminUserId?: string | null;
  kind: string;
  subjectType?: string | null;
  subjectId?: string | null;
  title: string;
  body?: string | null;
  linkPath?: string | null;
}

/** What was recorded, for a caller that wants to correlate its own log. */
export interface AdminNotificationRecord {
  id: string;
  audience: AdminNotificationAudience;
  targetAdminUserId: string | null;
  kind: string;
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  body: string | null;
  linkPath: string | null;
  createdAt: Date;
}

/**
 * Container name: `adminNotificationRecordPort`. Owner: `admin_notifications`.
 *
 * When `admin_notifications` is off the call fails closed, and every caller
 * decides absence in front of it rather than catching the refusal behind it
 * (D-60). `organizations` records *after* the organisation has been created
 * and committed, so a swallowed refusal there would be indistinguishable from
 * a call that never happened; the three run-completion callers compose the
 * presence question into their own return type — `'recorded' | 'not-present'`
 * — so an operator reading "not notified" can tell their own choice from a
 * defect.
 */
export interface AdminNotificationRecordPort {
  record(input: RecordAdminNotificationInput): Promise<AdminNotificationRecord>;
}
