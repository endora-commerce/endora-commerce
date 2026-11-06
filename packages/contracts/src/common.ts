import { z } from 'zod';

/**
 * Shared primitive schemas reused across every module contract.
 * Lives in @endora-commerce/contracts so backend + both frontends share one source of truth.
 */

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .describe('ISO-8601 datetime with offset, e.g. 2026-04-23T10:15:30.000Z');

export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;

export const uuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof uuidSchema>;

/**
 * The one spelling of a `uuid`'s shape as a regular-expression source,
 * unanchored and matching either case without a flag, for a pattern that has
 * to find a uuid *inside* a longer value — an asset address, a `kind:id` token
 * (issue #781). A value that is a uuid on its own is checked with
 * {@link isUuidShape}, not with this.
 */
export const UUID_SHAPE_PATTERN =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * A value with the shape of a PostgreSQL `uuid`: 8-4-4-4-12 hexadecimal digits,
 * either case. Shape only — deliberately looser than `uuidSchema`, which checks
 * RFC 9562's version and variant bits that PostgreSQL does not, and that
 * hand-written seed ids do not always honour.
 *
 * A route keyed by a `uuid` column checks its path parameter against this
 * before the database sees it (issue #753): PostgreSQL answers any other value
 * with `invalid input syntax for type uuid`, a 500. A value of another shape
 * names no record, so the route answers its own not-found, as it does for a
 * well-formed id that names nothing.
 */
export const uuidShapeSchema = z.string().regex(new RegExp(`^${UUID_SHAPE_PATTERN}$`), 'Not a UUID');

/** Whether `value` has the shape of a PostgreSQL `uuid` — see `uuidShapeSchema`. */
export function isUuidShape(value: string): boolean {
  return uuidShapeSchema.safeParse(value).success;
}

/** Whether `YYYY-MM-DD` names a day the calendar has: `2026-02-31` and `2026-13-01` do not. */
export function isCalendarDate(value: string): boolean {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A calendar date as `YYYY-MM-DD`, refusing a day the calendar does not have. */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .refine(isCalendarDate, 'Not a date of the calendar');

/**
 * Monetary amount — decimal string or number in the minor-unit-plus-currency form.
 * We keep amount as a `number` on the wire; backend persists as numeric(14,2).
 * Currency is an ISO 4217 code.
 */
export const moneySchema = z.object({
  amount: z.number().finite(),
  currency: z.string().length(3).describe('ISO 4217 currency code, e.g. PLN, EUR, USD'),
});
export type Money = z.infer<typeof moneySchema>;

/**
 * Multilingual string — keys are BCP-47 language tags. Missing tags fall back to the
 * Sales Channel's default language (FR-105).
 */
export const multilingualStringSchema = z.record(z.string().min(2), z.string());
export type MultilingualString = z.infer<typeof multilingualStringSchema>;

/**
 * Snapshot address embedded in Orders, Invoices, Deliveries — captured at order time so
 * later edits to the source Address row do not rewrite history.
 */
export const addressSnapshotSchema = z.object({
  recipientName: z.string().max(160),
  street: z.string().max(255),
  city: z.string().max(120),
  postalCode: z.string().max(20),
  country: z.string().length(2).describe('ISO-3166-1 alpha-2 country code'),
  /**
   * `null` when the source address carried no phone number. That is what an
   * order answers for it — placement writes the key unconditionally — so a
   * consumer must expect `null` there and not only an absent key.
   */
  phone: z.string().max(32).nullable().optional(),
  /**
   * Optional company name captured on a billing snapshot. Defaults from the
   * Organization at order placement; the buyer may override it at checkout.
   */
  companyName: z.string().max(255).optional(),
  /**
   * Optional tax identifier (Polish NIP by default) captured on a billing
   * snapshot. Defaults from the Organization at placement; overridable at
   * checkout.
   */
  taxId: z.string().max(32).optional(),
});
export type AddressSnapshot = z.infer<typeof addressSnapshotSchema>;

/**
 * Default order lifecycle statuses (feature 038). The lifecycle is now
 * admin-configurable; this enum is the seeded default set and the fallback the
 * `EnumOrderStatusRegistry` validates payment/shipping `statusOn*` references
 * against. Runtime-added statuses are validated against the configurable graph,
 * not this enum.
 */
export const orderStatusSchema = z.enum([
  'new',
  'pending',
  'paid',
  'processing',
  'shipment_ready',
  'shipment_sent',
  'completed',
  'on_hold',
  'cancelled',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** Payment lifecycle statuses (FR-014). `failed` added by feature 034 (payment-method adapter framework). */
export const paymentStatusSchema = z.enum(['awaiting_payment', 'paid', 'failed', 'deferred', 'refunded']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/** Supported Sales Channel visibility modes (R-18 + FR-106). */
export const productVisibilitySchema = z.enum(['public', 'logged_in_only', 'organization_restricted']);
export type ProductVisibility = z.infer<typeof productVisibilitySchema>;

/**
 * Where a document was created from: an opaque reference a creating screen
 * hands to a create request, and the owner of the document hands on, unread,
 * on the event that announces it.
 *
 * `type` names a kind of thing in the vocabulary of whoever sent it (a
 * lower-case identifier, e.g. `crm_opportunity`) and `id` names the one. The
 * module that accepts it validates the shape and nothing else: it does not
 * store it, return it, or branch on it — so it behaves the same whether or not
 * anybody listens. A listener that recognises the `type` decides for itself
 * whether the reference is one it may act on.
 */
export const OriginReferenceSchema = z
  .object({
    type: z
      .string()
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/)
      .describe('A lower-case identifier naming the kind of origin, e.g. crm_opportunity'),
    id: uuidSchema,
  })
  .strict();
export type OriginReference = z.infer<typeof OriginReferenceSchema>;
