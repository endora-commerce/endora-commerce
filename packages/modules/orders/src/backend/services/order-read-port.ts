import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  EntityExtensionReadOptions,
  OrderCustomerContext,
  OrganizationPermissionPort,
  OrderItemRecord,
  OrderReadPort,
  OrderRecord,
  OrderStatusDefinitionRecord,
  WithEntityExtensions,
} from '@endora-commerce/contracts';
import { lazyEntityExtensionReads, type EntityExtensionReads } from '@endora-commerce/platform/kernel';
import { Order } from '../entities/order.entity.js';
import { OrderStatus } from '../entities/order-status.entity.js';
import { OrderItem } from '../entities/order-item.entity.js';
import { OrderAccessService } from './order-access-service.js';
import type { OrderStatusGraphService } from './order-status-graph-service.js';
import { isUuidShape } from '@endora-commerce/contracts';

/**
 * The row-level read model `orders` publishes (feature 075, Phase P).
 *
 * Thirty-three of this module's 42 inbound import sites are the same lookup —
 * `em.findOne(Order, { id })` — written out once each in four payment
 * gateways, `invoices`, `shipments`, `quote_requests`, `autopay` and the
 * export adapter. The port is that lookup, plus the two shapes around it.
 *
 * The money columns stay strings across the boundary. They are
 * `decimal(14,2)`, the entity carries them as strings because a `number`
 * cannot round-trip a monetary value, and four of the consumers forward the
 * figure straight to a payment provider.
 *
 * `findById`, `findByIdForCustomer`, `findByIds` and `listAll` take
 * `options.include` (`specs/187-side-table-extensions/` FR-058): the orders
 * found under the caller's scope — the tenant filter, and for
 * `findByIdForCustomer` the own-orders rule too — are handed, on the entity
 * manager that found them, to the platform's `entityExtensionReads`. Without
 * `include` nothing is resolved.
 */
const HOST = 'orders.Order';

export class OrderReadService implements OrderReadPort {
  readonly #access: OrderAccessService;

  /**
   * `organizationPermissions` is what {@link findByIdForCustomer} asks whether
   * the caller holds `orders.view_organization`; it is handed to the same
   * `OrderAccessService` that `OrderService` scopes its reads with, so there
   * is one rule, not two.
   */
  constructor(
    private readonly emFactory: () => EntityManager,
    organizationPermissions: OrganizationPermissionPort,
    /**
     * The configured lifecycle, for {@link isTerminal} — resolved per call,
     * because the graph service is built in the plugin body and is cached and
     * invalidated by the instance that writes it.
     */
    private readonly graph: () => Pick<OrderStatusGraphService, 'loadGraph'>,
    /** The kernel's `entityExtensionReads`; absent in a hand-built service, which has no loader to offer. */
    private readonly extensionReads: EntityExtensionReads = lazyEntityExtensionReads(() => undefined),
  ) {
    this.#access = new OrderAccessService(organizationPermissions);
  }

  /**
   * `specs/186-aggregate-ports/` — moved here from the deprecated
   * `orderTransitionPort`. Asked of the graph, never of a status code this
   * file recognises: the set is operator-configurable and a deployment may add
   * terminal statuses of its own.
   */
  async isTerminal(orderId: string): Promise<boolean | null> {
    if (!isUuidShape(orderId)) return null;
    const order = await this.emFactory().findOne(Order, { id: orderId });
    if (!order) return null;
    return (await this.graph().loadGraph()).isTerminal(order.status);
  }

  async findById(id: string, options?: EntityExtensionReadOptions): Promise<WithEntityExtensions<OrderRecord> | null> {
    if (!isUuidShape(id)) return null;
    const em = this.emFactory();
    const order = await em.findOne(Order, { id });
    return order ? this.#attachOne(toOrderRecord(order), options, em) : null;
  }

  /**
   * The customer-scoped lookup (issue #669). The `where` comes from
   * `OrderAccessService` — the one home of the own-orders /
   * `orders.view_organization` rule that `OrderService.getById` uses — so a
   * consumer serving an order-scoped resource and `GET /api/v1/orders/:id`
   * cannot disagree.
   */
  async findByIdForCustomer(
    id: string,
    customer: Pick<OrderCustomerContext, 'customerAccountId' | 'organizationId'>,
    options?: EntityExtensionReadOptions,
  ): Promise<WithEntityExtensions<OrderRecord> | null> {
    if (!isUuidShape(id)) return null;
    const where = await this.#access.scopedWhere(customer, { id });
    const em = this.emFactory();
    const order = await em.findOne(Order, where);
    return order ? this.#attachOne(toOrderRecord(order), options, em) : null;
  }

  async findByIds(
    ids: readonly string[],
    options?: EntityExtensionReadOptions,
  ): Promise<WithEntityExtensions<OrderRecord>[]> {
    if (ids.length === 0) return [];
    const em = this.emFactory();
    const orders = await em.find(Order, { id: { $in: [...ids] } });
    return [...(await this.extensionReads.attach(HOST, orders.map(toOrderRecord), options, em))];
  }

  async listAll(options?: EntityExtensionReadOptions): Promise<WithEntityExtensions<OrderRecord>[]> {
    const em = this.emFactory();
    const orders = await em.find(Order, {}, { orderBy: { placedAt: 'desc' } });
    return [...(await this.extensionReads.attach(HOST, orders.map(toOrderRecord), options, em))];
  }

  async #attachOne(
    record: OrderRecord,
    options: EntityExtensionReadOptions | undefined,
    em: EntityManager,
  ): Promise<WithEntityExtensions<OrderRecord>> {
    const [attached] = await this.extensionReads.attach(HOST, [record], options, em);
    return attached ?? record;
  }

  async findIdsByBusinessIdLike(fragment: string, limit: number): Promise<string[]> {
    const trimmed = fragment.trim();
    if (!trimmed) return [];
    const orders = await this.emFactory().find(
      Order,
      { businessId: { $ilike: `%${trimmed}%` } },
      { fields: ['id'], orderBy: { placedAt: 'desc' }, limit },
    );
    return orders.map((order) => order.id);
  }

  async salesChannelIdsForCustomer(customerAccountId: string): Promise<string[]> {
    const orders = await this.emFactory().find(
      Order,
      { placedByCustomerAccountId: customerAccountId },
      { fields: ['salesChannelId'], orderBy: { placedAt: 'desc' } },
    );
    // Distinct, newest first: the first row a channel appears in is that
    // customer's latest order on it, so first-appearance order *is* the
    // ordering the contract promises. `customers` used to take the raw rows
    // and dedupe them itself, which left the order undefined.
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const order of orders) {
      if (seen.has(order.salesChannelId)) continue;
      seen.add(order.salesChannelId);
      ids.push(order.salesChannelId);
    }
    return ids;
  }

  /**
   * `order_statuses` is global configuration, so this is one unique-index
   * lookup by code (`specs/149-pwa-order-status-push/`).
   */
  async findStatusDefinition(code: string): Promise<OrderStatusDefinitionRecord | null> {
    const status = await this.emFactory().findOne(OrderStatus, { code });
    if (!status) return null;
    return { code: status.code, name: { ...status.name }, defaultName: status.defaultName };
  }

  async listItems(orderId: string): Promise<OrderItemRecord[]> {
    const items = await this.emFactory().find(
      OrderItem,
      { orderId },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );
    return items.map(toOrderItemRecord);
  }
}

export function toOrderRecord(order: Order): OrderRecord {
  return {
    id: order.id,
    businessId: order.businessId,
    organizationId: order.organizationId,
    payerOrganizationId: order.payerOrganizationId ?? null,
    placedByCustomerAccountId: order.placedByCustomerAccountId,
    placedOnBehalfByAdminUserId: order.placedOnBehalfByAdminUserId ?? null,
    salesChannelId: order.salesChannelId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryAddress: order.deliveryAddress,
    billingAddress: order.billingAddress,
    deliveryPointSnapshot: order.deliveryPointSnapshot ?? null,
    shippingAdapterData: order.shippingAdapterData ?? null,
    deliveryMethodId: order.deliveryMethodId,
    deliveryMethodSnapshot: order.deliveryMethodSnapshot,
    paymentMethodId: order.paymentMethodId,
    paymentMethodSnapshot: order.paymentMethodSnapshot,
    sourceQuoteRequestId: order.sourceQuoteRequestId ?? null,
    subtotal: order.subtotal,
    taxTotal: order.taxTotal,
    discountTotal: order.discountTotal,
    deliveryTotal: order.deliveryTotal,
    chargeLines: order.chargeLines ?? null,
    total: order.total,
    currency: order.currency,
    promotionCode: order.promotionCode ?? null,
    customerNote: order.customerNote ?? null,
    placedAt: order.placedAt,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    customFieldValues: order.customFieldValues ?? {},
    // `specs/186-aggregate-ports/` (R-8) — the payer as the order stores it
    // (`specs/182-related-payers/`), in the admin detail's shape.
    payer:
      order.payerOrganizationId && order.payerSnapshot
        ? {
            organizationId: order.payerOrganizationId,
            name: order.payerSnapshot.name,
            taxId: order.payerSnapshot.taxId,
            terms: order.payerTerms ?? 'buyer',
          }
        : null,
  };
}

export function toOrderItemRecord(item: OrderItem): OrderItemRecord {
  return {
    id: item.id,
    orderId: item.orderId,
    productId: item.productId,
    productSnapshot: item.productSnapshot,
    variantId: item.variantId ?? null,
    variantSnapshot: item.variantSnapshot ?? null,
    packagingUnitSnapshot: item.packagingUnitSnapshot ?? null,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    taxRate: item.taxRate,
    lineTotal: item.lineTotal,
    createdAt: item.createdAt,
  };
}
