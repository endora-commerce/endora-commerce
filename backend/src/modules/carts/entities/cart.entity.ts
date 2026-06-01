import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
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
 *
 * Legacy `converted` was migrated to `completed` by migration 050. Mass
 * code in the repo that previously wrote `'converted'` now writes
 * `'completed'` (CartService.clearForCustomer).
 *
 * `approval_status` is the orthogonal sub-state that gates checkout when
 * the Organization's `requires_cart_approval` policy is `true`. Self-
 * approval exemption: a cart created by an Org Admin is born with
 * `approval_status='not_required'` regardless of the policy. Post-approval
 * mutation re-arms `approved → pending` (see CartApprovalService).
 *
 * `version` is the optimistic-lock token used by the approval / mutation
 * race (buyer-vs-Org-Admin) — aligned with the convention shared by
 * features 003 / 026.
 */
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
    | 'convertedToQuoteRequestId'
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

  /** Set on Cart → Quote Request conversion (feature 027 US3). */
  @Property({ type: 'uuid', nullable: true })
  convertedToQuoteRequestId?: string | null;

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

export type CartStatus = 'active' | 'abandoned' | 'completed' | 'rejected';

export const CART_STATUSES: readonly CartStatus[] = [
  'active',
  'abandoned',
  'completed',
  'rejected',
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
