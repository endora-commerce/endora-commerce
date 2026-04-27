import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';

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
  organizationId: string;
}

export class CartService {
  constructor(private readonly emFactory: () => EntityManager) {}

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
      const unitPrice = Number(
        product.attributeValues['defaultPrice'] ?? product.attributeValues['price'] ?? 0,
      );
      const item = em.create(CartItem, {
        cartId: cart.id,
        productId: product.id,
        ...(input.variantId ? { variantId: input.variantId } : {}),
        quantity: input.quantity,
        unitPrice: unitPrice.toFixed(2),
        currency: 'PLN',
      });
      await em.persistAndFlush(item);
    }

    const items = await em.find(CartItem, { cartId: cart.id });
    return { cart, items };
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
    anon.status = 'abandoned';
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
    cart.status = 'converted';
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
