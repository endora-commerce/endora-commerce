import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';
import type { NextAction } from '@endora-commerce/contracts';

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
    | 'discountTotal'
    | 'deliveryPointSnapshot'
    | 'purchaseConversionOwed'
    | 'purchaseConversionReportedAt';

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

  /**
   * The money axis, widened with `failed` by feature 085 (FR-001). A declined
   * gateway payment used to be recorded on the lifecycle axis alone — the
   * method's `status_on_failure` — which said nothing about the money and, with
   * the seeded default of the day, made the order terminal. The column is a
   * plain `varchar(32)` with no check constraint and the wire schema has
   * allowed the value since feature 034, so this widening needs no DDL.
   */
  @Property({ type: 'string', length: 32 })
  @Index()
  paymentStatus: 'awaiting_payment' | 'paid' | 'failed' | 'deferred' | 'refunded' =
    'awaiting_payment';

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

  /**
   * Optional pickup-point choice captured at checkout. Provider-agnostic on
   * purpose: future carrier adapters can reuse one snapshot shape.
   */
  @Property({ type: 'json', nullable: true })
  deliveryPointSnapshot?: {
    provider: string;
    pointId: string;
    label?: string | null;
    address?: string | null;
  } | null;

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

  /**
   * Whether this order still owes a GA4 `purchase` conversion (issue #277).
   *
   * Inverted on purpose, and the default is the load-bearing half: `false`
   * means *owes nothing*, which is what every row predating the column should
   * say — those were all counted by the Success Page that counted
   * unconditionally. `placeOrder` sets it to `true`, so an order this platform
   * places from now on owes one until a storefront page reports it.
   *
   * Never read as a business fact: it decides whether a tag fires and nothing
   * else. No lifecycle rule, invoice or fulfilment step may consult it.
   */
  @Property({ type: 'boolean', default: false })
  purchaseConversionOwed: boolean = false;

  /**
   * When the conversion was reported, if it ever was.
   *
   * This is what keeps the two falses apart: `owed = false` with no timestamp
   * is an order that never owed a conversion, and `owed = false` with one is
   * an order whose conversion was reported at that moment. Without it the flag
   * could say "do not report" and could not say why, which is exactly the
   * question someone reconciling GA4 against the orders table asks.
   */
  @Property({ type: 'datetime', nullable: true })
  purchaseConversionReportedAt?: Date | null;

  // Feature 055 — Custom Fields Layer value bag (inherits host tenant scope).
  @Property({ type: 'json' })
  customFieldValues: Record<string, unknown> = {};
}
