/**
 * `admin_notifications` module contracts — the in-process port surface
 * (feature 075, Phase P).
 *
 * One inbound site: `organizations` records a notification when a new
 * organisation registers. That is the whole of the cross-module demand, and it
 * is one method — so the port is one method, not the module's five.
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
 * When `admin_notifications` is off the call fails closed. That is the right
 * answer here even though a notification is not itself a domain write: the one
 * caller records it *after* the organisation has been created and committed,
 * so it already contains its own failure — and a caller that swallowed the
 * refusal would be indistinguishable from one that never called.
 */
export interface AdminNotificationRecordPort {
  record(input: RecordAdminNotificationInput): Promise<AdminNotificationRecord>;
}
