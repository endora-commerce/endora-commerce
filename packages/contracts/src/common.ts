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
  phone: z.string().max(32).optional(),
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

/** Roles within a Customer Organization (FR-042). */
export const organizationRoleSchema = z.enum(['organization_admin', 'regular_user']);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

/** Supported Sales Channel visibility modes (R-18 + FR-106). */
export const productVisibilitySchema = z.enum(['public', 'logged_in_only', 'organization_restricted']);
export type ProductVisibility = z.infer<typeof productVisibilitySchema>;
