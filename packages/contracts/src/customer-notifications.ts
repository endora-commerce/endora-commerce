import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * `customer_notifications` module contracts — the buyer's notification centre on
 * the storefront (`specs/179-rfq-and-customer-notifications/`).
 *
 * Two halves:
 *   (1) the in-process port producers record entries through
 *       (`contracts/delivery-and-ports.md` §1) — plain TypeScript, as in
 *       `admin-notifications.ts`, because it describes an in-process call;
 *   (2) the storefront API shapes (`contracts/customer-notifications-storefront-api.md` §2)
 *       — Zod schemas, the source of truth for the HTTP boundary (Principle II).
 */

// ---------------------------------------------------------------------------
// (1) Port — `customerNotificationRecordPort`
// ---------------------------------------------------------------------------

/**
 * A translatable sentence: the bundle (`scope`, a module id), the key in it and
 * the `{name}` placeholders' values — strings and numbers only, drawn as text.
 * The same shape as `AdminNotificationMessage`, deliberately (research R-13):
 * an entry is translated when it is read, in the reader's language, and the
 * English sentence stored beside it is shown when the key does not resolve.
 */
export interface CustomerNotificationMessage {
  scope: string;
  key: string;
  params?: Record<string, string | number>;
}

export interface RecordCustomerNotificationInput {
  organizationId: string;
  customerAccountId: string;
  /** The channel the entry concerns; `null` = shown on every channel. */
  salesChannelId: string | null;
  /** The producing module's id; the list hides entries whose producer is absent. */
  sourceModule: string;
  /** Unique per `sourceModule`; a second record with the same key is refused (see the port). */
  sourceKey: string;
  /** E.g. `quote_requests.approved`; consumers branch on it, never on the sentence. */
  kind: string;
  subjectType?: string | null;
  subjectId?: string | null;
  /** The finished English sentence — always, also beside `titleMessage`. */
  title: string;
  titleMessage: CustomerNotificationMessage;
  body?: string | null;
  /** `body`, translatable. Rejected without a `body` to fall back to. */
  bodyMessage?: CustomerNotificationMessage | null;
  /** Storefront-relative: starts with one `/`, no scheme, no `//` (FR-047). */
  linkPath?: string | null;
}

/** What was recorded, for a caller that wants to correlate its own log. */
export interface CustomerNotificationRecord {
  id: string;
  createdAt: Date;
}

/**
 * Container name: `customerNotificationRecordPort`. Owner: `customer_notifications`.
 *
 * Owner off: the gate fails closed (`ModuleDisabledError`). Callers decide
 * presence in front of it (`effectiveState.isPresent('customer_notifications')`)
 * and never catch the refusal (D-60).
 *
 * `recordWithin` persists into the caller's unit of work, with no fork and no
 * flush, and commits or rolls back with it — the admin bell's `recordWithin`
 * semantics. It validates before persisting and throws a plain `Error` on
 * invalid input (link, params, body/bodyMessage pairing): a programming error,
 * not a delivery outcome.
 *
 * Idempotency: `(sourceModule, sourceKey)` is unique in the database.
 * `recordWithin` relies on the caller's own idempotency (`quote_requests`
 * closes its delivery record in the same transaction, so a second call for the
 * same record cannot happen); `record` answers the existing entry when the key
 * is already present.
 *
 * `EM` is the caller's MikroORM `EntityManager`, a type parameter because this
 * package holds no `@mikro-orm` import (the `AdminNotificationRecordPort`
 * precedent). A consumer writes `CustomerNotificationRecordPort<EntityManager>`.
 */
export interface CustomerNotificationRecordPort<EM = unknown> {
  record(input: RecordCustomerNotificationInput): Promise<CustomerNotificationRecord>;
  recordWithin(em: EM, input: RecordCustomerNotificationInput): CustomerNotificationRecord;
}

// ---------------------------------------------------------------------------
// (2) Storefront API — `/api/v1/storefront/notifications*`
// ---------------------------------------------------------------------------

/** One entry as the signed-in buyer reads it. */
export const customerNotificationSchema = z
  .object({
    id: uuidSchema,
    kind: z.string(),
    /** Rendered in the request's language; the stored English sentence when the key does not resolve. */
    title: z.string(),
    body: z.string().nullable(),
    subject: z.object({ type: z.string(), id: uuidSchema }).nullable(),
    /** Storefront-relative, without locale prefix; the storefront localises it. */
    linkPath: z.string().nullable(),
    createdAt: isoDateTimeSchema,
    readAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type CustomerNotification = z.infer<typeof customerNotificationSchema>;

/** `GET /api/v1/storefront/notifications` — newest first, keyset-paged. */
export const customerNotificationListResponseSchema = z.object({
  data: z.object({
    items: z.array(customerNotificationSchema),
    /** Opaque keyset cursor over `(created_at desc, id desc)`, base64url; `null` on the last page. */
    nextCursor: z.string().nullable(),
    unreadCount: z.number().int().nonnegative(),
  }),
});
export type CustomerNotificationListResponse = z.infer<typeof customerNotificationListResponseSchema>;

/** `GET /api/v1/storefront/notifications/unread-count`. */
export const customerNotificationUnreadCountResponseSchema = z.object({
  data: z.object({ unreadCount: z.number().int().nonnegative() }),
});
export type CustomerNotificationUnreadCountResponse = z.infer<typeof customerNotificationUnreadCountResponseSchema>;
