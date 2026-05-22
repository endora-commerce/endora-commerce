import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  addCartItemRequestSchema,
  updateCartItemRequestSchema,
  saveCartItemToListSchema,
  cartUpsellsQuerySchema,
  applyCartCouponSchema,
  convertCartToQrSchema,
  ERROR_CODES,
} from '@b2b/contracts';
import type { CartService } from './services/cart-service.js';
import type { CartUpsellService } from './services/cart-upsell-service.js';
import type { CartCouponService } from './services/cart-coupon-service.js';
import type { CartConversionService } from './services/cart-conversion-service.js';
import type { CartPricingRecompute } from './services/cart-pricing-recompute.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Cart } from './entities/cart.entity.js';
import type { CartItem } from './entities/cart-item.entity.js';
import { OrganizationCannotTransactError } from '../organizations/services/organization-context-service.js';
import { HttpError } from '../../http/error-envelope.js';

const ANON_COOKIE = 'b2b_cart_anon';

export interface CartsDeps {
  cartService: CartService;
  /**
   * Feature 027 — Up-sell aggregator. Optional so legacy compositions
   * that haven't yet wired the new service still build successfully;
   * production composition (commerceModule) provides it.
   */
  cartUpsellService?: CartUpsellService;
  /**
   * Feature 027 — pushes a cart line into the buyer's named Purchase
   * List. Cross-module call to ShoppingListService.addItem; optional
   * for the same reason as above.
   */
  pushLineToShoppingList?: (input: {
    customerAccountId: string;
    organizationId: string | null;
    shoppingListId: string;
    productId: string;
    variantId: string | null;
    quantity: number;
  }) => Promise<void>;
  /**
   * Feature 027 US2 — coupon application service. Optional so legacy
   * compositions still build; production wires it. Also drives the
   * `reevaluateOnRead` auto-drop in the GET handler when a previously-
   * applied code no longer fits the cart.
   */
  cartCouponService?: CartCouponService;
  /**
   * Feature 027 US3 — three conversions (Cart→QR, QR→Cart, ShoppingList→Cart).
   * Optional so legacy compositions still build.
   */
  cartConversionService?: CartConversionService;
  /**
   * Feature 027 §R5 — re-pricing on read. When wired, every full-cart
   * read calls the helper to refresh `cart_items.unit_price` from the
   * customer's currently resolved price list (Redis-cached for 30 s).
   * The response uses the recomputed prices; the snapshotted column is
   * kept for audit / diff.
   */
  cartPricingRecompute?: CartPricingRecompute;
  /**
   * Feature 027 US3 — ShoppingListService.convertToCart bridge for the
   * `POST /api/v1/cart/from-shopping-list/:listId` endpoint. Returns the
   * cart-side append result.
   */
  appendShoppingListToCart?: (input: {
    customerAccountId: string;
    organizationId: string | null;
    shoppingListId: string;
  }) => Promise<{
    cartId: string;
    appendedLineCount: number;
    droppedLines: Array<{ productId: string; productName: string; reason: string }>;
  }>;
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

  app.get<{ Querystring: { view?: string } }>('/api/v1/cart', async (request) => {
    const actor = resolveCartActor(request);
    const em = emFactory();
    let cart: Cart | null = null;
    if (actor.customer) {
      cart = await cartService.getOrCreateForCustomer(actor.customer);
    } else if (actor.anonymousToken) {
      cart = await cartService.getOrCreateForAnon(em, actor.anonymousToken);
    } else {
      return request.query?.view === 'mini'
        ? { data: emptyMiniCart() }
        : { data: emptyCart() };
    }
    const items = await cartService.getItems(cart.id);

    // Feature 027 FR-007 — mini-cart payload. Skips re-pricing-on-read,
    // skips coupon re-evaluation, and emits the lightweight serializer
    // (no per-line `unavailable*`, no `droppedLines`, no
    // `couponDroppedThisRead`). The mini endpoint is on the storefront's
    // hot path (every header render) so the heavy work is intentionally
    // deferred to the full view.
    if (request.query?.view === 'mini') {
      return { data: serializeCartMini(cart, items) };
    }

    // Feature 027 §R5 — re-pricing on read (FR-008).
    let recomputedPrices: Map<string, { amount: number; currency: string }> | null = null;
    if (deps.cartPricingRecompute && items.length > 0) {
      try {
        const lines = items.map((it) => ({
          cartItemId: it.id,
          productId: it.productId,
          variantId: it.variantId ?? null,
          quantity: it.quantity,
        }));
        const resolved = await deps.cartPricingRecompute.recompute(
          {
            cartId: cart.id,
            organizationId: cart.organizationId ?? null,
            salesChannelId: cart.salesChannelId ?? null,
          },
          lines,
        );
        recomputedPrices = new Map(
          resolved
            .filter((r) => r.amount !== null)
            .map((r) => [r.cartItemId, { amount: r.amount as number, currency: r.currency }]),
        );
      } catch {
        // Never block a cart read on a resolver hiccup; fall back to the
        // snapshotted unit price.
        recomputedPrices = null;
      }
    }

    // Feature 027 US2 / FR-014 — re-evaluate the applied coupon on every
    // read. If a previously-valid code is no longer eligible (e.g. the
    // cart fell below min spend after a line removal), drop it silently
    // on the cart record and surface `couponDroppedThisRead` so the
    // storefront banner can inform the buyer.
    let couponDroppedThisRead: { code: string; reason: string } | null = null;
    if (deps.cartCouponService && cart.appliedPromotionCode && items.length > 0) {
      try {
        const result = await deps.cartCouponService.reevaluateOnRead(cart, items);
        if (result.dropped) {
          couponDroppedThisRead = result.dropped;
        }
      } catch {
        // Never block a cart read on a coupon-engine hiccup.
        couponDroppedThisRead = null;
      }
    }
    return { data: serializeCart(cart, items, recomputedPrices, couponDroppedThisRead) };
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

  // ── Feature 027 — new endpoints (touch / save-to-shopping-list / upsells)

  /**
   * Explicit "buyer opened the cart page" ping. Bumps last_activity_at;
   * reactivates an abandoned cart back to active. No-op on missing cart
   * (no error — the storefront calls this on every cart-page mount).
   */
  app.post('/api/v1/cart/touch', async (request, reply) => {
    const actor = resolveCartActor(request);
    if (!actor.customer && !actor.anonymousToken) {
      reply.code(204);
      return null;
    }
    await cartService.touch(actor);
    reply.code(204);
    return null;
  });

  /**
   * Push one cart line into the named Purchase List. Cross-module call
   * goes through the optional `pushLineToShoppingList` port; if not
   * wired, the route returns HTTP 503 so the storefront surfaces the
   * "feature unavailable" message instead of silently dropping.
   */
  app.post<{ Params: { itemId: string } }>(
    '/api/v1/cart/items/:itemId/save-to-shopping-list',
    { schema: { body: saveCartItemToListSchema } },
    async (request, reply) => {
      const actor = resolveCartActor(request);
      if (!actor.customer) {
        throw new HttpError(
          401,
          ERROR_CODES.UNAUTHORIZED,
          'Sign-in required to save to a shopping list.',
        );
      }
      if (!deps.pushLineToShoppingList) {
        throw new HttpError(
          503,
          ERROR_CODES.NOT_FOUND,
          'shopping_lists_unavailable',
        );
      }
      const body = saveCartItemToListSchema.parse(request.body);
      const item = await emFactory().findOne(
        (await import('./entities/cart-item.entity.js')).CartItem,
        { id: request.params.itemId },
      );
      if (!item) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart item not found.');
      }
      // Ownership: only the cart's owner may save its line.
      const cart = await emFactory().findOne(
        (await import('./entities/cart.entity.js')).Cart,
        { id: item.cartId },
      );
      if (!cart || cart.customerAccountId !== actor.customer.customerAccountId) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Cart item not found.');
      }
      await deps.pushLineToShoppingList({
        customerAccountId: actor.customer.customerAccountId,
        organizationId: actor.customer.organizationId,
        shoppingListId: body.shoppingListId,
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
      });
      reply.code(204);
      return null;
    },
  );

  /**
   * Apply (or replace, or clear) the active coupon code on the cart.
   * Returns the recomputed full cart on success; HTTP 422 with a
   * reason-specific body on rejection.
   */
  app.post(
    '/api/v1/cart/coupon',
    { schema: { body: applyCartCouponSchema } },
    async (request) => {
      const actor = resolveCartActor(request);
      const em = emFactory();
      let cart: Cart | null = null;
      if (actor.customer) {
        cart = await cartService.getOrCreateForCustomer(actor.customer);
      } else if (actor.anonymousToken) {
        cart = await cartService.getOrCreateForAnon(em, actor.anonymousToken);
      } else {
        throw new HttpError(
          401,
          ERROR_CODES.UNAUTHORIZED,
          'Cart not found.',
        );
      }
      const items = await cartService.getItems(cart.id);
      if (items.length === 0) {
        throw new HttpError(422, ERROR_CODES.CART_EMPTY, 'cart_empty');
      }
      if (!deps.cartCouponService) {
        throw new HttpError(503, ERROR_CODES.NOT_FOUND, 'promotions_unavailable');
      }
      const body = applyCartCouponSchema.parse(request.body);
      const result = await deps.cartCouponService.apply(cart, body.code);
      if (result.outcome === 'dropped') {
        const detailsBody: Record<string, unknown> = { reason: result.reason };
        if ('shortfall' in result && result.shortfall) {
          detailsBody['shortfall'] = result.shortfall;
        }
        throw new HttpError(
          422,
          ERROR_CODES.CART_COUPON_REJECTED,
          'CART_COUPON_REJECTED',
          detailsBody,
        );
      }
      const freshItems = await cartService.getItems(cart.id);
      return { data: serializeCart(cart, freshItems) };
    },
  );

  /**
   * Convenience alias for `POST /api/v1/cart/coupon` with `code=null`.
   */
  app.delete('/api/v1/cart/coupon', async (request) => {
    const actor = resolveCartActor(request);
    const em = emFactory();
    let cart: Cart | null = null;
    if (actor.customer) {
      cart = await cartService.getOrCreateForCustomer(actor.customer);
    } else if (actor.anonymousToken) {
      cart = await cartService.getOrCreateForAnon(em, actor.anonymousToken);
    } else {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Cart not found.');
    }
    if (deps.cartCouponService) {
      await deps.cartCouponService.clear(cart);
    }
    const items = await cartService.getItems(cart.id);
    return { data: serializeCart(cart, items) };
  });

  // ── Feature 027 US3 — three conversions

  /**
   * Cart → Quote Request. Refuses on an empty cart or unauthenticated
   * caller. Source cart flips to `completed` with
   * `converted_to_quote_request_id` set.
   */
  app.post(
    '/api/v1/cart/convert-to-quote-request',
    { schema: { body: convertCartToQrSchema } },
    async (request) => {
      const actor = resolveCartActor(request);
      if (!actor.customer) {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Sign-in required.');
      }
      if (!deps.cartConversionService) {
        throw new HttpError(503, ERROR_CODES.NOT_FOUND, 'quote_requests_unavailable');
      }
      if (!actor.customer.organizationId) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'organization_required_for_quote_request',
        );
      }
      const cart = await cartService.getOrCreateForCustomer(actor.customer);
      const body = convertCartToQrSchema.parse(request.body ?? {});
      const result = await deps.cartConversionService.convertToQuoteRequest(
        cart,
        {
          customerAccountId: actor.customer.customerAccountId,
          organizationId: actor.customer.organizationId,
          isOrgAdmin: false,
        },
        body.note,
      );
      return {
        data: {
          quoteRequestId: result.quoteRequestId,
          cartId: result.cartId,
          quoteRequestSlug: result.quoteRequestId,
        },
      };
    },
  );

  /**
   * Quote Request → Cart. Re-prices from the customer's current list;
   * unavailable / no-price lines are dropped and returned to the
   * caller.
   */
  app.post<{ Params: { quoteRequestId: string } }>(
    '/api/v1/cart/from-quote-request/:quoteRequestId',
    async (request) => {
      const actor = resolveCartActor(request);
      if (!actor.customer) {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Sign-in required.');
      }
      if (!deps.cartConversionService) {
        throw new HttpError(503, ERROR_CODES.NOT_FOUND, 'quote_requests_unavailable');
      }
      const result = await deps.cartConversionService.createCartFromQuoteRequest(
        request.params.quoteRequestId,
        actor.customer,
      );
      return { data: result };
    },
  );

  /**
   * Shopping List → Cart. Delegates to ShoppingListService.convertToCart
   * through the `appendShoppingListToCart` port. Composition wires that
   * port at boot time.
   */
  app.post<{ Params: { shoppingListId: string } }>(
    '/api/v1/cart/from-shopping-list/:shoppingListId',
    async (request) => {
      const actor = resolveCartActor(request);
      if (!actor.customer) {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Sign-in required.');
      }
      if (!deps.appendShoppingListToCart) {
        throw new HttpError(503, ERROR_CODES.NOT_FOUND, 'shopping_lists_unavailable');
      }
      const result = await deps.appendShoppingListToCart({
        customerAccountId: actor.customer.customerAccountId,
        organizationId: actor.customer.organizationId,
        shoppingListId: request.params.shoppingListId,
      });
      return { data: result };
    },
  );

  /**
   * Up-sell strip for the full cart view. Aggregator over Catalog's
   * `product_links` (kind = 'up_sell'); excludes products already in
   * the cart; ranks by match-count desc, tie-break oldest-first.
   */
  app.get('/api/v1/cart/upsells', async (request) => {
    if (!deps.cartUpsellService) {
      return { data: [] };
    }
    const actor = resolveCartActor(request);
    const em = emFactory();
    let cart: Cart | null = null;
    if (actor.customer) {
      cart = await cartService.getOrCreateForCustomer(actor.customer);
    } else if (actor.anonymousToken) {
      cart = await cartService.getOrCreateForAnon(em, actor.anonymousToken);
    }
    if (!cart) return { data: [] };
    const parsed = cartUpsellsQuerySchema.parse(request.query ?? {});
    const limit = parsed.limit ?? 12;
    const candidates = await deps.cartUpsellService.forCart(cart.id, limit);
    return { data: candidates };
  });
}

function emptyCart() {
  return {
    id: null,
    customerAccountId: null,
    organizationId: null,
    salesChannelId: null,
    anonymousCartToken: null,
    status: 'active' as const,
    approvalStatus: 'not_required' as const,
    items: [],
    itemCount: 0,
    subtotal: { amount: 0, currency: 'PLN' },
    discount: null,
    grandTotal: { amount: 0, currency: 'PLN' },
    primaryCta: 'checkout' as const,
    droppedLines: [],
    couponDroppedThisRead: null,
    createdAt: null,
    updatedAt: null,
    lastActivityAt: null,
  };
}

function emptyMiniCart() {
  return {
    id: null,
    itemCount: 0,
    items: [] as Array<{
      id: string;
      productId: string;
      variantId: string | null;
      quantity: number;
      unitPrice: { amount: number; currency: string };
      lineTotal: { amount: number; currency: string };
    }>,
    subtotal: { amount: 0, currency: 'PLN' },
  };
}

/**
 * Mini-cart payload (Feature 027 FR-007). Strips the heavy parts of the
 * full view: no re-pricing-on-read, no coupon re-evaluation, no per-line
 * `unavailable*`, no `droppedLines`, no `couponDroppedThisRead`, no
 * `primaryCta`. The header renders this on every page navigation so the
 * envelope is intentionally minimal.
 */
function serializeCartMini(cart: Cart, items: CartItem[]) {
  let subtotal = 0;
  const currency = items[0]?.currency ?? 'PLN';
  const serializedItems = items.map((it) => {
    const unitPriceAmount = Number(it.unitPrice);
    subtotal += unitPriceAmount * it.quantity;
    return {
      id: it.id,
      productId: it.productId,
      variantId: it.variantId ?? null,
      quantity: it.quantity,
      unitPrice: { amount: unitPriceAmount, currency: it.currency },
      lineTotal: { amount: unitPriceAmount * it.quantity, currency: it.currency },
    };
  });
  return {
    id: cart.id,
    itemCount: items.length,
    items: serializedItems,
    subtotal: { amount: subtotal, currency },
  };
}

/**
 * Builds the cart-view response payload. Backward-compatible: the
 * foundation fields (`id`, `customerAccountId`, `organizationId`,
 * `anonymousCartToken`, `items` with `unitPrice`, `itemCount`, `subtotal`,
 * `createdAt`, `updatedAt`) are preserved verbatim so the existing
 * storefront keeps building.
 *
 * Feature 027 fields are additive: `salesChannelId`, `status`,
 * `approvalStatus`, `discount`, `grandTotal`, `primaryCta`,
 * `droppedLines`, `couponDroppedThisRead`, `lastActivityAt`, and per-line
 * `lineTotal`. Re-pricing-on-read is a follow-up — the snapshotted
 * `unitPrice` on `cart_items` is returned as the current price for now;
 * the CartPricingRecompute helper (foundation T014) will be wired into
 * this serializer when the read path lands.
 */
function serializeCart(
  cart: Cart,
  items: CartItem[],
  recomputedPrices: Map<string, { amount: number; currency: string }> | null = null,
  couponDroppedThisRead: { code: string; reason: string } | null = null,
) {
  let subtotal = 0;
  let currency = items[0]?.currency ?? 'PLN';
  const serializedItems = items.map((it) => {
    const recomputed = recomputedPrices?.get(it.id);
    const unitPriceAmount = recomputed ? recomputed.amount : Number(it.unitPrice);
    const lineCurrency = recomputed ? recomputed.currency : it.currency;
    if (currency === 'PLN' && lineCurrency !== 'PLN') currency = lineCurrency;
    subtotal += unitPriceAmount * it.quantity;
    return {
      id: it.id,
      productId: it.productId,
      variantId: it.variantId ?? null,
      quantity: it.quantity,
      unitPrice: { amount: unitPriceAmount, currency: lineCurrency },
      lineTotal: { amount: unitPriceAmount * it.quantity, currency: lineCurrency },
      unavailable: false,
      unavailableReason: null,
    };
  });
  return {
    id: cart.id,
    customerAccountId: cart.customerAccountId ?? null,
    organizationId: cart.organizationId ?? null,
    salesChannelId: cart.salesChannelId ?? null,
    anonymousCartToken: cart.anonymousCartToken ?? null,
    status: cart.status,
    approvalStatus: cart.approvalStatus,
    items: serializedItems,
    itemCount: items.length,
    subtotal: { amount: subtotal, currency },
    discount: cart.appliedPromotionCode
      ? { code: cart.appliedPromotionCode, amount: 0, currency }
      : null,
    grandTotal: { amount: subtotal, currency },
    primaryCta: resolvePrimaryCta(cart),
    droppedLines: [],
    couponDroppedThisRead,
    createdAt: cart.createdAt.toISOString(),
    updatedAt: cart.updatedAt.toISOString(),
    lastActivityAt: cart.lastActivityAt.toISOString(),
  };
}

/**
 * Derives the buyer's primary CTA from the cart's two-axis state
 * (main `status` × `approval_status`). See spec FR-024.
 */
function resolvePrimaryCta(cart: Cart): 'checkout' | 'submit_for_approval' | 'awaiting_approval' | 'blocked_by_organization' {
  if (cart.status === 'rejected' || cart.status === 'completed') return 'blocked_by_organization';
  if (cart.approvalStatus === 'pending') return 'awaiting_approval';
  if (cart.approvalStatus === 'rejected_by_org_admin') return 'blocked_by_organization';
  // `not_required` and `approved` both → checkout. The `submit_for_approval`
  // CTA is only emitted when the Organization's policy is on but the cart
  // hasn't been submitted yet — the route handler can compute that flag
  // when it has the OrganizationContextService on hand; for now we default
  // to `checkout`.
  return 'checkout';
}

declare const crypto: { randomUUID: () => string };
