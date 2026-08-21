import { z } from 'zod';
import { isoDateTimeSchema, paymentStatusSchema, uuidSchema } from './common.js';
import type { ReceivePayment } from './payment-methods.js';
import type { PaymentRefundInput, PaymentRefundResult } from './returns.js';

/**
 * Payments (FR-072). Drivers: bank_transfer, pickup, credit_limit, gateway.
 * Driver-specific NextAction payloads live in orders.ts (the Place Order
 * response body).
 */

export const paymentMethodKindSchema = z.enum([
  'bank_transfer',
  'pickup',
  'credit_limit',
  'gateway',
]);
export type PaymentMethodKind = z.infer<typeof paymentMethodKindSchema>;

export const paymentMethodSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  kind: paymentMethodKindSchema,
  status: z.enum(['active', 'inactive']),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const paymentSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  paymentMethodId: uuidSchema,
  status: paymentStatusSchema,
  amount: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  paidAt: isoDateTimeSchema.nullable(),
  externalReference: z.string().nullable(),
  // Feature 034 — payment-process detail captured by the adapter on receive_payment.
  providerDetails: z.record(z.string(), z.unknown()).nullable().optional(),
  failureReason: z.string().nullable().optional(),
  attemptNo: z.number().int().positive().default(1),
});
export type Payment = z.infer<typeof paymentSchema>;

/**
 * What a buyer is told to do next after asking to pay an unpaid order again
 * (issue #264). The three kinds are the `StartPaymentResult` a payment adapter
 * returns, carried out to the storefront: send the buyer to the gateway, show
 * them the transfer details again, or tell them there is nothing to do here.
 */
export const paymentRetryNextActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('redirect'), url: z.string().url() }),
  z.object({
    kind: z.literal('awaiting_transfer'),
    iban: z.string().nullable(),
    reference: z.string(),
  }),
]);
export type PaymentRetryNextAction = z.infer<typeof paymentRetryNextActionSchema>;

/**
 * The reply to `POST /api/v1/orders/:orderId/payments/retry` (issue #264).
 *
 * `opened` is the difference between the two things the buyer's click can
 * mean, and the storefront routes on it:
 *
 *  - `true`  — the previous attempt had failed, so attempt `attemptNo` was
 *              opened and its provider session started. `nextAction` is that
 *              session.
 *  - `false` — an attempt was already open (a double-click, a reload, a buyer
 *              coming back to a payment they abandoned). Nothing was opened and
 *              no provider was contacted, so `nextAction` is `none` and the
 *              buyer belongs on the existing payment step for that attempt.
 *
 * That split is what makes the endpoint idempotent at the provider: one click
 * is one provider object, whatever the buyer does to the button. It matters
 * concretely rather than tidily — PayU keys its order on `extOrderId`, which is
 * this platform's payment id, and a second create against a live attempt would
 * be a duplicate `extOrderId` at the POS.
 */
export const paymentRetryResultSchema = z.object({
  paymentId: uuidSchema,
  attemptNo: z.number().int().positive(),
  opened: z.boolean(),
  nextAction: paymentRetryNextActionSchema,
});
export type PaymentRetryResult = z.infer<typeof paymentRetryResultSchema>;

export const deliveryMethodSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  cost: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  status: z.enum(['active', 'inactive']),
});
export type DeliveryMethod = z.infer<typeof deliveryMethodSchema>;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `payments` publishes to the five modules that read it
// (feature 075, Phase P) — the four payment gateways and `orders`. Plain
// TypeScript, not Zod: these describe in-process calls, not an API boundary.
//
// This file imports two shapes from `returns.ts` (`PaymentRefundInput`,
// `PaymentRefundResult`) and one from `payment-methods.ts` (`ReceivePayment`).
// R-03's "no import from another module's contracts file" guards against
// re-creating module coupling inside the package; these three are the case it
// explicitly endorses — `returns` *declares* the refund shape and the gateways
// *implement* it, so the arrow already points this way and duplicating the
// declaration would be the coupling, not the import.
// ---------------------------------------------------------------------------

export type PaymentAttemptStatus =
  | 'awaiting_payment'
  | 'paid'
  | 'failed'
  | 'deferred'
  | 'refunded'
  | 'partially_refunded';

/**
 * A payment attempt as it crosses a module boundary — a plain shape, never the
 * ORM entity (FR-011).
 *
 * `amount` and `refundedAmount` stay strings. They are `decimal(14,2)`, and
 * every consumer of this record is a gateway that forwards the figure to a
 * payment provider; a `number` cannot round-trip it.
 */
export interface PaymentRecord {
  id: string;
  orderId: string;
  paymentMethodId: string;
  status: PaymentAttemptStatus;
  amount: string;
  refundedAmount: string;
  currency: string;
  paidAt: Date | null;
  externalReference: string | null;
  providerDetails: Record<string, unknown> | null;
  failureReason: string | null;
  attemptNo: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Container name: `paymentReadPort`. Owner: `payments`.
 *
 * The four gateways resolve a payment attempt by order, by id or by the
 * provider's own reference — sixteen sites of `em.findOne(Payment, …)` written
 * out four times over, once per gateway, with slightly different ordering
 * rules for "the latest attempt".
 *
 * When `payments` is off every method fails closed. That is the answer a
 * gateway webhook should get: a 503 makes the provider retry, where an
 * invented `null` would make the gateway record a payment nothing accounted
 * for.
 */
export interface PaymentReadPort {
  findById(id: string): Promise<PaymentRecord | null>;
  /** Attempts for an order, newest attempt first. */
  listByOrderId(orderId: string): Promise<PaymentRecord[]>;
  /** The most recent attempt for an order, or `null` when there is none. */
  findLatestForOrder(orderId: string): Promise<PaymentRecord | null>;
  /** Resolve by the provider's own reference (a PaymentIntent id, an order id at the PSP). */
  findByExternalReference(externalReference: string): Promise<PaymentRecord | null>;
  /**
   * How many attempts reference a payment method — the delete-guard
   * `payment_methods` runs before removing one (feature 034 FR-003, feature
   * 075).
   *
   * A count rather than the rows: the guard needs "is this method still spoken
   * for", and the figure goes into the operator's 409 message. Handing back
   * every attempt for a method a busy shop has used for a year would be a read
   * of unbounded size for a yes/no question.
   *
   * It runs on this port's own `EntityManager`, so it does **not** join the
   * caller's transaction. That costs nothing here and is worth saying: the
   * deleting transaction writes no `payments` row, and under `read committed`
   * an in-transaction count took a fresh snapshot per statement anyway — it
   * never held a concurrent attempt off. What guarantees no orphan is the
   * guard plus this module refusing to record an attempt against a method that
   * is gone, not the instant the count was taken.
   */
  countByPaymentMethod(paymentMethodId: string): Promise<number>;
}

/**
 * Container name: `paymentReferencePort`. Owner: `payments`.
 *
 * The one **write** the four gateways make into this module's table, and the
 * only one they make anywhere outside the settlement ingress: when a gateway
 * has created its own object for an attempt — a Stripe PaymentIntent or
 * Checkout Session, a TPay transaction, a PayU order, an Autopay transaction —
 * it records that object's identifier on the attempt, so a later provider
 * event that carries only the provider's own reference resolves back to a
 * payment. It is the write side of `PaymentReadPort.findByExternalReference`.
 *
 * Two methods rather than one, because the four gateways genuinely do two
 * different things and neither is wrong: `stampExternalReference` replaces
 * whatever was there (TPay, PayU — a new provider object supersedes the old
 * one, and keeping the stale reference would strand the settlement event),
 * while `stampExternalReferenceIfAbsent` keeps a reference already on the row
 * (Stripe — a redirect Checkout Session and the PaymentIntent it later spawns
 * are two identifiers for one attempt, and the first is the one its metadata
 * was written against). Publishing the divergence is how it becomes a decision
 * somebody can take; hiding it behind one method would have taken it silently.
 *
 * Each returns whether the row changed.
 *
 * When `payments` is off the write fails closed, and a gateway that has just
 * created a provider object must hear that: swallowing it would leave a live
 * PaymentIntent at the provider with nothing on this side able to resolve the
 * event it will send.
 *
 * `mergeProviderDetails` is the same surface seen through the other column
 * `payments` keeps for a provider: `providerDetails` is what the provider
 * recorded about an attempt, and `PaymentReadPort.findById` is where a gateway
 * reads it back. TPay is the one consumer — a BLIK payment that asked for
 * one-click registration has to carry that request from the pay call to the
 * settlement notification, which is a different process lifetime — and it is a
 * merge rather than a set because the settlement path writes the same column.
 */
export interface PaymentReferencePort {
  stampExternalReference(paymentId: string, externalReference: string): Promise<boolean>;
  /** Stamp only when the attempt carries no reference yet. */
  stampExternalReferenceIfAbsent(paymentId: string, externalReference: string): Promise<boolean>;
  /**
   * Shallow-merge `patch` into the attempt's `providerDetails`. Returns whether
   * a row was found; a `null` value in `patch` is stored as `null`, not
   * treated as a deletion.
   */
  mergeProviderDetails(paymentId: string, patch: Record<string, unknown>): Promise<boolean>;
}

export interface ReceivePaymentResult {
  paymentId: string;
  status: PaymentAttemptStatus;
  orderStatus: string | null;
  idempotent: boolean;
}

/** What a gateway reports when a provider reflects a refund back to us. */
export interface ReflectRefundInput {
  paymentId?: string;
  orderId?: string;
  /** The provider's own reference — resolves the payment when no `paymentId`. */
  externalReference?: string;
  /** Cumulative refunded amount in major units. */
  refundedAmount: number;
  currency: string;
  fullyRefunded: boolean;
  externalRefundId?: string | null;
  providerDetails?: Record<string, unknown>;
}

/**
 * Container name: `receivePaymentPort`. Owner: `payments`.
 *
 * The ingress every gateway funnels a provider event through (feature 034,
 * FR-022/FR-023/FR-025). It resolves the payment, applies the outcome and maps
 * the order status through the method's `statusOnSuccess` / `statusOnFailure`.
 *
 * Idempotent by contract: a success after a terminal `paid` is a no-op, a
 * failure after `paid` is rejected — no downgrade. It resolves a late event
 * even when the adapter has since been de-registered, because it keys on the
 * persisted payment rather than on the live registry.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `payments` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface ReceivePaymentPort {
  receive(input: ReceivePayment): Promise<ReceivePaymentResult>;
  reflectRefund(input: ReflectRefundInput): Promise<{ paymentId: string; changed: boolean } | null>;
}

/**
 * A gateway's refund handler, as the host registry holds it.
 *
 * The four gateway modules contribute one each from their boot hook. The
 * registry's absent-owner policy is `payments`' and stays `payments`': a
 * handler whose module is switched off is **skipped**, and the obligation
 * lands on `pending_manual` rather than being dropped. Refunding through a PSP
 * the operator switched off would charge that PSP's API with that operator's
 * credentials — the opposite of "behaves as if never installed"
 * (Principle XVII).
 */
export interface GatewayRefundHandler {
  /** The payment adapter key this handler serves (e.g. `stripe`). */
  readonly adapterKey: string;
  refund(input: PaymentRefundInput): Promise<PaymentRefundResult>;
}

/**
 * Container name: `gatewayRefundRegistry`. Owner: `payments`.
 *
 * A **contribution seam**, not a call seam: the gateways push into it at boot
 * and the host filters at enumeration, keyed on the module recorded with each
 * entry. The deactivation-consequence classification of every edge into it is
 * `contributes`, and publishing the shape must not change that — a cut that
 * turned these into `fails-closed` would change the sentence the operator's
 * confirmation dialog renders (contracts/port-publication.md §1.4).
 *
 * **The name above is the ungated one, and that is the whole instruction to an
 * implementer** (D-99.7). `gatewayRefundRegistry` is a plain `di.register`: a
 * gateway resolves it and calls `register` from its `ctx.onBoot` hook, exactly
 * as `stripe`, `payu`, `tpay` and `autopay` do. It is ungated **because a gate
 * on a push refuses the contribution rather than deferring it** — a gateway
 * that booted while `payments` was off would stay silently unregistered until
 * the next restart after an operator switched `payments` back on.
 *
 * A gated twin, `gatewayRefundRegistryPort`, used to be published over this
 * same interface and was resolved by nobody. It is gone: an author following it
 * would resolve a gated registration from a boot hook, and a `ModuleDisabledError`
 * raised during composition is re-thrown as `ModuleCompositionError` and ends
 * in `process.exit(1)`. The pull direction is real but intra-module —
 * `payments`' own refund provider asks this registry which handler settles a
 * refund — and it is not published.
 *
 * `register` therefore names its contributor. That argument is the whole
 * mechanism: without it the registry records no owner, states no policy, and a
 * switched-off gateway goes on refunding through its own PSP API — which is
 * what D-44 §7 recorded as the one live instance of that gap.
 *
 * **What an implementer inherits while their own module is off:** the handler
 * is *skipped* at enumeration, not dropped. The refund does not silently fail —
 * `payments` records a `pending_manual` obligation naming the absent module, so
 * a person settles it, which is what a deployment that never installed the
 * gateway already gets (D-71).
 *
 * **Do not "complete" this interface.** `GatewayRefundRegistry` also has
 * `entry`, `ownerOf`, `listAll` and `absentOwnerFor`, and the omission is the
 * point rather than an oversight: `absentOwnerFor` is what turns a refund
 * through an absent gateway into a `pending_manual` obligation instead of a
 * refund that did not happen (D-71), and it is called from exactly one place —
 * `payments/services/payment-refund.ts` — plus this module's own unit test.
 * Verified for issue #192: no caller outside `payments`. Publishing it would
 * offer another module a presence-blind read of the table, which is the one
 * thing the contribution classification rests on not existing.
 */
export interface GatewayRefundRegistryPort {
  register(handler: GatewayRefundHandler, module: string): void;
  /** The handler for an adapter key, or `undefined` when its owner is absent. */
  get(adapterKey: string): GatewayRefundHandler | undefined;
  /**
   * The handler for an adapter key, falling back to the sole registered one
   * when the order names no adapter. Absent owners are skipped here too:
   * honouring one would route exactly the refunds with the least information
   * behind them into a switched-off gateway.
   */
  resolve(adapterKey?: string | null): GatewayRefundHandler | undefined;
  /** Adapter keys whose owner is present, in registration order. */
  list(): string[];
}

/** What the order-confirmation e-mail knows about the payment method. */
export interface PaymentEmailContext {
  /** Resolved display name of the payment method. */
  name: string;
  kind: string;
  /** Flat surcharge applied for this method (order currency). */
  additionalPrice: number;
  currency: string;
}

/**
 * Container name: `paymentEmailRendererPort`. Owner: `payments`.
 *
 * The payment line of the transactional order-confirmation e-mail (feature
 * 034, FR-016/FR-017). An adapter may register a custom renderer under a key;
 * when none is registered the platform default is used, so the payment section
 * always renders.
 *
 * `orders` reaches the resolver today and then calls the function it gets
 * back. The port collapses those two steps, which is what lets the fallback
 * stay on this side: a consumer that resolved a renderer and got `undefined`
 * would have to hold a copy of the default text, and two copies of a default
 * are how a default stops being one.
 *
 * Bodies are plain text (see `EmailMailerSendInput.text`), so a renderer is a
 * `(ctx) => string` builder rather than a component.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `payments` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface PaymentEmailRendererPort {
  render(rendererKey: string | null, ctx: PaymentEmailContext): string;
}
