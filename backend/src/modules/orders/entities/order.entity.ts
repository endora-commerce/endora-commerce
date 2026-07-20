import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';
import type { NextAction } from '@b2b/contracts';

/**
 * Order — data-model.md § Domain 4.
 *
 * Addresses, delivery method, and payment method are captured as embedded
 * snapshots (JSONB) so later edits to the source rows don't rewrite history.
 *
 * FK targets held as plain uuid columns:
 *   organizationId, placedByCustomerAccountId, placedOnBehalfByAdminUserId,
 *   salesChannelId, deliveryAddressId, billingAddressId,
 *   deliveryMethodId, paymentMethodId, sourceQuoteRequestId.
 */
@OrgScoped()
@Entity({ tableName: 'orders' })
export class Order {
  [OptionalProps]?:
    | 'customFieldValues'
    | 'id'
    | 'businessId'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'paymentStatus'
    | 'placedOnBehalfByAdminUserId'
    | 'sourceQuoteRequestId'
    | 'customerNote'
    | 'promotionCode'
    | 'discountTotal';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /**
   * Feature 036 — customer-facing business Order ID, distinct from `id`.
   * Real orders are stamped by `OrderService.placeOrder` via the
   * business-ID sequence + prefix/suffix settings. The placeholder default
   * (mirroring `id`) keeps direct `em.create(Order, …)` fixtures unique
   * without forcing every caller to pass it.
   */
  @Property({ type: 'string', length: 128 })
  @Unique()
  businessId: string = `ORD-${randomUUID()}`;

  /**
   * Virtual (not persisted): the payment next-action computed at placement
   * (transfer details / gateway redirect / none). Set by `placeOrder` and
   * surfaced in the place-order response so the Success Page can route the
   * buyer. Order reads load it as `undefined` → serialized as `null`.
   */
  @Property({ type: 'json', persist: false })
  nextAction?: NextAction | null;

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'uuid' })
  @Index()
  placedByCustomerAccountId!: string;

  @Property({ type: 'uuid', nullable: true })
  placedOnBehalfByAdminUserId?: string | null;

  @Property({ type: 'uuid' })
  salesChannelId!: string;

  /**
   * Configurable lifecycle status code (feature 038). Was a fixed enum union;
   * the authoritative status is now a code validated in-service against the
   * admin-configurable `order_statuses` set. Defaults to the initial status
   * `new`.
   */
  @Property({ type: 'string', length: 64 })
  @Index()
  status: string = 'new';

  @Property({ type: 'string', length: 32 })
  @Index()
  paymentStatus: 'awaiting_payment' | 'paid' | 'deferred' | 'refunded' = 'awaiting_payment';

  @Property({ type: 'json' })
  deliveryAddress!: {
    recipientName: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
    phone?: string | null;
  };

  @Property({ type: 'json' })
  billingAddress!: {
    recipientName: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
    phone?: string | null;
    /**
     * Billing company name + tax-id (NIP) captured at placement. Default from
     * the Organization; overridable at checkout (feature: billing org override).
     */
    companyName?: string | null;
    taxId?: string | null;
  };

  @Property({ type: 'uuid' })
  deliveryMethodId!: string;

  @Property({ type: 'json' })
  deliveryMethodSnapshot!: {
    code: string;
    name: string;
    cost: number;
  };

  @Property({ type: 'uuid' })
  paymentMethodId!: string;

  @Property({ type: 'json' })
  paymentMethodSnapshot!: {
    code: string;
    name: string;
    kind: 'bank_transfer' | 'pickup' | 'credit_limit' | 'gateway';
    /** Feature 034 — adapter registry key the order was placed with. */
    adapter?: string;
    /** Feature 034 — flat payment surcharge captured at placement. */
    additionalPrice?: number;
  };

  @Property({ type: 'uuid', nullable: true })
  sourceQuoteRequestId?: string | null;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  subtotal!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  taxTotal!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  discountTotal: string = '0';

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  deliveryTotal!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  total!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'string', length: 64, nullable: true })
  promotionCode?: string | null;

  @Property({ type: 'text', nullable: true })
  customerNote?: string | null;

  @Property({ type: 'datetime' })
  @Index()
  placedAt: Date = new Date();

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  // Feature 055 — Custom Fields Layer value bag (inherits host tenant scope).
  @Property({ type: 'json' })
  customFieldValues: Record<string, unknown> = {};
}
