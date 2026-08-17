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

/**
 * Whether the method is offered to buyers — feature 076, D-82.
 *
 * Its own body, because it is its own operation. `paymentMethodUpsertSchema`
 * requires `name` and `kind`, so a toggle expressed through the `PUT` would
 * have to resend the whole record, and a stale client that did would clobber a
 * concurrent edit of fields it never meant to touch.
 *
 * `status` stays on the upsert as well: a full edit that happens to include
 * availability is one legitimate operation, and removing it there would force
 * two round trips for one form.
 */
export const paymentMethodStatusPatchSchema = z.object({
  status: z.enum(['active', 'inactive']),
});
export type PaymentMethodStatusPatch = z.infer<typeof paymentMethodStatusPatchSchema>;

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

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The rest of the in-process surface `payment_methods` publishes (feature 075,
// Phase P). `PaymentAdapter` above is the first of them and pre-dates this
// section — it is the precedent every other port contract in the sweep follows.
// ---------------------------------------------------------------------------

/**
 * A payment method as it crosses a module boundary — a plain shape, never the
 * ORM entity (FR-011).
 *
 * `additionalPrice` stays a string: it is `decimal(14,2)` and lands in an
 * order's `paymentMethodSnapshot`, where the figure has to survive verbatim.
 *
 * The three `statusOn…` fields name **order statuses**, which are
 * admin-configurable, so they are `string` rather than a union — see
 * `OrderStatusRegistry` below for what validates them.
 */
export interface PaymentMethodRecord {
  id: string;
  code: string;
  name: Record<string, string>;
  kind: PaymentMethodKind;
  /** The adapter registry key this method settles through. */
  adapter: string;
  status: 'active' | 'inactive';
  additionalPrice: string;
  statusOnPending: string;
  statusOnSuccess: string;
  statusOnFailure: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Container name: `paymentMethodReadPort`. Owner: `payment_methods`.
 *
 * Nineteen of this module's 33 inbound sites are `em.findOne(PaymentMethod, …)`
 * — four gateways resolving the method behind a payment, `orders` resolving it
 * at placement, `quick_order` resolving a buyer's default, and `payments`
 * mapping an outcome onto an order status.
 *
 * `listActive` exists because two of those callers filter on
 * `status: 'active'` and two do not, and which of the two is right depends on
 * whether the read is a catalogue (active only) or a settlement of an order
 * placed earlier (any, or a paid order stops being explicable the day an
 * operator retires a method).
 */
export interface PaymentMethodReadPort {
  findById(id: string): Promise<PaymentMethodRecord | null>;
  findByIds(ids: readonly string[]): Promise<PaymentMethodRecord[]>;
  findByCode(code: string): Promise<PaymentMethodRecord | null>;
  /** Every method, ordered by code — the admin catalogue and the export adapter. */
  listAll(): Promise<PaymentMethodRecord[]>;
  /** Only `status === 'active'`, ordered by code — the buyer-facing catalogue. */
  listActive(): Promise<PaymentMethodRecord[]>;
}

/**
 * Container name: `paymentAdapterRegistryPort`. Owner: `payment_methods`.
 *
 * A **contribution seam**: the four gateway modules push their adapter in from
 * their boot hook and this module's catalogue reads the table. Every edge into
 * it classifies as `contributes`, and publishing the shape must not change
 * that.
 *
 * `register` names its contributor, and `isAvailable` / `get` / `resolve` /
 * `list` filter on that name's effective state, while `entry`, `ownerOf` and
 * `listAll` deliberately do not — an admin screen has to keep showing a method
 * *and* the reason it is unavailable.
 */
export interface PaymentAdapterRegistryPort {
  register(adapter: PaymentAdapter, module: string): void;
  unregister(adapterKey: string): void;
  /** Registered at all, presence-blind. */
  isRegistered(adapterKey: string): boolean;
  /** Registered **and** its owning module effectively present. */
  isAvailable(adapterKey: string): boolean;
  /** The adapter, or `undefined` when unregistered or its owner is absent. */
  get(adapterKey: string): PaymentAdapter | undefined;
  /** Like {@link get}, but throws rather than answering `undefined`. */
  resolve(adapterKey: string): PaymentAdapter;
  /** Adapter keys whose owner is present, in registration order. */
  list(): string[];
  /** Every registered adapter key, presence-blind. */
  listAll(): string[];
  /** Which module contributed the key, or `null` when nobody did. */
  ownerOf(adapterKey: string): string | null;
}

/**
 * Container name: `paymentOrderStatusRegistry`. Owner: `payment_methods`.
 *
 * `statusOnPending` / `statusOnSuccess` / `statusOnFailure` on a payment method
 * reference *order statuses*. This port answers which codes are nameable, and
 * consumers depend only on it — so the eventual admin-configurable registry
 * drops in with no change here.
 *
 * It deliberately does not touch the order: applying a status is done by the
 * caller, which already owns it (Principle I).
 *
 * **The absent-owner policy is honour, and the reason is that there is nothing
 * to skip** (issue #129). The option set is fixed at compile time, so the
 * registry holds no per-contributor state an operator's flip could invalidate.
 * The reads are guards, not surfaces: `payments` asks `has` before moving an
 * order into the status a settled payment names, so a skip would silently
 * leave a paid order in its old status and a throw would make a PSP webhook
 * retry forever. A status a live order is in has to stay nameable while the
 * module holding the table is off.
 */
export interface OrderStatusRegistry {
  /** The selectable order-status options (code + human label). */
  list(): OrderStatusOption[];
  /** True when `code` is a known order status. */
  has(code: string): boolean;
  /** Throws when `code` is not a known order status. */
  assertValid(code: string): void;
}
