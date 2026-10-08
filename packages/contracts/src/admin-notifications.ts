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

/**
 * A translatable sentence: where its template is, and what fills it.
 *
 * One entry is read by many administrators, each in a language of their own,
 * and long after it was written — so the writer cannot translate it
 * (`specs/conventions/module-i18n.md`, the case where the reader is plural or
 * reads later). It ships the address of the template instead, and the Admin UI
 * resolves it in the reader's language when it draws the entry.
 *
 * `scope` and `key` are the two arguments of the admin translation lookup: the
 * bundle namespace — a module id, or `core` — and a key inside that bundle.
 * `params` fill the template's `{name}` placeholders and are strings and
 * numbers only: they are drawn as text, never as markup.
 *
 * A message never travels alone. The finished English sentence beside it —
 * `title`, `body` — is what is shown whenever the template cannot be resolved:
 * its module is switched off or not installed, the bundle has no such key, or
 * the consumer predates this field.
 */
export interface AdminNotificationMessage {
  scope: string;
  key: string;
  params?: Record<string, string | number>;
}

export interface RecordAdminNotificationInput {
  audience: AdminNotificationAudience;
  /** Required when `audience` is `admin_user`; rejected otherwise. */
  targetAdminUserId?: string | null;
  kind: string;
  subjectType?: string | null;
  subjectId?: string | null;
  /** The finished English sentence — always, also beside a `titleMessage`. */
  title: string;
  body?: string | null;
  linkPath?: string | null;
  /** `title`, translatable. Optional: a caller that omits it is shown `title` as before. */
  titleMessage?: AdminNotificationMessage | null;
  /** `body`, translatable. Rejected without a `body` to fall back to. */
  bodyMessage?: AdminNotificationMessage | null;
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
  /**
   * Optional in the type so that an implementation written before the field
   * existed — a test double, another package's fake — still satisfies the
   * port. `admin_notifications` itself always answers it, `null` when the
   * entry carries no message.
   */
  titleMessage?: AdminNotificationMessage | null;
  bodyMessage?: AdminNotificationMessage | null;
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
