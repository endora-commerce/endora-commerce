import type { EntityManager } from '@mikro-orm/postgresql';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';

/**
 * CartQueryService — read-only cart lookups by customer (feature 040, US5 /
 * FR-030/FR-031). Surfaces the customer's current (active) cart and their
 * abandoned carts for the admin customer-detail panels.
 */
export interface CartItemView {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: string;
  currency: string;
}

export interface CartView {
  id: string;
  status: string;
  lastActivityAt: string | null;
  items: CartItemView[];
}

export interface CustomerCartsView {
  current: CartView | null;
  abandoned: CartView[];
}

export class CartQueryService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async listForCustomer(customerAccountId: string): Promise<CustomerCartsView> {
    const em = this.emFactory();
    const carts = await em.find(
      Cart,
      { customerAccountId },
      { orderBy: { lastActivityAt: 'desc' } },
    );
    if (carts.length === 0) return { current: null, abandoned: [] };

    const items = await em.find(CartItem, { cartId: { $in: carts.map((c) => c.id) } });
    const byCart = new Map<string, CartItemView[]>();
    for (const it of items) {
      const list = byCart.get(it.cartId) ?? [];
      list.push({
        productId: it.productId,
        variantId: it.variantId ?? null,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        currency: it.currency,
      });
      byCart.set(it.cartId, list);
    }

    const toView = (c: Cart): CartView => ({
      id: c.id,
      status: c.status,
      lastActivityAt: c.lastActivityAt ? c.lastActivityAt.toISOString() : null,
      items: byCart.get(c.id) ?? [],
    });

    const current = carts.find((c) => c.status === 'active') ?? null;
    const abandoned = carts.filter((c) => c.status === 'abandoned');
    return {
      current: current ? toView(current) : null,
      abandoned: abandoned.map(toView),
    };
  }
}
