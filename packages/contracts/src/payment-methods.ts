import { z } from 'zod';
import { uuidSchema } from './common.js';
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
 * Localised name: a required `default` plus optional per-language overrides.
 * A surface in language `xx` uses `name[xx]` when present, else `name.default`.
 */
export const paymentMethodNameSchema = z
  .object({ default: z.string().min(1) })
  .catchall(z.string().min(1));
export type PaymentMethodName = z.infer<typeof paymentMethodNameSchema>;

/** One selectable Order-status option (from the OrderStatusRegistry port). */
export const orderStatusOptionSchema = z.object({
  code: z.string().min(1).max(64),
  label: z.string().min(1),
});
export type OrderStatusOption = z.infer<typeof orderStatusOptionSchema>;

/** Admin upsert body for a payment-method entry. */
export const paymentMethodUpsertSchema = z.object({
  name: paymentMethodNameSchema,
  adapter: z.string().min(1).max(64),
  additionalPrice: z.number().finite().nonnegative().default(0),
  status: z.enum(['active', 'inactive']).default('active'),
  statusOnPending: z.string().min(1).max(64),
  statusOnSuccess: z.string().min(1).max(64),
  statusOnFailure: z.string().min(1).max(64),
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
  salesChannelId: string;
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
  }): Promise<StartPaymentResult>;

  onReceivePayment(ctx: ReceivePaymentContext): Promise<PaymentOutcome>;

  /** Optional renderer keys; absent ⇒ the default fallback renderer is used. */
  readonly renderers?: { storefront?: string; admin?: string; email?: string };
}
