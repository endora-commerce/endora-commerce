import type { FastifyInstance, FastifyRequest } from 'fastify';
import { addCartItemRequestSchema, updateCartItemRequestSchema, ERROR_CODES } from '@b2b/contracts';
import type { CartService } from './services/cart-service.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Cart } from './entities/cart.entity.js';
import type { CartItem } from './entities/cart-item.entity.js';
import { OrganizationCannotTransactError } from '../organizations/services/organization-context-service.js';
import { HttpError } from '../../http/error-envelope.js';

const ANON_COOKIE = 'b2b_cart_anon';

export interface CartsDeps {
  cartService: CartService;
  resolveCartActor: (request: FastifyRequest) => {
    customer?: { customerAccountId: string; organizationId: string | null };
    anonymousToken?: string;
  };
  emFactory: () => EntityManager;
  /**
   * Optional gate — when provided, signed-in customers whose Organization
   * is not `active` (pending_verification / blocked / rejected) cannot add
   * lines to the cart. Anonymous users are always permitted.
   *
   * Feature 026 (US1 / US3). Throws OrganizationCannotTransactError, which
   * the route translates to HTTP 423 with a localized body.
   */
  assertOrganizationCanTransact?: (organizationId: string) => Promise<void>;
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
  const { assertOrganizationCanTransact } = deps;

  /**
   * Refuses to mutate a cart when the signed-in Customer's Organization is
   * not active. Anonymous carts are always permitted (no Organization is
   * attached to them).
   */
  const guardOrganizationTransact = async (actor: {
    customer?: { customerAccountId: string; organizationId: string | null };
  }): Promise<void> => {
    if (!assertOrganizationCanTransact) return;
    if (!actor.customer) return;
    // No-org Customer accounts (feature 026 US2) bypass the gate — they
    // already use platform defaults and have no Organization status to fail
    // against. Cart-add stays open.
    if (!actor.customer.organizationId) return;
    try {
      await assertOrganizationCanTransact(actor.customer.organizationId);
    } catch (err) {
      if (err instanceof OrganizationCannotTransactError) {
        throw new HttpError(
          423,
          ERROR_CODES.FORBIDDEN,
          'Your Organization cannot transact in its current status.',
          { code: 'organization_cannot_transact', status: err.status },
        );
      }
      throw err;
    }
  };

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
      await guardOrganizationTransact(actor);
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
