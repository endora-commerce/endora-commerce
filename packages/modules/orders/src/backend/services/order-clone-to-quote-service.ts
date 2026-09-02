import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CreateQuoteRequest,
  type RfqCustomerPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Order } from '../entities/order.entity.js';
import { OrderItem } from '../entities/order-item.entity.js';

interface CloneContext {
  customerAccountId: string;
  organizationId: string;
  isOrgAdmin?: boolean;
}

/**
 * OrderCloneToQuoteService — feature 038 (US7).
 *
 * Builds a new Quote Request from an existing order's line items by delegating
 * to the Quote Requests module (RfqService.createForCustomer). Honors module
 * isolation: orders only maps line items and calls the port.
 */
export class OrderCloneToQuoteService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly getRfqService: () => RfqCustomerPort | null,
  ) {}

  async clone(orderId: string, ctx: CloneContext): Promise<{ quoteRequestId: string }> {
    const rfq = this.getRfqService();
    if (!rfq) {
      throw new HttpError(503, ERROR_CODES.VALIDATION_FAILED, 'Quote Requests module is not available.');
    }
    const em = this.emFactory();
    const order = await em.findOne(Order, { id: orderId, organizationId: ctx.organizationId });
    if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');

    const items = await em.find(OrderItem, { orderId });
    if (items.length === 0) {
      throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'Order has no line items to clone.');
    }

    const input: CreateQuoteRequest = {
      items: items.map((it) => ({
        productId: it.productId,
        ...(it.variantId ? { variantId: it.variantId } : {}),
        quantity: it.quantity,
      })),
    };

    const created = await rfq.createForCustomer(
      {
        customerAccountId: ctx.customerAccountId,
        organizationId: ctx.organizationId,
        isOrgAdmin: ctx.isOrgAdmin ?? true,
      },
      input,
    );
    return { quoteRequestId: created.id };
  }
}
