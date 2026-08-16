import { z } from 'zod';
import { uuidSchema } from './common.js';
import { ModulePresenceSchema } from './modules.js';
import { paymentMethodKindSchema, type PaymentMethodKind } from './payments.js';

/**
 * Payment Method adapter framework (feature 034 — Metoda Płatności).
 *
 * Source-of-truth schemas for the admin-managed payment-method entry and the
 * adapter ingress, plus the behavioural `PaymentAdapter` contract a module
 * implements to act as a payment method. The adapter `type` mirrors the
 * existing `PaymentMethod.kind`.
 */

/** Adapter type — kept aligned with the existing `PaymentMethod.kind`. */
export const paymentAdapterTypeSchema = paymentMethodKindSchema;
export type PaymentAdapterType = PaymentMethodKind;

/**
 * Localised name: a non-empty record of `lang → label`. A surface in language
 * `xx` uses `name[xx]` when present; otherwise the `default` key, otherwise the
 * first available value (see the backend name-resolver). Kept as an open record
 * for compatibility with the existing locale-keyed payloads (`en-US`, `pl-PL`).
 */
export const paymentMethodNameSchema = z
  .record(z.string(), z.string().min(1))
  .refine((r) => Object.keys(r).length > 0, { message: 'name requires at least one entry' });
export type PaymentMethodName = z.infer<typeof paymentMethodNameSchema>;

/** One selectable Order-status option (from the OrderStatusRegistry port). */
export const orderStatusOptionSchema = z.object({
  code: z.string().min(1).max(64),
  label: z.string().min(1),
});
export type OrderStatusOption = z.infer<typeof orderStatusOptionSchema>;

/**
 * Admin upsert body for a payment-method entry. `kind` is required (the core
 * discriminator); `adapter` defaults to `kind` and `statusOn*` to the seed
 * order statuses when omitted — keeping the pre-feature-034 payload
 * (`{ code, name, kind }`) valid while letting the richer admin form send the
 * full configuration.
 */
export const paymentMethodUpsertSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  name: paymentMethodNameSchema,
  kind: paymentAdapterTypeSchema,
  adapter: z.string().min(1).max(64).optional(),
  additionalPrice: z.number().finite().nonnegative().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  statusOnPending: z.string().min(1).max(64).optional(),
  statusOnSuccess: z.string().min(1).max(64).optional(),
  statusOnFailure: z.string().min(1).max(64).optional(),
  salesChannelIds: z.array(uuidSchema).optional(),
});
export type PaymentMethodUpsert = z.infer<typeof paymentMethodUpsertSchema>;

/** Admin detail (full config) response. */
export const paymentMethodAdminSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  adapter: z.string(),
  kind: paymentAdapterTypeSchema,
  name: paymentMethodNameSchema,
  status: z.enum(['active', 'inactive']),
  additionalPrice: z.number(),
  statusOnPending: z.string(),
  statusOnSuccess: z.string(),
  statusOnFailure: z.string(),
  salesChannelIds: z.array(uuidSchema),
});
export type PaymentMethodAdmin = z.infer<typeof paymentMethodAdminSchema>;

/**
 * Why a method can — or cannot — be offered to a buyer (issue #96).
 *
 * A payment method is realised by an adapter, and an adapter is contributed by
 * a module. When that module is absent on either axis the method disappears
 * from cart and checkout entirely, because a buyer must never be shown a
 * payment option that cannot take their money. The *admin* keeps seeing the
 * row — off is not uninstall — so it needs the reason, and the reason is the
 * owning module's presence, carried verbatim rather than restated: an admin
 * that renders `/platform/modules` can render this without learning a second
 * vocabulary.
 *
 * `ownerModule` is `null` when no module contributes the method's adapter at
 * all (a legacy row, or a module removed from the deployment); `ownerPresence`
 * is then `null` too, and `available` is false.
 */
export const paymentMethodAvailabilitySchema = z.object({
  ownerModule: z.string().nullable(),
  /** Registered AND its owning module effectively present. */
  available: z.boolean(),
  ownerPresence: ModulePresenceSchema.nullable(),
});
export type PaymentMethodAvailability = z.infer<typeof paymentMethodAvailabilitySchema>;

/** One row of the admin payment-method list: the stored config plus its availability. */
export const paymentMethodAdminListItemSchema = paymentMethodAdminSchema.extend({
  rendererKey: z.string().nullable(),
  availability: paymentMethodAvailabilitySchema,
});
export type PaymentMethodAdminListItem = z.infer<typeof paymentMethodAdminListItemSchema>;

/** Storefront list item — what checkout needs to render an eligible method. */
export const paymentMethodListItemSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  adapter: z.string(),
  kind: paymentAdapterTypeSchema,
  name: paymentMethodNameSchema,
  additionalPrice: z.number(),
  rendererKey: z.string().nullable(),
});
export type PaymentMethodListItem = z.infer<typeof paymentMethodListItemSchema>;

/** `receive_payment` ingress payload (FR-022). */
export const receivePaymentSchema = z
  .object({
    paymentId: uuidSchema.optional(),
    orderId: uuidSchema.optional(),
    externalReference: z.string().max(255).nullish(),
    outcome: z.enum(['success', 'failure']),
    failureReason: z.string().max(2000).nullish(),
    providerDetails: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Boolean(d.paymentId) || Boolean(d.orderId && d.externalReference), {
    message: 'paymentId or (orderId + externalReference) is required',
  });
export type ReceivePayment = z.infer<typeof receivePaymentSchema>;

// ---------------------------------------------------------------------------
// Behavioural adapter contract (TypeScript types — not persisted).
// A module is recognised as a payment-method adapter iff it registers a
// `PaymentAdapter` in the PaymentAdapterRegistry (FR-001).
// ---------------------------------------------------------------------------

export type PaymentSurface = 'storefront' | 'admin' | 'api';

export interface PaymentEligibilityContext {
  paymentMethod: PaymentMethodAdmin;
  /**
   * The channel the buyer is on, or `null` when none is resolved — a checkout
   * reached without a channel, an admin-created order, a direct API submission.
   *
   * Widened from `string` (issue #103): the narrower type left a caller with no
   * way to say "there is no channel", so `''` was passed instead, and an empty
   * string is not a spelling of platform-wide — it is rejected by the settings
   * seam guard, which made every adapter that reads its own configuration
   * answer "not eligible". An adapter must treat `null` as the platform-wide
   * tier (or resolve the system-default channel), never as "match nothing".
   */
  salesChannelId: string | null;
  organizationId: string | null;
  customerAccountId: string | null;
  surface: PaymentSurface;
  /** Present at storefront checkout; opaque to the contract. */
  cartSnapshot?: unknown;
}

export type StartPaymentResult =
  | { kind: 'awaiting_transfer'; iban: string | null; reference: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'none' };

export interface ReceivePaymentContext {
  orderId: string;
  paymentId: string;
  externalReference?: string | null;
  providerDetails?: Record<string, unknown>;
}

export type PaymentOutcome =
  | { result: 'success'; externalReference?: string | null; providerDetails?: Record<string, unknown> }
  | { result: 'failure'; failureReason: string; providerDetails?: Record<string, unknown> };

export interface PaymentAdapter {
  readonly adapterKey: string;
  readonly type: PaymentAdapterType;

  validateUseOnStorefront(ctx: PaymentEligibilityContext): Promise<boolean>;
  validateUseOnAdmin(ctx: PaymentEligibilityContext): Promise<boolean>;
  validateUseInApi(ctx: PaymentEligibilityContext): Promise<boolean>;

  onStorefrontOrderCreated(ctx: {
    orderId: string;
    paymentId: string;
    amount: number;
    currency: string;
    /**
     * Preferred over a DB reload: place-order runs inside a transaction, so a
     * forked EM often cannot see the just-flushed Payment/Order rows yet.
     */
    paymentMethodCode?: string;
    paymentMethodId?: string;
    salesChannelId?: string | null;
    /** Buyer identity for gateway create (TPay requires payer.email + payer.name). */
    payerEmail?: string | null;
    payerName?: string | null;
    billingCountry?: string | null;
    orderBusinessId?: string | null;
  }): Promise<StartPaymentResult>;

  onReceivePayment(ctx: ReceivePaymentContext): Promise<PaymentOutcome>;

  /** Optional renderer keys; absent ⇒ the default fallback renderer is used. */
  readonly renderers?: { storefront?: string; admin?: string; email?: string };
}
