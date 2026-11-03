import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CreateQuoteRequest,
  type CustomerAccountReadPort,
  type RfqCustomerPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { Order } from '../entities/order.entity.js';
import { OrderAccessService, type OrderScopeContext } from './order-access-service.js';
import { loadArrangedOrderLines } from './order-line-order.js';

/**
 * Feature 155 (FR-012, FR-030; `contracts/quote-requests-api.md` §3) — who is
 * cloning. `actor: 'operator'` is set only by the admin route, as a literal
 * (threat F10): never read from a request body or query. The request is then
 * created with the minimums flagged on the admin read rather than refused.
 * Absent = the buyer, whose clone is refused below a minimum (US4 #5a).
 */
export interface CloneOptions {
  actor?: 'operator';
  /**
   * Feature 163 — the buyer's request: the language a refusal names a product in,
   * its language tag and its channel, which the lines are judged at
   * (`CreateForCustomerOptions`). Never set for the operator.
   */
  language?: string;
  languageTag?: string;
  salesChannelId?: string;
}

/**
 * OrderCloneToQuoteService — feature 038 (US7).
 *
 * Builds a new Quote Request from an existing order's line items by delegating
 * to the Quote Requests module (RfqService.createForCustomer). Honors module
 * isolation: orders only maps line items and calls the port.
 */
export class OrderCloneToQuoteService {
  readonly #access: OrderAccessService;

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly getRfqService: () => RfqCustomerPort | null,
    customerAccountRead: CustomerAccountReadPort,
  ) {
    this.#access = new OrderAccessService(customerAccountRead);
  }

  /**
   * `ctx` is whoever the request is created for: the buyer on the storefront
   * route, the order's placer on the operator route.
   */
  async clone(
    orderId: string,
    ctx: OrderScopeContext,
    options: CloneOptions = {},
  ): Promise<{ quoteRequestId: string }> {
    const rfq = this.getRfqService();
    if (!rfq) {
      // Issue #86 — the platform's refusal for a module that is off, naming it,
      // rather than `VALIDATION_FAILED` under a 503.
      throw new ModuleDisabledError('quote_requests');
    }
    const em = this.emFactory();
    // Issue #665 — the order is resolved through the rule the read applies
    // (`OrderAccessService`): a regular member reaches only the orders they
    // placed, an organization admin every order of the Organization. Anything
    // else is answered as an order that does not exist, as `GET /orders/:id`
    // answers it. The operator route passes the order's placer, who is always
    // in scope, so its behaviour is unchanged.
    const order = await em.findOne(Order, await this.#access.scopedWhere(ctx, { id: orderId }));
    if (!order) throw new HttpError(404, ERROR_CODES.ORDER_NOT_FOUND, 'Order not found.');

    // Feature 159 — the lines in the order's display order.
    const items = (await loadArrangedOrderLines(em, orderId)).lines;
    if (items.length === 0) {
      throw new HttpError(
        409,
        ERROR_CODES.ORDER_CLONE_NO_LINES,
        'Order has no line items to clone.',
        { orderId },
      );
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
        // Issue #665 — `createForCustomer` reads no role, and the request is
        // the caller's own. Stated as `false`, as every other creating caller
        // states it: a missing value must never be read as "admin".
        isOrgAdmin: false,
      },
      input,
      options.actor === 'operator'
        ? { minimums: 'warn' }
        : {
            ...(options.language ? { language: options.language } : {}),
            ...(options.languageTag ? { languageTag: options.languageTag } : {}),
            ...(options.salesChannelId ? { salesChannelId: options.salesChannelId } : {}),
          },
    );
    return { quoteRequestId: created.id };
  }
}
