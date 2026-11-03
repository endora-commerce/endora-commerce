import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import type {
  CartDroppedLineReason,
  CatalogProductReadPort,
  QuoteRequestReadPort,
  RfqCustomerContext,
  RfqCustomerPort,
} from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { productIdsInRequestChannel } from '@endora-commerce/platform/kernel';
import type { CartService, CustomerContext as CartCustomerContext } from './cart-service.js';

/**
 * Three conversions around the Cart (feature 027 US3):
 *
 *   - convertToQuoteRequest(cart, ctx, note?)
 *       Reads the cart's lines, hands them to `RfqCustomerPort.createForCustomer`,
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
  reason: CartDroppedLineReason;
  /** Feature 155 — the minimum a `below_minimum` line missed. */
  minimum?: number;
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
    /** `quote_requests`' customer-facing write surface. */
    private readonly rfqService: RfqCustomerPort,
    /** `quote_requests`' row read model — the quote and its lines. */
    private readonly quoteRequests: QuoteRequestReadPort,
    /** `catalog`'s product read model — is the quoted product still there? */
    private readonly catalogProducts: CatalogProductReadPort,
    /**
     * The sanctioned bridge accessor (Constitution XII) — and on this seam it
     * is what keeps the *reason* honest (issue #259). A line the channel does
     * not sell has nothing to do with the buyer's price list, so it is narrowed
     * here, before the batch, into the `not_purchasable` branch — where a line
     * whose product has gone already lands. The batch's own resolver refuses
     * such a line with the same `404`, which maps to the same reason
     * (feature 155, R12.5).
     */
    private readonly channelMembership: SalesChannelMembershipPort,
  ) {}

  /**
   * Cart → Quote Request. Refuses on an empty cart. Source cart flips to
   * `completed` with `converted_to_quote_request_id` set.
   */
  async convertToQuoteRequest(
    cart: Cart,
    ctx: RfqCustomerContext,
    note?: string,
    /**
     * The language a refusal names a product in (feature 155, D3/D4), and the
     * request's language tag the lines' scope language is resolved from
     * (feature 163, `CreateForCustomerOptions.languageTag`).
     */
    options: { language?: string; languageTag?: string } = {},
  ): Promise<ConvertToQrResult> {
    // command-coverage-ignore: the durable write is the RFQ (RfqService
    // .createForCustomer, audited as quote_request.create); this only marks the
    // ephemeral cart completed and clears its items — transient working state.
    const em = this.emFactory();
    const items = await em.find(CartItem, { cartId: cart.id });
    if (items.length === 0) {
      throw new HttpError(422, ERROR_CODES.CART_EMPTY, 'cart_empty');
    }

    // Feature 155 (FR-026, research R13.1) — a packaging line travels by its
    // unit's id, and only while the unit still exists: the quote request takes
    // the unit's name and base quantity from the catalogue, so the cart's
    // snapshot is no longer sent. One read over the buyer's own cart lines; a
    // line whose unit has gone is sent as plain pieces, its quantity (already
    // base pieces) unchanged.
    const packagedProductIds = Array.from(
      new Set(items.filter((it) => it.packagingUnitId).map((it) => it.productId)),
    );
    const liveUnitIds = new Set(
      packagedProductIds.length > 0
        ? (await this.catalogProducts.listPackagingUnitsByProductIds(packagedProductIds)).map(
            (unit) => `${unit.productId}:${unit.id}`,
          )
        : [],
    );

    const rfq = await this.rfqService.createForCustomer(
      ctx,
      {
        ...(note !== undefined ? { headerNote: note } : {}),
        items: items.map((it) => ({
          productId: it.productId,
          ...(it.variantId ? { variantId: it.variantId } : {}),
          quantity: it.quantity,
          ...(it.packagingUnitId && liveUnitIds.has(`${it.productId}:${it.packagingUnitId}`)
            ? { packagingUnitId: it.packagingUnitId }
            : {}),
          // No `desiredUnitPrice`: the cart price is not something the buyer
          // proposed (feature 146, FR-008).
        })),
      },
      {
        // Feature 146 (FR-008, research R3) — the cart's own snapshot is the
        // line's reference ("price at request"): what sales sees the cart
        // would have cost without negotiation. `unitPrice` is the net price
        // per base piece, the basis every quote price is compared on (T12).
        lineReferencePrices: items.map((it) => ({ amount: it.unitPrice, currency: it.currency })),
        ...(options.language ? { language: options.language } : {}),
        // Feature 163 — the lines are asked about at the basket's channel, in
        // the request's scope language (the basket's own `basketScopeLanguage`).
        ...(options.languageTag ? { languageTag: options.languageTag } : {}),
        ...(cart.salesChannelId ? { salesChannelId: cart.salesChannelId } : {}),
      },
    );

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
   * prices through the cart's batch add, and surfaces a list of dropped lines.
   *
   * The QR's `desiredUnitPrice` is intentionally dropped — the cart's
   * unit prices come from the customer's current price list.
   *
   * Feature 155 (research R8, R12.5) — the lines go in as **one batch**
   * (`addItems`, `'report'`), so a product's lines are judged together with the
   * cart against its minimum, and each line's outcome is mapped:
   *   - `below_minimum` → dropped `below_minimum` with the `minimum`;
   *   - `failed` with a `404` — the product is no longer visible to this buyer,
   *     not in the channel, or its unit is gone — → `not_purchasable`, the
   *     reason an unknown product already gets, so a hidden product is
   *     indistinguishable from one that does not exist (FR-035, threat F1);
   *   - any other `failed` (quote-only, no price, line cap) →
   *     `no_price_in_customer_list`.
   * Every dropped line is named from the buyer's own quote request, never from
   * the catalogue.
   */
  async createCartFromQuoteRequest(
    qrId: string,
    ctx: CartCustomerContext,
    /** The request's language, which the batch names a refused product in (feature 155). */
    options: { language?: string } = {},
  ): Promise<CreateCartFromQrResult> {
    const qr = await this.quoteRequests.findById(qrId);
    if (!qr) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'quote_request_not_found');
    }
    // Anti-enumeration: only the requesting customer (or the Organization's
    // org-admin members) may convert it. Foundation gates ownership via the
    // RFQ-detail endpoint; we mirror the customer ownership check here.
    if (qr.customerAccountId !== ctx.customerAccountId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'quote_request_not_found');
    }

    const qrItems = await this.quoteRequests.listItems(qr.id);
    if (qrItems.length === 0) {
      // Issue #86 — `quote_requests`' own code for a quote request with no
      // lines, not `VALIDATION_FAILED` with the token `quote_request_empty`
      // as the message the buyer read.
      throw new HttpError(
        422,
        ERROR_CODES.RFQ_EMPTY,
        'The quote request has no lines.',
        { quoteRequestId: qr.id },
      );
    }

    const productIds = Array.from(new Set(qrItems.map((it) => it.productId)));
    const products = await this.catalogProducts.findByIds(productIds);
    const publishedHere = await productIdsInRequestChannel(this.channelMembership, productIds);
    const productById = new Map(
      products
        .filter((p) => publishedHere === null || publishedHere.has(p.id))
        .map((p) => [p.id, p]),
    );

    const dropped = new Map<number, CartDroppedLine>();
    const nameOf = (qrItem: (typeof qrItems)[number]): string => qrItem.productName ?? qrItem.productId;
    const batch: Array<{ position: number; qrItem: (typeof qrItems)[number] }> = [];
    for (const [position, qrItem] of qrItems.entries()) {
      if (!productById.has(qrItem.productId)) {
        dropped.set(position, {
          productId: qrItem.productId,
          productName: nameOf(qrItem),
          reason: 'not_purchasable',
        });
        continue;
      }
      batch.push({ position, qrItem });
    }

    let appendedLineCount = 0;
    let targetCart: { id: string } | null = null;
    if (batch.length > 0) {
      // `addItems` always throws `ModuleDisabledError` itself — a switched-off
      // pricing engine is never reported as "no price in your list" for every
      // line (issue #124) — so there is no `catch` here.
      const result = await this.cartService.addItems(
        { customer: ctx },
        batch.map(({ qrItem }) => ({
          productId: qrItem.productId,
          ...(qrItem.variantId ? { variantId: qrItem.variantId } : {}),
          quantity: qrItem.quantity,
        })),
        { onLineError: 'report', ...(options.language ? { language: options.language } : {}) },
      );
      targetCart = result.cart;
      for (const outcome of result.outcomes) {
        const entry = batch[outcome.index];
        if (!entry) continue;
        const { position, qrItem } = entry;
        if (outcome.status === 'added') {
          appendedLineCount += 1;
          continue;
        }
        dropped.set(position, {
          productId: qrItem.productId,
          productName: nameOf(qrItem),
          ...(outcome.status === 'below_minimum'
            ? { reason: 'below_minimum' as const, minimum: outcome.minimum }
            : {
                reason:
                  outcome.error.status === 404
                    ? ('not_purchasable' as const)
                    : ('no_price_in_customer_list' as const),
              }),
        });
      }
    }

    if (!targetCart) {
      // Every line dropped — still create / fetch the customer's active
      // cart so the caller has a destination cartId.
      targetCart = await this.cartService.getOrCreateForCustomer(ctx);
    }

    const droppedLines = Array.from(dropped.entries())
      .sort(([a], [b]) => a - b)
      .map(([, line]) => line);
    return { cartId: targetCart.id, appendedLineCount, droppedLines };
  }
}
