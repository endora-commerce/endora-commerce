import { ERROR_CODES, type QuickOrderBuildResponse, type QuickOrderTarget } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { CartService } from '../../carts/services/cart-service.js';
import type { RfqService } from '../../quote_requests/services/rfq-service.js';

/**
 * Context for a quick-order build. `organizationId` may be null for a no-org
 * customer (carts tolerate this; quote requests require an organization).
 */
export interface QuickOrderBuildContext {
  customerAccountId: string;
  organizationId: string | null;
  isOrgAdmin?: boolean;
}

export interface QuickOrderBuildLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

/**
 * QuickOrderBuildService (feature 039, US1). Turns a confirmed set of
 * recognized lines into either a Cart (via {@link CartService}) or a Quote
 * Request (via {@link RfqService}) — reusing the existing services rather
 * than a parallel ordering path (FR-031). Pricing is owned by those services
 * (the buyer's / organization's current price list), never the import file
 * (FR-007).
 */
export class QuickOrderBuildService {
  constructor(
    private readonly cartService: CartService,
    private readonly rfqService: RfqService,
  ) {}

  async build(
    ctx: QuickOrderBuildContext,
    input: { target: QuickOrderTarget; items: QuickOrderBuildLineInput[] },
  ): Promise<QuickOrderBuildResponse> {
    if (input.items.length === 0) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'No items to build.');
    }

    if (input.target === 'cart') {
      return this.buildCart(ctx, input.items);
    }
    return this.buildQuoteRequest(ctx, input.items);
  }

  private async buildCart(
    ctx: QuickOrderBuildContext,
    items: QuickOrderBuildLineInput[],
  ): Promise<QuickOrderBuildResponse> {
    const customer = { customerAccountId: ctx.customerAccountId, organizationId: ctx.organizationId };
    const cart = await this.cartService.getOrCreateForCustomer(customer);
    for (const item of items) {
      await this.cartService.addItem(
        { customer },
        {
          productId: item.productId,
          ...(item.variantId ? { variantId: item.variantId } : {}),
          quantity: item.quantity,
        },
      );
    }
    return { target: 'cart', cartId: cart.id, checkoutUrl: `/checkout?cartId=${cart.id}` };
  }

  private async buildQuoteRequest(
    ctx: QuickOrderBuildContext,
    items: QuickOrderBuildLineInput[],
  ): Promise<QuickOrderBuildResponse> {
    if (!ctx.organizationId) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'A quote request requires an organization.',
      );
    }
    const rfq = await this.rfqService.createForCustomer(
      {
        customerAccountId: ctx.customerAccountId,
        organizationId: ctx.organizationId,
        isOrgAdmin: ctx.isOrgAdmin ?? false,
      },
      {
        items: items.map((item) => ({
          productId: item.productId,
          ...(item.variantId ? { variantId: item.variantId } : {}),
          quantity: item.quantity,
        })),
      },
    );
    return {
      target: 'quote_request',
      quoteRequestId: rfq.id,
      quoteRequestBusinessId: rfq.businessId,
    };
  }
}
