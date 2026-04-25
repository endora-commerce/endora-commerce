import type { FastifyInstance, FastifyRequest } from 'fastify';
import { addCartItemRequestSchema, updateCartItemRequestSchema } from '@b2b/contracts';
import type { CartService } from './services/cart-service.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Cart } from './entities/cart.entity.js';
import type { CartItem } from './entities/cart-item.entity.js';

const ANON_COOKIE = 'b2b_cart_anon';

export interface CartsDeps {
  cartService: CartService;
  resolveCartActor: (request: FastifyRequest) => {
    customer?: { customerAccountId: string; organizationId: string };
    anonymousToken?: string;
  };
  emFactory: () => EntityManager;
}

/**
 * Cart routes — open to anonymous users too. The resolver picks the right
 * cart based on (authenticated session, anonymous cookie, neither).
 *
 * Anonymous callers receive a Set-Cookie for `b2b_cart_anon` on first add so
 * later requests target the same cart.
 */
export async function registerCartRoutes(app: FastifyInstance, deps: CartsDeps): Promise<void> {
  const { cartService, resolveCartActor, emFactory } = deps;

  app.get('/api/v1/cart', async (request) => {
    const actor = resolveCartActor(request);
    const em = emFactory();
    let cart: Cart | null = null;
    if (actor.customer) {
      cart = await cartService.getOrCreateForCustomer(actor.customer);
    } else if (actor.anonymousToken) {
      cart = await cartService.getOrCreateForAnon(em, actor.anonymousToken);
    } else {
      return { data: emptyCart() };
    }
    const items = await cartService.getItems(cart.id);
    return { data: serializeCart(cart, items) };
  });

  app.post(
    '/api/v1/cart/items',
    { schema: { body: addCartItemRequestSchema } },
    async (request, reply) => {
      let actor = resolveCartActor(request);
      // If neither side identified, mint an anonymous token and echo it back.
      if (!actor.customer && !actor.anonymousToken) {
        const token = `anon-${crypto.randomUUID()}`;
        reply.setCookie(ANON_COOKIE, token, { path: '/', sameSite: 'lax', httpOnly: true });
        actor = { anonymousToken: token };
      }
      const body = addCartItemRequestSchema.parse(request.body);
      const result = await cartService.addItem(actor, {
        productId: body.productId,
        ...(body.variantId ? { variantId: body.variantId } : {}),
        quantity: body.quantity,
      });
      return { data: serializeCart(result.cart, result.items) };
    },
  );

  app.patch<{ Params: { itemId: string } }>(
    '/api/v1/cart/items/:itemId',
    { schema: { body: updateCartItemRequestSchema } },
    async (request) => {
      const actor = resolveCartActor(request);
      const body = updateCartItemRequestSchema.parse(request.body);
      const result = await cartService.updateItem(actor, request.params.itemId, body.quantity);
      return { data: serializeCart(result.cart, result.items) };
    },
  );

  app.delete<{ Params: { itemId: string } }>(
    '/api/v1/cart/items/:itemId',
    async (request) => {
      const actor = resolveCartActor(request);
      const result = await cartService.removeItem(actor, request.params.itemId);
      return { data: serializeCart(result.cart, result.items) };
    },
  );
}

function emptyCart() {
  return {
    id: null,
    customerAccountId: null,
    organizationId: null,
    anonymousCartToken: null,
    items: [],
    itemCount: 0,
    subtotal: { amount: 0, currency: 'PLN' },
  };
}

function serializeCart(cart: Cart, items: CartItem[]) {
  const subtotal = items.reduce((acc, it) => acc + Number(it.unitPrice) * it.quantity, 0);
  const currency = items[0]?.currency ?? 'PLN';
  return {
    id: cart.id,
    customerAccountId: cart.customerAccountId ?? null,
    organizationId: cart.organizationId ?? null,
    anonymousCartToken: cart.anonymousCartToken ?? null,
    items: items.map((it) => ({
      id: it.id,
      productId: it.productId,
      variantId: it.variantId ?? null,
      quantity: it.quantity,
      unitPrice: { amount: Number(it.unitPrice), currency: it.currency },
    })),
    itemCount: items.length,
    subtotal: { amount: subtotal, currency },
    createdAt: cart.createdAt.toISOString(),
    updatedAt: cart.updatedAt.toISOString(),
  };
}

declare const crypto: { randomUUID: () => string };
