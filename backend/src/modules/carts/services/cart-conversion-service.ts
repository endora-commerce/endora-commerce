import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { QuoteRequest } from '../../quote_requests/entities/quote-request.entity.js';
import { QuoteRequestItem } from '../../quote_requests/entities/quote-request-item.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import type { RfqService, CustomerContext as RfqCustomerContext } from '../../quote_requests/services/rfq-service.js';
import type { CartService, CustomerContext as CartCustomerContext } from './cart-service.js';

/**
 * Three conversions around the Cart (feature 027 US3):
 *
 *   - convertToQuoteRequest(cart, ctx, note?)
 *       Reads the cart's lines, hands them to `RfqService.createForCustomer`,
 *       flips the source cart's status to `completed` with
 *       `converted_to_quote_request_id` set. The next storefront visit
 *       lazy-creates a fresh `active` cart for the buyer.
 *
 *   - createCartFromQuoteRequest(qrId, ctx)
 *       Reads a Quote Request's lines, creates (or appends to) the buyer's
 *       active cart with re-resolved prices (the QR's proposed prices are
 *       NOT carried over — per FR-017). Skips lines whose product is no
 *       longer purchasable; returns the dropped-line list to the caller.
 *
 *   - appendShoppingListToCart(listId, ctx)
 *       Delegated to `ShoppingListService.convertToCart`, which already
 *       implements the append + skip-archived-products contract from
 *       feature 010 / FR-018. This service just exposes a uniform return
 *       shape across all three conversions.
 *
 * The service does not know about `cart_audit_entries` directly — every
 * write path bumps `cart.lastActivityAt` so the abandonment sweep treats
 * the cart as fresh. Audit-trail wiring is left to a follow-up.
 */

export interface CartDroppedLine {
  productId: string;
  productName: string;
  reason: 'not_purchasable' | 'out_of_stock' | 'no_price_in_customer_list' | 'removed_by_conversion';
}

export interface ConvertToQrResult {
  quoteRequestId: string;
  cartId: string;
}

export interface CreateCartFromQrResult {
  cartId: string;
  appendedLineCount: number;
  droppedLines: CartDroppedLine[];
}

export interface AppendShoppingListResult {
  cartId: string;
  appendedLineCount: number;
  droppedLines: CartDroppedLine[];
}

export class CartConversionService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cartService: CartService,
    private readonly rfqService: RfqService,
  ) {}

  /**
   * Cart → Quote Request. Refuses on an empty cart. Source cart flips to
   * `completed` with `converted_to_quote_request_id` set.
   */
  async convertToQuoteRequest(
    cart: Cart,
    ctx: RfqCustomerContext,
    note?: string,
  ): Promise<ConvertToQrResult> {
    // command-coverage-ignore: the durable write is the RFQ (RfqService
    // .createForCustomer, audited as quote_request.create); this only marks the
    // ephemeral cart completed and clears its items — transient working state.
    const em = this.emFactory();
    const items = await em.find(CartItem, { cartId: cart.id });
    if (items.length === 0) {
      throw new HttpError(422, ERROR_CODES.CART_EMPTY, 'cart_empty');
    }

    const rfq = await this.rfqService.createForCustomer(ctx, {
      ...(note !== undefined ? { headerNote: note } : {}),
      items: items.map((it) => ({
        productId: it.productId,
        ...(it.variantId ? { variantId: it.variantId } : {}),
        quantity: it.quantity,
        // Feature 043 — carry the packaging-unit snapshot so the RFQ line
        // shows "<name> (Paleta)" like the cart did.
        ...(it.packagingUnitName ? { packagingUnitName: it.packagingUnitName } : {}),
        ...(it.packagingUnitBaseQuantity != null
          ? { packagingUnitBaseQuantity: it.packagingUnitBaseQuantity }
          : {}),
        // Carry the buyer's currently-snapshotted unit price as the
        // reference price on the QR line — sales sees what the cart
        // would have cost without negotiation.
        desiredUnitPrice: Number(it.unitPrice),
      })),
    });

    // Flip the source cart to `completed` + record the conversion
    // lineage. Reload on this service's own EM fork before mutating —
    // the `cart` arg was loaded by the route handler's fork and a
    // cross-fork flush would silently no-op (same bug we hit in
    // CartCouponService.apply). Mirror the change back onto the
    // caller's in-memory cart so the audit / response paths see the
    // post-conversion state.
    const managedCart = await em.findOne(Cart, { id: cart.id });
    if (managedCart) {
      managedCart.status = 'completed';
      managedCart.convertedToQuoteRequestId = rfq.id;
      managedCart.lastActivityAt = new Date();
    }
    await em.nativeDelete(CartItem, { cartId: cart.id });
    await em.flush();
    cart.status = 'completed';
    cart.convertedToQuoteRequestId = rfq.id;
    cart.lastActivityAt = managedCart?.lastActivityAt ?? new Date();

    return { quoteRequestId: rfq.id, cartId: cart.id };
  }

  /**
   * Quote Request → Cart. Creates a fresh `active` cart (or returns the
   * existing one) for the buyer, appends the QR's lines with re-resolved
   * prices (via `CartService.addItem`, which already routes through the
   * pricing resolver when wired), and surfaces a list of dropped lines.
   *
   * The QR's `desiredUnitPrice` is intentionally dropped — the cart's
   * unit prices come from the customer's current price list.
   */
  async createCartFromQuoteRequest(
    qrId: string,
    ctx: CartCustomerContext,
  ): Promise<CreateCartFromQrResult> {
    const em = this.emFactory();

    const qr = await em.findOne(QuoteRequest, { id: qrId });
    if (!qr) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'quote_request_not_found');
    }
    // Anti-enumeration: only the requesting customer (or the Organization's
    // org-admin members) may convert it. Foundation gates ownership via the
    // RFQ-detail endpoint; we mirror the customer ownership check here.
    if (qr.customerAccountId !== ctx.customerAccountId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'quote_request_not_found');
    }

    const qrItems = await em.find(QuoteRequestItem, { quoteRequestId: qr.id });
    if (qrItems.length === 0) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'quote_request_empty');
    }

    const productIds = Array.from(new Set(qrItems.map((it) => it.productId)));
    const products = await em.find(Product, { id: { $in: productIds } });
    const productById = new Map(products.map((p) => [p.id, p]));

    const droppedLines: CartDroppedLine[] = [];
    let appendedLineCount = 0;
    let targetCart: Cart | null = null;

    for (const qrItem of qrItems) {
      const product = productById.get(qrItem.productId);
      if (!product) {
        droppedLines.push({
          productId: qrItem.productId,
          productName: qrItem.productName ?? qrItem.productId,
          reason: 'not_purchasable',
        });
        continue;
      }
      try {
        const result = await this.cartService.addItem(
          { customer: ctx },
          {
            productId: qrItem.productId,
            ...(qrItem.variantId ? { variantId: qrItem.variantId } : {}),
            quantity: qrItem.quantity,
          },
        );
        targetCart = result.cart;
        appendedLineCount += 1;
      } catch (err) {
        // CartService throws an HttpError when the product is quote-only
        // (displayMode='none') or no resolver match — both translate to
        // `no_price_in_customer_list` for the storefront banner.
        if (err instanceof HttpError) {
          droppedLines.push({
            productId: qrItem.productId,
            productName: qrItem.productName ?? qrItem.productId,
            reason: 'no_price_in_customer_list',
          });
          continue;
        }
        throw err;
      }
    }

    if (!targetCart) {
      // Every line dropped — still create / fetch the customer's active
      // cart so the caller has a destination cartId.
      targetCart = await this.cartService.getOrCreateForCustomer(ctx);
    }

    return { cartId: targetCart.id, appendedLineCount, droppedLines };
  }
}
