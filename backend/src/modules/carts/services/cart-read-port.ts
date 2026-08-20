import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CartCustomerContext,
  CartItemRecord,
  CartReadPort,
  CartRecord,
  CartSeedLine,
  CartWithItems,
  CartWritePort,
} from '@b2b/contracts';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import type { CartService } from './cart-service.js';

/**
 * The row-level read model `carts` publishes, and the seed operation that goes
 * with it (feature 075, Phase P).
 *
 * Six inbound sites are the same pair of queries — the customer's active cart,
 * then its items — written out in `orders`' checkout, `orders`' reorder and
 * `quote_requests`' quote-to-cart conversion. Two of those three then
 * `em.create(Cart, …)` when the lookup misses and hand-build `CartItem` rows,
 * which is two modules writing this module's two tables.
 *
 * `replaceItemsForCustomer` is what they call instead. The clear-then-seed
 * rule it implements is the single-active-cart model admin order-create,
 * reorder and RFQ conversion all already assume; it was spelled out twice, in
 * two modules, and `lastActivityAt` was maintained in neither.
 */
export class CartReadService implements CartReadPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findActiveForCustomer(ctx: CartCustomerContext): Promise<CartWithItems | null> {
    const em = this.emFactory();
    const cart = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      ...(ctx.organizationId === null ? {} : { organizationId: ctx.organizationId }),
      status: 'active',
    });
    if (!cart) return null;
    return { cart: toCartRecord(cart), items: await this.#items(em, cart.id) };
  }

  async findById(cartId: string): Promise<CartWithItems | null> {
    const em = this.emFactory();
    const cart = await em.findOne(Cart, { id: cartId });
    if (!cart) return null;
    return { cart: toCartRecord(cart), items: await this.#items(em, cart.id) };
  }

  async #items(em: EntityManager, cartId: string): Promise<CartItemRecord[]> {
    const items = await em.find(CartItem, { cartId }, { orderBy: { createdAt: 'asc', id: 'asc' } });
    return items.map(toCartItemRecord);
  }
}

/**
 * The write port, adapting `CartService` and adding the seed operation.
 *
 * The service arrives as a getter so the adapter resolves it from the
 * container per call rather than capturing it — it is this module's own gated
 * port, and a singleton may not hold a gate.
 */
export function createCartWritePort(
  emFactory: () => EntityManager,
  getService: () => CartService,
): CartWritePort {
  const read = new CartReadService(emFactory);

  return {
    async getOrCreateForCustomer(ctx) {
      return toCartRecord(await getService().getOrCreateForCustomer(ctx));
    },

    async addItem(actor, input) {
      const result = await getService().addItem(actor, input);
      return { cart: toCartRecord(result.cart), items: result.items.map(toCartItemRecord) };
    },

    clearForCustomer: (ctx) => getService().clearForCustomer(ctx),

    async replaceItemsForCustomer(ctx, lines): Promise<CartWithItems> {
      // command-coverage-ignore: seeds the customer's own active cart from an
      // already-audited source (a reorder, an accepted quote). The cart is not
      // an auditable domain object — the order or quote that produced these
      // lines is, and its own Command has already recorded the decision.
      const em = emFactory();
      const cart = await getService().getOrCreateForCustomer(ctx);
      const existing = await em.find(CartItem, { cartId: cart.id });
      if (existing.length > 0) em.remove(existing);
      for (const line of lines) {
        em.create(CartItem, {
          cartId: cart.id,
          productId: line.productId,
          ...(line.variantId ? { variantId: line.variantId } : {}),
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          currency: line.currency,
        });
      }
      cart.lastActivityAt = new Date();
      await em.flush();

      const seeded = await read.findById(cart.id);
      // The cart was created or loaded one statement ago in this same
      // `EntityManager`, so a miss here is not a race — it is impossible, and
      // an empty answer would be worse than a throw because the caller is
      // about to place an order from it.
      if (!seeded) {
        throw new Error(`[carts] cart ${cart.id} vanished between seeding and reading it back.`);
      }
      return seeded;
    },
  };
}

export function toCartRecord(cart: Cart): CartRecord {
  return {
    id: cart.id,
    customerAccountId: cart.customerAccountId ?? null,
    organizationId: cart.organizationId ?? null,
    anonymousCartToken: cart.anonymousCartToken ?? null,
    salesChannelId: cart.salesChannelId ?? null,
    status: cart.status,
    approvalStatus: cart.approvalStatus,
    submittedForApprovalAt: cart.submittedForApprovalAt ?? null,
    approvedAt: cart.approvedAt ?? null,
    approvedByCustomerAccountId: cart.approvedByCustomerAccountId ?? null,
    rejectedAt: cart.rejectedAt ?? null,
    rejectedByActor: cart.rejectedByActor ?? null,
    rejectedReason: cart.rejectedReason ?? null,
    appliedPromotionCode: cart.appliedPromotionCode ?? null,
    convertedToQuoteRequestId: cart.convertedToQuoteRequestId ?? null,
    abandonmentNotifiedAt: cart.abandonmentNotifiedAt ?? null,
    lastActivityAt: cart.lastActivityAt,
    version: cart.version,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}

export function toCartItemRecord(item: CartItem): CartItemRecord {
  return {
    id: item.id,
    cartId: item.cartId,
    productId: item.productId,
    variantId: item.variantId ?? null,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    currency: item.currency,
    recomputedUnitPrice: item.recomputedUnitPrice ?? null,
    recomputedAt: item.recomputedAt ?? null,
    recomputedCurrency: item.recomputedCurrency ?? null,
    packagingUnitId: item.packagingUnitId ?? null,
    packagingUnitName: item.packagingUnitName ?? null,
    packagingUnitBaseQuantity: item.packagingUnitBaseQuantity ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** Kept beside the mapper so `CartSeedLine`'s shape is checked where it is used. */
export type { CartSeedLine };
