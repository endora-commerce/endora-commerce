import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import type { PricingService } from '../../price_lists/services/pricing-service.js';

/**
 * CartService (T125).
 *
 * Two cart shapes:
 *   - Anonymous: identified by a caller-held cookie token. No customer or
 *     organization attached.
 *   - Authenticated: the customer's single active cart.
 *
 * At login, the existing anonymous cart (if any) is merged into the
 * authenticated cart — duplicate lines have their quantities summed.
 */

export interface AnonymousContext {
  anonymousCartToken: string;
}

export interface CustomerContext {
  customerAccountId: string;
  /**
   * Feature 026 US2 — null for guest-style Customer accounts that have no
   * Organization. Carts already persist `organization_id` nullable, so the
   * service handles either case (no-org carts fall back to platform-default
   * prices via PricingService).
   */
  organizationId: string | null;
}

export class CartService {
  /**
   * `pricingService` is optional so test rigs that don't wire the
   * full pricing module still construct the service. Production
   * composition (composition.ts) supplies it; when absent the cart
   * silently falls back to the legacy `attributeValues['defaultPrice']`
   * read so the foundation flow stays intact.
   *
   * Cart entities don't currently track which sales channel they were
   * created on (multi-channel cart attribution is a separate
   * follow-up), so the resolver runs against the system-default
   * channel — matching the behaviour the foundation cart already had.
   * Lists with a `salesChannel` criterion targeting other channels
   * therefore won't apply on the cart line until cart-side channel
   * tracking lands.
   */
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly pricingService?: PricingService,
  ) {}

  async getOrCreateForCustomer(ctx: CustomerContext): Promise<Cart> {
    const em = this.emFactory();
    return this.#getOrCreateForCustomerOn(em, ctx);
  }

  async #getOrCreateForCustomerOn(em: EntityManager, ctx: CustomerContext): Promise<Cart> {
    let cart = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      status: 'active',
    });
    if (!cart) {
      cart = em.create(Cart, {
        customerAccountId: ctx.customerAccountId,
        organizationId: ctx.organizationId,
        status: 'active',
      });
      await em.persistAndFlush(cart);
    }
    return cart;
  }

  async getOrCreateForAnon(em: EntityManager, token: string): Promise<Cart> {
    let cart = await em.findOne(Cart, { anonymousCartToken: token, status: 'active' });
    if (!cart) {
      cart = em.create(Cart, {
        anonymousCartToken: token,
        status: 'active',
      });
      await em.persistAndFlush(cart);
    }
    return cart;
  }

  async getItems(cartId: string): Promise<CartItem[]> {
    const em = this.emFactory();
    return em.find(CartItem, { cartId });
  }

  async addItem(
    actor: { customer?: CustomerContext; anonymousToken?: string },
    input: { productId: string; variantId?: string; quantity: number },
  ): Promise<{ cart: Cart; items: CartItem[] }> {
    const em = this.emFactory();
    const cart = actor.customer
      ? await this.#getOrCreateForCustomerOn(em, actor.customer)
      : actor.anonymousToken
        ? await this.getOrCreateForAnon(em, actor.anonymousToken)
        : (() => {
            throw new HttpError(
              401,
              ERROR_CODES.UNAUTHORIZED,
              'Cart requires either a customer session or an anonymous cart token.',
            );
          })();

    if (input.quantity <= 0) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Quantity must be > 0.');
    }
    const product = await em.findOne(Product, { id: input.productId });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    // If the same product+variant is already in the cart, bump quantity.
    const existing = await em.findOne(CartItem, {
      cartId: cart.id,
      productId: product.id,
      variantId: input.variantId ?? null,
    });
    if (existing) {
      existing.quantity += input.quantity;
      await em.flush();
    } else {
      const resolved = await this.#resolveLineUnitPrice(em, {
        product,
        organizationId: actor.customer?.organizationId ?? null,
        quantity: input.quantity,
        variantId: input.variantId ?? null,
      });
      // T084 — defence-in-depth: refuse the line when the resolver says
      // this product is quote-only for the (org, channel) tuple.
      if (resolved && resolved.displayMode === 'none') {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'product_quote_only',
        );
      }
      const item = em.create(CartItem, {
        cartId: cart.id,
        productId: product.id,
        ...(input.variantId ? { variantId: input.variantId } : {}),
        quantity: input.quantity,
        unitPrice: resolved
          ? Number(resolved.amount).toFixed(2)
          : (Number(
              product.attributeValues['defaultPrice'] ??
                product.attributeValues['price'] ??
                0,
            )).toFixed(2),
        currency: resolved?.currency ?? 'PLN',
      });
      await em.persistAndFlush(item);
    }

    const items = await em.find(CartItem, { cartId: cart.id });
    return { cart, items };
  }

  /**
   * Look up the line's unit price via the resolver when the pricing
   * service is wired (production); fall back to `null` so the legacy
   * read path runs (foundation tests). Returns `null` on any resolver
   * failure to match the foundation flow's "never block on price
   * resolution" semantics.
   */
  async #resolveLineUnitPrice(
    em: EntityManager,
    input: {
      product: Product;
      organizationId: string | null;
      quantity: number;
      variantId: string | null;
    },
  ): Promise<{
    amount: string;
    currency: string;
    priceListId: string;
    displayMode: import('@b2b/contracts').DisplayMode;
  } | null> {
    if (!this.pricingService) return null;
    try {
      const channel = await em.findOne(SalesChannel, { systemDefault: true });
      if (!channel) return null;
      const organization = input.organizationId
        ? await em.findOne(Organization, { id: input.organizationId })
        : null;
      const resolved = await this.pricingService.resolveLinePrice({
        product: input.product,
        variantId: input.variantId,
        context: {
          quantity: input.quantity,
          ...(organization ? { organization } : {}),
          salesChannel: channel,
        },
      });
      if (!resolved) return null;
      return {
        amount: resolved.amount,
        currency: resolved.currency,
        priceListId: resolved.priceListId,
        displayMode: resolved.displayMode,
      };
    } catch {
      return null;
    }
  }

  async updateItem(
    actor: { customer?: CustomerContext; anonymousToken?: string },
    itemId: string,
    quantity: number,
  ): Promise<{ cart: Cart; items: CartItem[] }> {
    const em = this.emFactory();
    const item = await em.findOne(CartItem, { id: itemId });
    if (!item) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart item not found.');
    const cart = await em.findOne(Cart, { id: item.cartId });
    if (!cart) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart not found.');
    this.#assertOwnership(cart, actor);

    if (quantity <= 0) {
      await em.removeAndFlush(item);
    } else {
      item.quantity = quantity;
      await em.flush();
    }
    const items = await em.find(CartItem, { cartId: cart.id });
    return { cart, items };
  }

  async removeItem(
    actor: { customer?: CustomerContext; anonymousToken?: string },
    itemId: string,
  ): Promise<{ cart: Cart; items: CartItem[] }> {
    const em = this.emFactory();
    const item = await em.findOne(CartItem, { id: itemId });
    if (!item) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart item not found.');
    const cart = await em.findOne(Cart, { id: item.cartId });
    if (!cart) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart not found.');
    this.#assertOwnership(cart, actor);
    await em.removeAndFlush(item);
    const items = await em.find(CartItem, { cartId: cart.id });
    return { cart, items };
  }

  /** Merge anonymous cart items into the customer's cart at login time. */
  async mergeAnonymousIntoCustomer(anonymousToken: string, ctx: CustomerContext): Promise<void> {
    const em = this.emFactory();
    const anon = await em.findOne(Cart, { anonymousCartToken: anonymousToken, status: 'active' });
    if (!anon) return;
    const customerCart = await this.#getOrCreateForCustomerOn(em, ctx);

    const anonItems = await em.find(CartItem, { cartId: anon.id });
    for (const item of anonItems) {
      const existing = await em.findOne(CartItem, {
        cartId: customerCart.id,
        productId: item.productId,
        variantId: item.variantId ?? null,
      });
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        item.cartId = customerCart.id;
      }
    }
    // Merge complete — mark the source anonymous cart as `completed` (it
    // produced a target authenticated cart; treating it as `abandoned`
    // would falsely flag it for the abandonment-notification sweep when
    // a non-empty merge actually took place). See feature 027 §R10.
    anon.status = 'completed';
    anon.anonymousCartToken = null;
    await em.flush();
  }

  async clearForCustomer(ctx: CustomerContext): Promise<void> {
    const em = this.emFactory();
    const cart = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      status: 'active',
    });
    if (!cart) return;
    await em.nativeDelete(CartItem, { cartId: cart.id });
    cart.status = 'completed';
    await em.flush();
  }

  #assertOwnership(
    cart: Cart,
    actor: { customer?: CustomerContext; anonymousToken?: string },
  ): void {
    if (actor.customer && cart.customerAccountId === actor.customer.customerAccountId) return;
    if (actor.anonymousToken && cart.anonymousCartToken === actor.anonymousToken) return;
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart not found.');
  }
}
