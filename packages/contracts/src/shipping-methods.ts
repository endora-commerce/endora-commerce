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

/**
 * Shipment-process status — distinct from the mapped Order status.
 *
 * `pending_manual` is the state a shipment opens in when the carrier was never
 * asked for it: the adapter that would have requested the label, the tracking
 * number or the pickup is contributed by a module that is not present, so the
 * row exists and a human has to finish it. It carries the same meaning as the
 * refund settlement state of the same name (feature 046, FR-035) — deliberately
 * the same word, because it is the same instruction to the same operator.
 *
 * It is **not** `failure`: nothing was rejected, because nothing was sent. It is
 * not plain `pending` either — a `pending` shipment is waiting for a carrier
 * that knows about it, and this one is waiting for a person.
 */
export const shipmentStatusSchema = z.enum([
  'pending',
  'pending_manual',
  'success',
  'failure',
]);
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

/**
 * Container name: `receiveShipmentHandler`. Owner: `shipments`.
 *
 * Carrier callback / tracking-poll ingress: apply a success or failure outcome
 * to a shipment attempt and ask the order lifecycle for the configured move.
 *
 * **Owner off:** fails closed — a caller gets the 503 `MODULE_DISABLED`
 * envelope. Tracking workers must rethrow `ModuleDisabledError` from any
 * per-item `catch` that records transport failures.
 */
export interface ReceiveShipmentPort {
  receive(input: ReceiveShipment): Promise<{
    shipmentId: string;
    status: string;
    orderStatus: string | null;
    idempotent: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Behavioural adapter contract (TypeScript types — not persisted).
// A module is recognised as a shipping-method adapter iff it registers a
// `ShippingAdapter` in the ShippingAdapterRegistry (FR-001).
// ---------------------------------------------------------------------------

export type ShippingSurface = 'storefront' | 'admin' | 'api';

export interface ShippingEligibilityContext {
  deliveryMethod: DeliveryMethodAdmin;
  /**
   * The channel the buyer is on, or `null` when none is resolved. Widened from
   * `string` (issue #103) for the reason spelled out on
   * `PaymentEligibilityContext.salesChannelId`: the empty-string stand-in it
   * forced is rejected by the settings seam guard, so an adapter reading its own
   * configuration answered "not eligible". `null` is the platform-wide tier.
   */
  salesChannelId: string | null;
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
  /**
   * Adapter-specific shipping envelope from place-order (feature 068).
   * Passed from the in-transaction Order entity — adapters must NOT re-fetch
   * the order on a separate EntityManager (uncommitted row is invisible).
   */
  shippingAdapterData?: Record<string, unknown> | null;
  /** Delivery (or billing fallback) phone from the in-transaction order snapshot. */
  deliveryPhone?: string | null;
  /** Placing customer's email when available (locker ShipX requires it). */
  customerEmail?: string | null;
}

/** `shipment_created` — fired after a pending Shipment row is opened. */
export interface ShipmentCreatedContext {
  orderId: string;
  shipmentId: string;
  deliveryMethodId: string;
  attemptNo: number;
}

export type StartShipmentResult =
  | {
      kind: 'pending';
      /** Carrier reference written onto the Shipment in the same create transaction. */
      externalReference?: string | null;
      providerDetails?: Record<string, unknown>;
    }
  | {
      kind: 'generated';
      trackingNumber?: string;
      externalReference?: string | null;
      providerDetails?: Record<string, unknown>;
    }
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

  /**
   * When true, the platform may call `createShipment` after `payment.received.v1`.
   * Optional — absent / false for built-in offline adapters. Carrier modules
   * (InPost, future DHL, …) opt in via their own Settings flag.
   */
  shouldAutoCreateOnPaid?(): Promise<boolean>;

  /** Optional renderer keys; absent ⇒ the default fallback renderer is used. */
  readonly renderers?: { storefront?: string; admin?: string; email?: string };
}

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The rest of the in-process surface `delivery_methods` publishes (feature 075,
// Phase P). `ShippingAdapter` above is the first of them and pre-dates this
// section; the module's contracts file is named for the feature-035 framework
// rather than for the module, which is why nothing new is created here.
// ---------------------------------------------------------------------------

/**
 * A delivery method as it crosses a module boundary — a plain shape, never the
 * ORM entity (FR-011).
 *
 * `cost` stays a decimal string: it lands verbatim in an order's
 * `deliveryMethodSnapshot`, and a `number` cannot round-trip it. The two
 * `statusOn…` fields name **order statuses**, which are admin-configurable, so
 * they are `string` rather than a union.
 */
export interface DeliveryMethodRecord {
  id: string;
  code: string;
  name: Record<string, string>;
  cost: string;
  currency: string;
  status: 'active' | 'inactive';
  /** The adapter registry key this method ships through; `''` for none. */
  adapter: string;
  statusOnSuccess: string;
  statusOnFailure: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Container name: `deliveryMethodReadPort`. Owner: `delivery_methods`.
 *
 * Five inbound sites read the entity: `orders` resolving the method at
 * placement, `shipments` resolving it at dispatch, `quick_order` resolving a
 * buyer's default, and the dev seed.
 *
 * `listActive` is separate from `listAll` for the reason its payment twin
 * gives: a catalogue read wants active methods, a settlement of an order
 * placed earlier wants any, or the order stops being explicable the day an
 * operator retires a method.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `delivery_methods` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface DeliveryMethodReadPort {
  findById(id: string): Promise<DeliveryMethodRecord | null>;
  findByIds(ids: readonly string[]): Promise<DeliveryMethodRecord[]>;
  findByCode(code: string): Promise<DeliveryMethodRecord | null>;
  /** Every method, ordered by code. */
  listAll(): Promise<DeliveryMethodRecord[]>;
  /** Only `status === 'active'`, ordered by code. */
  listActive(): Promise<DeliveryMethodRecord[]>;
}

/**
 * Container name: `shippingAdapterRegistry`. Owner: `delivery_methods`.
 *
 * A **contribution seam**, the delivery-side twin of
 * `PaymentAdapterRegistryPort`: a module that ships parcels registers its
 * adapter from its boot hook, and this module's catalogue reads the table.
 * Every edge into it classifies as `contributes`, and publishing the shape
 * must not change that.
 *
 * `register` names its contributor, and `isAvailable` / `get` / `resolve` /
 * `list` filter on that name's effective state, while `entry`, `ownerOf` and
 * `listAll` deliberately do not — an admin screen has to keep showing a method
 * *and* the reason it is unavailable.
 *
 * **Owner off:** nothing throws here. This is a **contribution seam**, a plain
 * `di.register` rather than a `providePort`, so a push still lands and
 * `delivery_methods` filters by contributor when it enumerates. Converting it to
 * `providePort` would move every edge into it from `contributes` to
 * `fails-closed` in the deactivation-consequence ledger, and change the
 * sentence the operator's confirmation dialog renders.
 */
export interface ShippingAdapterRegistryPort {
  register(adapter: ShippingAdapter, module: string): void;
  unregister(adapterKey: string): void;
  /** Registered at all, presence-blind. */
  isRegistered(adapterKey: string): boolean;
  /** Registered **and** its owning module effectively present. */
  isAvailable(adapterKey: string): boolean;
  /** The adapter, or `undefined` when unregistered or its owner is absent. */
  get(adapterKey: string): ShippingAdapter | undefined;
  /** Like {@link get}, but throws rather than answering `undefined`. */
  resolve(adapterKey: string): ShippingAdapter;
  /** Adapter keys whose owner is present, in registration order. */
  list(): string[];
  /** Every registered adapter key, presence-blind. */
  listAll(): string[];
  /** Which module contributed the key, or `null` when nobody did. */
  ownerOf(adapterKey: string): string | null;
  /**
   * The module that would have handled this shipment but is not present, or
   * `null` when the adapter is available or was never contributed.
   *
   * The one reader that answers the *question* rather than exposing the table,
   * and the reason it exists: `get()` collapses "nobody ever contributed this
   * key" and "its contributor is switched off" into one `undefined`, and those
   * are two different situations for the operator — the second one names a
   * module they can switch back on. The payment twin's `absentOwnerFor`
   * (D-71) is the same reader for the same reason.
   */
  absentOwnerFor(adapterKey: string): string | null;
}
