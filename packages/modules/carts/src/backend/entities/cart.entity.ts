import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { CustomerScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Cart — a buyer's in-progress basket. Owned by a Customer (authenticated)
 * or an anonymous session (cookie-token addressable). Scoped to a Sales
 * Channel (feature 027) so the spec's "one active cart per
 * (Customer, Sales Channel)" rule holds.
 *
 * Status lifecycle (feature 027):
 *   active       → abandoned  (sweep: last_activity_at past threshold)
 *   abandoned    → active     (owner activity)
 *   active       → completed  (checkout success OR cart→QR conversion)
 *   active       → rejected   (org-admin reject OR platform-admin reject)
 *   working      → completed  (placement of the order it was created for)
 *
 * `working` (issue #169) is a basket the platform places an order from on the
 * customer's behalf — admin order creation, one-click buy, the external order
 * intake — written from the request's lines beside the customer's active
 * basket, which it never touches. It is never the customer's basket: not
 * unique per channel, not swept, not listed. Placement completes it against
 * the order (`completed_order_id`) or removes it when it refuses.
 *
 * Legacy `converted` was migrated to `completed` by migration 050; the
 * quote-request conversion, which wrote `'converted'`, now writes
 * `'completed'` beside `converted_to_quote_request_id`.
 *
 * `approval_status` is the orthogonal sub-state that gates checkout when
 * the owner's organization role lacks `carts.order_without_approval`
 * (`specs/170-organization-roles/`, OR-3 — it replaced the Organization's
 * `requires_cart_approval` policy and the administrator exemption). Every
 * cart is born `not_required`; placement judges the owner's permission, not
 * this column alone (research R-25). Post-approval mutation re-arms
 * `approved → pending` (see CartApprovalService).
 *
 * `version` is the optimistic-lock token used by the approval / mutation
 * race (buyer-vs-approver) — aligned with the convention shared by
 * features 003 / 026.
 */
@CustomerScoped()
@Entity({ tableName: 'carts' })
export class Cart {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'customerAccountId'
    | 'organizationId'
    | 'anonymousCartToken'
    | 'salesChannelId'
    | 'status'
    | 'approvalStatus'
    | 'submittedForApprovalAt'
    | 'approvedAt'
    | 'approvedByCustomerAccountId'
    | 'rejectedAt'
    | 'rejectedByActor'
    | 'rejectedReason'
    | 'appliedPromotionCode'
    | 'completedOrderId'
    | 'convertedToQuoteRequestId'
    | 'sourceQuoteRequestId'
    | 'abandonmentNotifiedAt'
    | 'lastActivityAt'
    | 'version';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerAccountId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  @Property({ type: 'string', length: 64, nullable: true })
  @Unique()
  anonymousCartToken?: string | null;

  /**
   * Sales channel the cart is scoped to. Backfilled to the system-default
   * channel by migration 050; NULL is read as "system default" until the
   * next consolidation tightens it (see research.md §R3).
   */
  @Property({ type: 'uuid', nullable: true })
  salesChannelId?: string | null;

  @Property({ type: 'string', length: 16 })
  status: CartStatus = 'active';

  @Property({ type: 'string', length: 32 })
  approvalStatus: CartApprovalStatus = 'not_required';

  @Property({ type: 'datetime', nullable: true })
  submittedForApprovalAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  approvedAt?: Date | null;

  @Property({ type: 'uuid', nullable: true })
  approvedByCustomerAccountId?: string | null;

  @Property({ type: 'datetime', nullable: true })
  rejectedAt?: Date | null;

  /** Free-form `customer:<uuid>` / `admin:<uuid>` / `org_admin:<uuid>`. */
  @Property({ type: 'string', length: 48, nullable: true })
  rejectedByActor?: string | null;

  @Property({ type: 'text', nullable: true })
  rejectedReason?: string | null;

  /**
   * The Promotion.code the buyer most recently applied to this cart. The
   * resolver in PromotionService.applyToCart consumes this on every read.
   * Persisted even on terminal carts for audit / analytics.
   */
  @Property({ type: 'string', length: 64, nullable: true })
  appliedPromotionCode?: string | null;

  /**
   * The order this cart produced, set by `placeOrder` beside
   * `status = 'completed'` and inside the placement transaction (D-94.1).
   *
   * The twin of {@link convertedToQuoteRequestId}: the two terminal artefacts
   * a cart can leave behind, and until D-94 only one of them was recorded —
   * asked which order emptied a completed cart, the platform answered by
   * correlating timestamps. `carts_completed_order_fk` holds it
   * (`on delete set null`), for the reason the QR pointer's migration wrote
   * down for its own: deleting the order does not invalidate the fact that
   * the cart was once completed.
   *
   * Nullable, and it stays nullable. It cannot be backfilled — no surviving
   * record says which order emptied which historical cart — and
   * `status = 'completed'` does not imply it. Two paths reach `completed`
   * without an order, and each leaves its own record of why: the
   * quote-request conversion sets {@link convertedToQuoteRequestId}, and the
   * source basket of an anonymous-into-customer merge is left with neither a
   * customer nor an {@link anonymousCartToken}. Every basket an order is placed
   * from — the customer's own or a `working` one — is completed against the
   * order. No other path reaches `completed`: the published write port has no
   * operation that empties a basket and closes it without an order (issue #601).
   */
  @Property({ type: 'uuid', nullable: true })
  completedOrderId?: string | null;

  /** Set on Cart → Quote Request conversion (feature 027 US3). */
  @Property({ type: 'uuid', nullable: true })
  convertedToQuoteRequestId?: string | null;

  /**
   * The accepted Quote Request this basket was seeded from — the other
   * direction from {@link convertedToQuoteRequestId}. Written by
   * `CartWritePort.replaceItemsForCustomer` and by nothing a buyer can reach,
   * replaced by every later seed, and cleared when the last line is removed:
   * a basket emptied and refilled by hand is not the quote's any more.
   *
   * No foreign key. It is a claim `orders` re-reads through
   * `quoteRequestReadPort` before it stamps `orders.source_quote_request_id`,
   * so a request that has gone leaves an id that resolves to nothing, which is
   * the same answer as no id.
   */
  @Property({ type: 'uuid', nullable: true })
  sourceQuoteRequestId?: string | null;

  /**
   * Idempotency stamp for the abandonment-sweep notification. Cleared on
   * reactivation so the next abandonment cycle can notify again.
   */
  @Property({ type: 'datetime', nullable: true })
  abandonmentNotifiedAt?: Date | null;

  /**
   * Bumped by every buyer-driven add / remove / qty / coupon / explicit
   * page-open. Drives the abandonment sweep. NOT bumped by mini-cart
   * hovers or non-owner inspections (Org-Admin / platform-admin reads).
   */
  @Property({ type: 'datetime' })
  lastActivityAt: Date = new Date();

  /** Optimistic-lock token (auto-incremented by MikroORM on every update). */
  @Property({ type: 'integer', version: true })
  version!: number;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}

export type CartStatus = 'active' | 'abandoned' | 'completed' | 'rejected' | 'working';

export const CART_STATUSES: readonly CartStatus[] = [
  'active',
  'abandoned',
  'completed',
  'rejected',
  'working',
] as const;

export type CartApprovalStatus =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected_by_org_admin';

export const CART_APPROVAL_STATUSES: readonly CartApprovalStatus[] = [
  'not_required',
  'pending',
  'approved',
  'rejected_by_org_admin',
] as const;
