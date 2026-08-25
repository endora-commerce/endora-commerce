import {
  ERROR_CODES,
  type CartWritePort,
  type QuickOrderBuildResponse,
  type QuickOrderTarget,
  type RfqCustomerPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

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
 * recognized lines into either a Cart (via {@link CartWritePort}) or a Quote
 * Request (via {@link RfqCustomerPort}) — reusing the owning modules' surfaces
 * rather than a parallel ordering path (FR-031). Pricing is owned by those
 * modules (the buyer's / organization's current price list), never the import
 * file (FR-007).
 */
export class QuickOrderBuildService {
  constructor(
    private readonly cartWrite: CartWritePort,
    private readonly rfq: RfqCustomerPort,
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
    const cart = await this.cartWrite.getOrCreateForCustomer(customer);
    for (const item of items) {
      await this.cartWrite.addItem(
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
    const rfq = await this.rfq.createForCustomer(
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
