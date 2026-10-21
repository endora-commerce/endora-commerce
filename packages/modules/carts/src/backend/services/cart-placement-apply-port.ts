import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CartCustomerContext,
  CartWithItems,
  CatalogProductReadPort,
} from '@endora-commerce/contracts';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import type { CartLinePriceDrift, CartPlacementApplyPort } from '../../ports/index.js';
import { toCartItemRecord, toCartRecord } from './cart-read-port.js';
import { agreementOf, storedPriceDiffers, type CartLinePricing } from './cart-line-pricing.js';

/**
 * `cartPlacementApplyPort` — the basket half of order placement, run on the
 * caller's `EntityManager` (feature 080, T048; D-169).
 *
 * `orders` held `Cart` and `CartItem` itself until T048: `placeOrder` read the
 * basket on its own transaction, built the order out of it, and ended by
 * deleting the lines, moving the cart to `completed` and stamping
 * `completed_order_id` — four statements against this module's two tables,
 * written by a module that owns neither. D-168 leaves a packaged `carts` no
 * entity class for `orders` to name, so the reach had to go before this module
 * moves.
 *
 * **The transaction is unchanged, and that is the point of the conversion.**
 * The read and the completion still run on placement's own `EntityManager`;
 * `carts_completed_order_fk` is untouched; a placement that fails still leaves
 * the basket exactly as the buyer left it, which
 * `test/integration/orders/place-order-failure-preserves-cart.test.ts` asserts
 * and which a port opening its own transaction could not deliver. What changed
 * is that the statements are written by the module that owns the tables, and
 * what crosses the boundary is `CartWithItems` — published records — instead of
 * two managed entities the consumer could move any column of (D-77's first
 * narrowing).
 *
 * The port's own doc block, in `../ports/index.ts`, states the constraint and
 * why the read takes an `EntityManager` where `CartReadPort.findActiveForCustomer`
 * does not.
 */
export class CartPlacementApplyService implements CartPlacementApplyPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** The same pricing chain `CartService` stores a line's price from. */
    private readonly linePricing: CartLinePricing,
    private readonly catalogProducts: CatalogProductReadPort,
  ) {}

  async readActiveForPlacement(
    em: EntityManager,
    ctx: CartCustomerContext,
  ): Promise<CartWithItems | null> {
    // The same conditional org predicate `CartReadService` applies, and for the
    // same reason: `carts.organization_id` is nullable for a customer account
    // that has none, so a caller with no organisation must not be narrowed out
    // of its own basket. `Cart` is `@CustomerScoped`, so the tenant guard is on
    // the customer either way.
    //
    // The basket is the one of the channel the order is placed on
    // (`specs/154-sales-channel-access/`, contracts/basket-attribution.md §4):
    // a customer holds one per channel, and another store's basket is not this
    // order's.
    const cart = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      ...(ctx.organizationId === null ? {} : { organizationId: ctx.organizationId }),
      salesChannelId: ctx.salesChannelId,
      status: 'active',
    });
    if (!cart) return null;
    // In the basket's own order — `CartReadService`'s. The order's lines are
    // numbered in it, and a quote's or an administrator's grouping is laid over
    // it (feature 159, research N-31); unordered, it was the heap's order.
    const items = await em.find(CartItem, { cartId: cart.id }, { orderBy: { createdAt: 'asc', id: 'asc' } });
    return { cart: toCartRecord(cart), items: items.map(toCartItemRecord) };
  }

  async completeForOrder(
    em: EntityManager,
    input: { cartId: string; orderId: string },
  ): Promise<void> {
    // command-coverage-ignore: the basket half of an order placement, inside
    // the caller's transaction. `orders` audits the placement as one operation
    // through its own Command; a second audit entry for the basket the order
    // came from would record the same decision twice, and the cart is not an
    // auditable domain object in its own right — the same reasoning
    // `cartWritePort.replaceItemsForCustomer` carries.
    const cart = await em.findOne(Cart, { id: input.cartId });
    if (!cart) return;
    await em.nativeDelete(CartItem, { cartId: cart.id });
    // Feature 027's renamed status vocabulary: the cart produced an order, so
    // its lifecycle terminates in `completed`.
    cart.status = 'completed';
    // Which order emptied this cart (D-94.1), held by `carts_completed_order_fk`.
    cart.completedOrderId = input.orderId;
    // Always null on an authenticated checkout today, but cleared for the edge
    // case where a customer checks out from an anon-derived cart that still
    // carries the token.
    cart.anonymousCartToken = null;
    await em.flush();
  }

  async findPriceDrift(
    em: EntityManager,
    input: { cartId: string; organizationId: string | null },
  ): Promise<CartLinePriceDrift[]> {
    const lines = await this.#currentPrices(em, input);
    return lines.filter((line) => line.differs).map((line) => line.drift);
  }

  async refreshLinePrices(input: { cartId: string; organizationId: string | null }): Promise<void> {
    // command-coverage-ignore: brings the stored prices of the buyer's own
    // ephemeral basket up to date after a placement refused them — derived
    // working state, the same class as the quantity change that re-prices a
    // line; no order exists and no domain decision is recorded.
    const em = this.emFactory();
    const lines = await this.#currentPrices(em, input);
    let changed = false;
    for (const { item, differs, drift } of lines) {
      if (!differs || drift.currentUnitPrice === null || drift.currentCurrency === null) continue;
      item.unitPrice = drift.currentUnitPrice;
      item.currency = drift.currentCurrency;
      item.priceSource = drift.currentPriceSource ?? null;
      changed = true;
    }
    if (changed) await em.flush();
  }

  async #currentPrices(
    em: EntityManager,
    input: { cartId: string; organizationId: string | null },
  ): Promise<Array<{ item: CartItem; differs: boolean; drift: CartLinePriceDrift }>> {
    const items = await em.find(CartItem, { cartId: input.cartId });
    if (items.length === 0) return [];
    // Priced on the basket's own channel, the one it was priced on when its
    // lines were added — never the system default (contracts/basket-attribution.md
    // §2). The basket is read on this `em`, so the answer describes the row
    // placement holds.
    const cart = await em.findOneOrFail(
      Cart,
      { id: input.cartId },
      { fields: ['id', 'salesChannelId', 'customerAccountId'] },
    );
    if (!cart.salesChannelId) {
      throw new Error(`[carts] cart ${input.cartId} records no sales channel to price it on.`);
    }
    // Placement is a signed-in buyer's, whoever places it.
    // D-287 P0 — the basket's customer, whose own group the lines were added
    // at; the drift check must price on it too or it would report drift on
    // every line of a customer with their own group.
    const ctx = await this.linePricing.contextFor(em, {
      organizationId: input.organizationId,
      signedIn: true,
      salesChannelId: cart.salesChannelId,
      customerAccountId: cart.customerAccountId ?? null,
    });
    const products = await this.catalogProducts.findByIds([
      ...new Set(items.map((it) => it.productId)),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    // D-287 P0 — every line in one batched resolution; it was one per line,
    // inside the placement transaction.
    const answers = await this.linePricing.orderablePrices(
      ctx,
      items.flatMap((item) => {
        const product = productById.get(item.productId);
        return product
          ? [
              {
                key: item.id,
                product,
                variantId: item.variantId ?? null,
                quantity: item.quantity,
                agreed: agreementOf(item),
              },
            ]
          : [];
      }),
    );
    const out: Array<{ item: CartItem; differs: boolean; drift: CartLinePriceDrift }> = [];
    for (const item of items) {
      const answer = answers.get(item.id) ?? null;
      const current = answer?.ok ? { unitPrice: answer.unitPrice, currency: answer.currency } : null;
      out.push({
        item,
        differs: storedPriceDiffers({ unitPrice: item.unitPrice, currency: item.currency }, current),
        drift: {
          cartItemId: item.id,
          productId: item.productId,
          variantId: item.variantId ?? null,
          quantity: item.quantity,
          storedUnitPrice: Number(item.unitPrice).toFixed(2),
          storedCurrency: item.currency,
          currentUnitPrice: current?.unitPrice ?? null,
          currentCurrency: current?.currency ?? null,
          currentPriceSource: answer?.ok ? answer.priceSource : null,
        },
      });
    }
    return out;
  }
}
