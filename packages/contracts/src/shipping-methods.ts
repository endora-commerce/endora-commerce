import { z } from 'zod';
import { uuidSchema } from './common.js';
import type { OrderStatusOption } from './payment-methods.js';

/**
 * Shipping Method adapter framework (feature 035 — Metoda Dostawy).
 *
 * Source-of-truth schemas for the admin-managed delivery-method entry, the
 * Shipment record, and the adapter ingress, plus the behavioural
 * `ShippingAdapter` contract a module implements to act as a shipping method.
 * The delivery-side twin of `payment-methods.ts` (feature 034), minus the
 * `kind`/`type` discriminator and `statusOnPending`: a shipping method is
 * identified by its `adapter` alone, and only success/failure order statuses
 * are mapped. The `price` surcharge is the existing `DeliveryMethod.cost`.
 *
 * The selectable Order statuses are surfaced through the same
 * `OrderStatusOption` shape already exported by `payment-methods.ts`.
 */

export type ShippingOrderStatusOption = OrderStatusOption;

/**
 * Localised name: a non-empty record of `lang → label`. A surface in language
 * `xx` uses `name[xx]` when present; otherwise the `default` key, otherwise the
 * first available value (the backend name-resolver). Open record for
 * compatibility with the existing locale-keyed payloads.
 */
export const deliveryMethodNameSchema = z
  .record(z.string(), z.string().min(1))
  .refine((r) => Object.keys(r).length > 0, { message: 'name requires at least one entry' });
export type DeliveryMethodName = z.infer<typeof deliveryMethodNameSchema>;

/**
 * Admin upsert body for a delivery-method entry. `cost` is the `price`
 * surcharge; `adapter` defaults to `code` and `statusOn*` to the seed order
 * statuses (shipped / in_fulfilment) when omitted — keeping the pre-feature-035
 * payload (`{ code, name, cost, currency }`) valid while letting the richer
 * admin form send the full configuration.
 */
export const deliveryMethodUpsertSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  name: deliveryMethodNameSchema,
  cost: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  adapter: z.string().min(1).max(64).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  statusOnSuccess: z.string().min(1).max(64).optional(),
  statusOnFailure: z.string().min(1).max(64).optional(),
  salesChannelIds: z.array(uuidSchema).optional(),
});
export type DeliveryMethodUpsert = z.infer<typeof deliveryMethodUpsertSchema>;

/** Admin detail (full config) response. */
export const deliveryMethodAdminSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  adapter: z.string(),
  name: deliveryMethodNameSchema,
  cost: z.object({ amount: z.number(), currency: z.string() }),
  status: z.enum(['active', 'inactive']),
  statusOnSuccess: z.string(),
  statusOnFailure: z.string(),
  salesChannelIds: z.array(uuidSchema),
  rendererKey: z.string().nullable(),
});
export type DeliveryMethodAdmin = z.infer<typeof deliveryMethodAdminSchema>;

/** Storefront list item — what checkout needs to render an eligible method. */
export const deliveryMethodListItemSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  adapter: z.string(),
  name: deliveryMethodNameSchema,
  cost: z.object({ amount: z.number(), currency: z.string() }),
  status: z.enum(['active', 'inactive']),
  rendererKey: z.string().nullable(),
});
export type DeliveryMethodListItem = z.infer<typeof deliveryMethodListItemSchema>;

/** Shipment-process status — distinct from the mapped Order status. */
export const shipmentStatusSchema = z.enum(['pending', 'success', 'failure']);
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;

/** Serialized Shipment (admin order view). */
export const shipmentSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  deliveryMethodId: uuidSchema,
  status: shipmentStatusSchema,
  externalReference: z.string().nullable(),
  providerDetails: z.record(z.string(), z.unknown()).nullable(),
  failureReason: z.string().nullable(),
  attemptNo: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ShipmentDto = z.infer<typeof shipmentSchema>;

/** `receive_shipment` ingress payload (FR-022). */
export const receiveShipmentSchema = z
  .object({
    shipmentId: uuidSchema.optional(),
    orderId: uuidSchema.optional(),
    externalReference: z.string().max(255).nullish(),
    outcome: z.enum(['success', 'failure']),
    failureReason: z.string().max(2000).nullish(),
    providerDetails: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Boolean(d.shipmentId) || Boolean(d.orderId && d.externalReference), {
    message: 'shipmentId or (orderId + externalReference) is required',
  });
export type ReceiveShipment = z.infer<typeof receiveShipmentSchema>;

// ---------------------------------------------------------------------------
// Behavioural adapter contract (TypeScript types — not persisted).
// A module is recognised as a shipping-method adapter iff it registers a
// `ShippingAdapter` in the ShippingAdapterRegistry (FR-001).
// ---------------------------------------------------------------------------

export type ShippingSurface = 'storefront' | 'admin' | 'api';

export interface ShippingEligibilityContext {
  deliveryMethod: DeliveryMethodAdmin;
  salesChannelId: string;
  organizationId: string | null;
  customerAccountId: string | null;
  surface: ShippingSurface;
  /** Present at storefront checkout; opaque to the contract. */
  cartSnapshot?: unknown;
}

/** `order_created` — fired in placeOrder after the Order exists. */
export interface OrderCreatedContext {
  orderId: string;
  deliveryMethodId: string;
  salesChannelId: string;
  organizationId: string | null;
}

/** `shipment_created` — fired after a pending Shipment row is opened. */
export interface ShipmentCreatedContext {
  orderId: string;
  shipmentId: string;
  deliveryMethodId: string;
  attemptNo: number;
}

export type StartShipmentResult =
  | { kind: 'pending' }
  | { kind: 'generated'; trackingNumber?: string }
  | { kind: 'none' };

export interface ReceiveShipmentContext {
  orderId: string;
  shipmentId: string;
  externalReference?: string | null;
  providerDetails?: Record<string, unknown>;
}

export type ShipmentOutcome =
  | { result: 'success'; externalReference?: string | null; providerDetails?: Record<string, unknown> }
  | { result: 'failure'; failureReason: string; providerDetails?: Record<string, unknown> };

export interface ShippingAdapter {
  readonly adapterKey: string;

  validateUseOnStorefront(ctx: ShippingEligibilityContext): Promise<boolean>;
  validateUseOnAdmin(ctx: ShippingEligibilityContext): Promise<boolean>;
  validateUseInApi(ctx: ShippingEligibilityContext): Promise<boolean>;

  /** `order_created`; default no-op (MUST NOT open a Shipment). */
  onOrderCreated(ctx: OrderCreatedContext): Promise<void>;
  /** `shipment_created`; begin generation, return the next action. */
  onShipmentCreated(ctx: ShipmentCreatedContext): Promise<StartShipmentResult>;
  /** `receive_shipment`; map the ingress to an outcome. */
  onReceiveShipment(ctx: ReceiveShipmentContext): Promise<ShipmentOutcome>;

  /** Optional renderer keys; absent ⇒ the default fallback renderer is used. */
  readonly renderers?: { storefront?: string; admin?: string; email?: string };
}
