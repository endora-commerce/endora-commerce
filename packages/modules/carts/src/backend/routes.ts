// `reply.setCookie` is not on `FastifyReply`: it is a declaration-merging
// augmentation `@fastify/cookie` contributes. Inside `backend/src` that
// augmentation arrived ambiently, through the host's own dependency and its
// `types` graph — so nothing in this module ever named it. A package compiles
// against its own manifest, where an unnamed dependency does not exist, and the
// property simply is not there (TS2339). The import is type-only, so it loads
// the declarations and emits nothing: registering the plugin stays the host's
// job, exactly as before.
import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  addCartItemRequestSchema,
  updateCartItemRequestSchema,
  saveCartItemToListSchema,
  cartUpsellsQuerySchema,
  applyCartCouponSchema,
  convertCartToQrSchema,
  ERROR_CODES,
  OrganizationCannotTransactError,
  pickLocalized,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type PromotionApplication,
} from '@endora-commerce/contracts';
import type { CartActor, CartService } from './services/cart-service.js';
import type { CartUpsellService } from './services/cart-upsell-service.js';
import type { CartCouponService } from './services/cart-coupon-service.js';
import type { CartConversionService } from './services/cart-conversion-service.js';
import type { CartPricingRecompute, RecomputeRefusal } from './services/cart-pricing-recompute.js';
import { agreementOf } from './services/cart-line-pricing.js';
import { derivePrimaryCta } from './services/cart-state-machine.js';
import {
  evaluateCartViewMinimums,
  toCartMinimumItem,
  type CartLineMinimumView,
} from './services/cart-minimums.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Cart } from './entities/cart.entity.js';

import type { CartItem } from './entities/cart-item.entity.js';

import { HttpError } from '@endora-commerce/platform/http';
import { productAudienceOf } from '@endora-commerce/platform/http';
import {
  getResolvedChannel,
  rethrowIfModuleDisabled,
  type RequireCustomerGuard,
} from '@endora-commerce/platform/kernel';
import { cartLineAmount, cartSubtotal, cartTotalAfterDiscount } from './services/cart-money.js';

const ANON_COOKIE = 'b2b_cart_anon';

export interface CartsDeps {
  cartService: CartService;
  /**
   * The customer-session guard, declared on the routes below that validate a
   * body: a declared guard runs before schema validation, a check inside the
   * handler does not.
   */
  requireCustomer: RequireCustomerGuard;
  /**
   * Feature 027 — Up-sell aggregator. Optional so legacy compositions
   * that haven't yet wired the new service still build successfully;
   * production composition (commerceModule) provides it.
   */
  cartUpsellService?: CartUpsellService;
  /**
   * Feature 027 — pushes a cart line into the buyer's named Purchase
   * List. Cross-module call to ShoppingListService.addItem, through
   * `cartShoppingListBridge`, which refuses with 503 `MODULE_DISABLED`
   * naming `shopping_lists` where that module is absent.
   *
   * Required, like the three below (issue #248). They were optional "so
   * legacy compositions still build", and each route answered a missing
   * one with `503` + `NOT_FOUND` + an untranslated token
   * (`shopping_lists_unavailable`, …) — a code contradicting its status,
   * shown to a buyer as a machine string. No composition omits them: the
   * module's own wires all four unconditionally, and an owner that is off
   * answers through its gated port instead, as the translated
   * `MODULE_DISABLED` envelope. The branches were unreachable, and
   * requiring the four is what keeps them that way.
   */
  pushLineToShoppingList: (input: {
    customerAccountId: string;
    organizationId: string | null;
    shoppingListId: string;
    productId: string;
    variantId: string | null;
    quantity: number;
  }) => Promise<void>;
  /**
   * Feature 027 US2 — coupon application service. Also drives the
   * `reevaluateOnRead` auto-drop in the GET handler when a previously-
   * applied code no longer fits the cart. Required — see
   * {@link CartsDeps.pushLineToShoppingList}.
   */
  cartCouponService: CartCouponService;
  /**
   * Feature 027 US3 — three conversions (Cart→QR, QR→Cart, ShoppingList→Cart).
   * Required — see {@link CartsDeps.pushLineToShoppingList}.
   */
  cartConversionService: CartConversionService;
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
   * cart-side append result. Required — see
   * {@link CartsDeps.pushLineToShoppingList}.
   */
  appendShoppingListToCart: (input: {
    customerAccountId: string;
    organizationId: string | null;
    shoppingListId: string;
    /** The channel whose basket the lines go into — the request's. */
    salesChannelId: string;
  }) => Promise<{
    cartId: string;
    appendedLineCount: number;
    /** Feature 155 — `minimum` on a `below_minimum` line. */
    droppedLines: Array<{ productId: string; productName: string; reason: string; minimum?: number }>;
  }>;
  resolveCartActor: (request: FastifyRequest) => {
    customer?: { customerAccountId: string; organizationId: string | null };
    anonymousToken?: string;
  };
  emFactory: () => EntityManager;
  /**
   * `catalog`'s product read model (feature 075, Phase C). The cart
   * serializer resolves each line's display name, slug and sku from it; it
   * used to `em.find(Product, …)` against `catalog`'s table, so a switched-off
   * `catalog` still named the products on a cart it had stopped serving.
   */
  catalogProducts: CatalogProductReadPort;
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
 * The caller of a storefront cart route, on the request's channel: the basket a
 * route addresses is always the one of the channel it is used on
 * (`specs/154-sales-channel-access/`, contracts/basket-attribution.md §1).
 */
function cartActorOnRequestChannel(
  resolveCartActor: CartsDeps['resolveCartActor'],
  request: FastifyRequest,
): CartActor & { salesChannelId: string } {
  const actor = resolveCartActor(request);
  const salesChannelId = getResolvedChannel(request).id;
  return {
    ...(actor.customer ? { customer: { ...actor.customer, salesChannelId } } : {}),
    ...(actor.anonymousToken
      ? { anonymousToken: actor.anonymousToken, anonymousSalesChannelId: salesChannelId }
      : {}),
    salesChannelId,
  };
}

/**
 * Cart routes — open to anonymous users too. The resolver picks the right
 * cart based on (authenticated session, anonymous cookie, neither), on the
 * request's channel.
 *
 * Anonymous callers receive a Set-Cookie for `b2b_cart_anon` on first add so
 * later requests target the same cart — and a new one when the cookie they hold
 * names a basket of another channel.
 */
export async function registerCartRoutes(app: FastifyInstance, deps: CartsDeps): Promise<void> {
  const { cartService, emFactory } = deps;
  const { assertOrganizationCanTransact } = deps;
  const resolveCartActor = (request: FastifyRequest) =>
    cartActorOnRequestChannel(deps.resolveCartActor, request);

  /**
   * The basket a read addresses, or `null` for none: a customer's is created on
   * first read as it always was; an anonymous token names no basket on a
   * channel its basket is not of.
   */
  const basketFor = async (actor: ReturnType<typeof resolveCartActor>): Promise<Cart | null> => {
    if (actor.customer) return cartService.getOrCreateForCustomer(actor.customer);
    if (actor.anonymousToken) {
      return cartService.getOrCreateForAnon(emFactory(), actor.anonymousToken, actor.salesChannelId);
    }
    return null;
  };

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
    const cart = await basketFor(actor);
    if (!cart) {
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

    // Resolve per-line display name + slug so the storefront does not
    // have to fan out one fetch per line. Bulk lookup keyed by
    // productId; the name is in the response's language (the same answer
    // an error sentence is translated into), with `pickLocalized`'s fallback
    // chain behind it.
    const preferredLanguage = await request.responseLanguage();
    // Feature 155 (R11, D7) — the same records also feed the minimum flags, so
    // this read is no longer wrapped in a tolerant `catch`. It used to fall back
    // to empty meta on any failure, which for the flags is the fail-open answer
    // FR-037 rules out: a cart that hides a below-minimum line because the
    // catalogue did not answer. A failed read now fails the view; a product row
    // that is simply gone is not a failure — its line reads `unavailable`.
    const products = await loadCartProducts(deps.catalogProducts, items.map((it) => it.productId));
    const productMeta = productMetaOf(products, preferredLanguage);
    const minimumViews = await evaluateCartViewMinimums(
      deps.catalogProducts,
      { sourceQuoteRequestId: cart.sourceQuoteRequestId ?? null },
      items.map(toCartMinimumItem),
      products,
    );

    // Feature 027 §R5 — re-pricing on read (FR-008), through the chain
    // placement charges by (issue #168): the agreed price, the price list, the
    // Product's own price, and a refusal for a line placement would refuse.
    let recomputedPrices: Map<string, { amount: number; currency: string }> | null = null;
    let pricingRefusals: Map<string, RecomputeRefusal> | null = null;
    if (deps.cartPricingRecompute && items.length > 0) {
      try {
        const lines = items.map((it) => ({
          cartItemId: it.id,
          productId: it.productId,
          variantId: it.variantId ?? null,
          quantity: it.quantity,
          agreed: agreementOf(it),
        }));
        const resolved = await deps.cartPricingRecompute.recompute(
          {
            cartId: cart.id,
            organizationId: cart.organizationId ?? null,
            // The basket was looked up on this channel, so it is the basket's.
            salesChannelId: actor.salesChannelId,
            // D-287 P0 — the customer's own group, as on the add path.
            customerAccountId: cart.customerAccountId ?? null,
          },
          lines,
        );
        recomputedPrices = new Map(
          resolved
            .filter((r) => r.amount !== null)
            .map((r) => [r.cartItemId, { amount: r.amount as number, currency: r.currency }]),
        );
        pricingRefusals = new Map(
          resolved
            .filter((r) => r.amount === null && r.refusal)
            .map((r) => [r.cartItemId, r.refusal as RecomputeRefusal]),
        );
      } catch (err) {
        // The tolerance is narrow and stays: a resolver hiccup on one read must
        // not take the whole cart down, and the snapshotted unit price is a
        // figure the platform actually quoted.
        //
        // What it may not absorb is the presence answer (issue #124). `carts`
        // declares `price_lists` a hard dependency, so an absent one fails
        // closed — and this `catch` was quietly deciding the opposite: it
        // rendered every line at its snapshot with `price_lists` switched off
        // and said nothing, so the buyer read prices from a module the platform
        // was refusing to serve and found out at checkout.
        rethrowIfModuleDisabled(err);
        request.log.warn({ err, cartId: cart.id }, 'cart repricing failed; rendering snapshots');
        recomputedPrices = null;
        pricingRefusals = null;
      }
    }

    // Feature 027 US2 / FR-014 — re-evaluate the applied coupon on every
    // read. If a previously-valid code is no longer eligible (e.g. the
    // cart fell below min spend after a line removal), drop it silently
    // on the cart record and surface `couponDroppedThisRead` so the
    // storefront banner can inform the buyer.
    let couponDroppedThisRead: { code: string; reason: string } | null = null;
    if (cart.appliedPromotionCode && items.length > 0) {
      try {
        const result = await deps.cartCouponService.reevaluateOnRead(cart, items);
        if (result.dropped) {
          couponDroppedThisRead = result.dropped;
        }
      } catch (err) {
        // Never block a cart read on a coupon-engine hiccup — but an absent
        // `promotions` is not a hiccup (issue #124). Swallowing it charged the
        // buyer the undiscounted total while the cart went on showing the code.
        rethrowIfModuleDisabled(err);
        couponDroppedThisRead = null;
      }
    }
    // Feature 045 — compute the real discount + per-promotion breakdown on
    // read so the cart shows applied promotions (FR-031/FR-033). Never block
    // a cart read on a promotion-engine hiccup.
    let application: PromotionApplication | null = null;
    if (items.length > 0) {
      try {
        application = await deps.cartCouponService.computeApplication(cart, items);
      } catch (err) {
        // Same rule as the coupon re-evaluation above: a hiccup degrades to "no
        // breakdown", an absent `promotions` does not degrade at all.
        rethrowIfModuleDisabled(err);
        application = null;
      }
    }
    return {
      data: serializeCart(
        cart,
        items,
        recomputedPrices,
        couponDroppedThisRead,
        productMeta,
        application,
        minimumViews,
        pricingRefusals,
      ),
    };
  });

  app.post(
    '/api/v1/cart/items',
    { schema: { body: addCartItemRequestSchema } },
    async (request, reply) => {
      let actor = resolveCartActor(request);
      // If neither side identified, mint an anonymous token and echo it back —
      // and the same for a token whose basket is another channel's: the token is
      // unique across baskets, so it can start none here, and the first write on
      // this channel starts a basket under a new one (contract §1).
      const mintAnonymousToken =
        !actor.customer &&
        (!actor.anonymousToken ||
          !(await cartService.anonymousTokenUsableOn(actor.anonymousToken, actor.salesChannelId)));
      if (mintAnonymousToken) {
        const token = `anon-${crypto.randomUUID()}`;
        reply.setCookie(ANON_COOKIE, token, { path: '/', sameSite: 'lax', httpOnly: true });
        actor = {
          anonymousToken: token,
          anonymousSalesChannelId: actor.salesChannelId,
          salesChannelId: actor.salesChannelId,
        };
      }
      await guardOrganizationTransact(actor);
      const body = addCartItemRequestSchema.parse(request.body);
      const language = await request.responseLanguage();
      const result = await cartService.addItem(
        actor,
        {
          productId: body.productId,
          ...(body.variantId ? { variantId: body.variantId } : {}),
          quantity: body.quantity,
          ...(body.packagingUnitId ? { packagingUnitId: body.packagingUnitId } : {}),
        },
        { language },
      );
      return { data: serializeCart(result.cart, result.items) };
    },
  );

  app.patch<{ Params: { itemId: string } }>(
    '/api/v1/cart/items/:itemId',
    { schema: { body: updateCartItemRequestSchema } },
    async (request) => {
      const actor = resolveCartActor(request);
      const body = updateCartItemRequestSchema.parse(request.body);
      const language = await request.responseLanguage();
      const result = await cartService.updateItem(
        actor,
        request.params.itemId,
        body.quantity,
        { language },
      );
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
   * goes through `pushLineToShoppingList`; with `shopping_lists` absent it
   * answers 503 `MODULE_DISABLED` naming the module, so the storefront
   * surfaces "feature unavailable" instead of silently dropping.
   */
  app.post<{ Params: { itemId: string } }>(
    '/api/v1/cart/items/:itemId/save-to-shopping-list',
    { preHandler: deps.requireCustomer, schema: { body: saveCartItemToListSchema } },
    async (request, reply) => {
      const actor = resolveCartActor(request);
      if (!actor.customer) {
        throw new HttpError(
          401,
          ERROR_CODES.UNAUTHORIZED,
          'Sign-in required to save to a shopping list.',
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
      if (!actor.customer && !actor.anonymousToken) {
        throw new HttpError(
          401,
          ERROR_CODES.UNAUTHORIZED,
          'Cart not found.',
        );
      }
      // A token of another channel's basket names no basket here: nothing to
      // apply a code to.
      const cart = await basketFor(actor);
      if (!cart) {
        throw new HttpError(422, ERROR_CODES.CART_EMPTY, 'cart_empty');
      }
      const items = await cartService.getItems(cart.id);
      if (items.length === 0) {
        throw new HttpError(422, ERROR_CODES.CART_EMPTY, 'cart_empty');
      }
      const body = applyCartCouponSchema.parse(request.body);
      const result = await deps.cartCouponService.apply(cart, body.code);
      if (result.outcome === 'dropped') {
        // Issue #231 — the discriminator goes in **both** fields, and the
        // duplication is the point.
        //
        // `reason` is what the published contract carries
        // (`couponFailureBodySchema` in `packages/contracts/src/carts.ts`) and
        // what the storefront branches on. `code` is what the envelope's
        // `refusalToken` reads (`src/http/error-envelope.ts`) to build
        // `errors.CART_COUPON_REJECTED.<token>` — the keys this module's bundle
        // files the seven written reason sentences under. Spelling the
        // discriminator only `reason` is why every one of them was dead: a
        // buyer under the minimum spend was shown the generic refusal while a
        // translated sentence telling them what to do about it sat unread.
        //
        // Additive on purpose. Renaming `reason` to `code` would be one field
        // instead of two and would break a shape two schemas already publish.
        const detailsBody: Record<string, unknown> = {
          code: result.reason,
          reason: result.reason,
        };
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
    if (!actor.customer && !actor.anonymousToken) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Cart not found.');
    }
    const cart = await basketFor(actor);
    if (!cart) return { data: emptyCart() };
    await deps.cartCouponService.clear(cart);
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
    { preHandler: deps.requireCustomer, schema: { body: convertCartToQrSchema } },
    async (request) => {
      const actor = resolveCartActor(request);
      if (!actor.customer) {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Sign-in required.');
      }
      // D-178 — an invariant, not a business state; see
      // `routes.organization.ts`'s twin.
      if (!actor.customer.organizationId) {
        throw new HttpError(
          500,
          ERROR_CODES.INTERNAL,
          'Invariant violated: a customer account has no Organization (Principle XI).',
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
        { language: await request.responseLanguage() },
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
      const language = await request.responseLanguage();
      const result = await deps.cartConversionService.createCartFromQuoteRequest(
        request.params.quoteRequestId,
        actor.customer,
        { language },
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
      const result = await deps.appendShoppingListToCart({
        customerAccountId: actor.customer.customerAccountId,
        organizationId: actor.customer.organizationId,
        shoppingListId: request.params.shoppingListId,
        salesChannelId: actor.salesChannelId,
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
    const cart = await basketFor(actor);
    if (!cart) return { data: [] };
    const parsed = cartUpsellsQuerySchema.parse(request.query ?? {});
    const limit = parsed.limit ?? 12;
    const candidates = await deps.cartUpsellService.forCart(
      cart.id,
      limit,
      productAudienceOf(request),
    );
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
    appliedPromotions: [],
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
  const currency = items[0]?.currency ?? 'PLN';
  const serializedItems = items.map((it) => {
    const unitPriceAmount = Number(it.unitPrice);
    return {
      id: it.id,
      productId: it.productId,
      variantId: it.variantId ?? null,
      quantity: it.quantity,
      unitPrice: { amount: unitPriceAmount, currency: it.currency },
      lineTotal: { amount: cartLineAmount(it.unitPrice, it.quantity), currency: it.currency },
    };
  });
  return {
    id: cart.id,
    itemCount: items.length,
    items: serializedItems,
    subtotal: { amount: Number(cartSubtotal(items)), currency },
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
 * `lineTotal`. The full view passes `recomputedPrices` — each line priced by
 * the chain placement charges by (`CartPricingRecompute`, issue #168) — and
 * `pricingRefusals`, the lines placement would refuse, which read as
 * unavailable at their stored price; the mutation answers pass neither and
 * return the stored `unitPrice`.
 */
interface ProductMeta {
  name: string;
  slug: string;
  sku: string | null;
}

function serializeCart(
  cart: Cart,
  items: CartItem[],
  recomputedPrices: Map<string, { amount: number; currency: string }> | null = null,
  couponDroppedThisRead: { code: string; reason: string } | null = null,
  productMeta: Map<string, ProductMeta> = new Map(),
  application: PromotionApplication | null = null,
  /** Feature 155 — the full view's per-line minimum flags; absent on the mutation answers. */
  minimumViews: Map<string, CartLineMinimumView> | null = null,
  /**
   * Issue #168 — lines the placement chain gives no orderable price: they read
   * as unavailable, because placement refuses them.
   */
  pricingRefusals: Map<string, RecomputeRefusal> | null = null,
) {
  let currency = items[0]?.currency ?? 'PLN';
  // Each line at the price it is shown at, for the subtotal (issue #417: exact).
  const priced: Array<{ unitPrice: number | string; quantity: number }> = [];
  const serializedItems = items.map((it) => {
    const recomputed = recomputedPrices?.get(it.id);
    const unitPriceAmount = recomputed ? recomputed.amount : Number(it.unitPrice);
    const lineCurrency = recomputed ? recomputed.currency : it.currency;
    if (currency === 'PLN' && lineCurrency !== 'PLN') currency = lineCurrency;
    priced.push({ unitPrice: recomputed ? recomputed.amount : it.unitPrice, quantity: it.quantity });
    const meta = productMeta.get(it.productId) ?? null;
    const minimum = minimumViews?.get(it.id) ?? null;
    const refusal = pricingRefusals?.get(it.id);
    // Feature 043 — append the packaging-unit name to the display name when the
    // line was added as a packaging unit (e.g. "<name> (Paleta)").
    const packagingUnitName = it.packagingUnitName ?? null;
    const baseName = meta?.name ?? null;
    const displayName =
      baseName !== null && packagingUnitName
        ? `${baseName} (${packagingUnitName})`
        : baseName;
    return {
      id: it.id,
      productId: it.productId,
      variantId: it.variantId ?? null,
      quantity: it.quantity,
      unitPrice: { amount: unitPriceAmount, currency: lineCurrency },
      lineTotal: { amount: cartLineAmount(recomputed ? recomputed.amount : it.unitPrice, it.quantity), currency: lineCurrency },
      unavailable: (minimum?.unavailable ?? false) || refusal !== undefined,
      // FR-037 — a line whose product record is gone, in the vocabulary the
      // storefront already renders. Issue #168 — a line placement would refuse
      // reads the same way: sold on request only is `not_purchasable`, no
      // price for this buyer is `no_price_in_customer_list`.
      unavailableReason:
        minimum?.unavailable || refusal === 'quote_only' || refusal === 'product_missing'
          ? ('not_purchasable' as const)
          : refusal === 'unpriced'
            ? ('no_price_in_customer_list' as const)
            : null,
      ...(minimum
        ? { minOrderQuantity: minimum.minOrderQuantity, belowMinimum: minimum.belowMinimum }
        : {}),
      productName: baseName,
      productSlug: meta?.slug ?? null,
      productSku: meta?.sku ?? null,
      packagingUnitName,
      packagingUnitBaseQuantity: it.packagingUnitBaseQuantity ?? null,
      displayName,
    };
  });
  const subtotal = cartSubtotal(priced);
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
    subtotal: { amount: Number(subtotal), currency },
    discount:
      application && application.discountTotal > 0
        ? { code: cart.appliedPromotionCode ?? null, amount: application.discountTotal, currency }
        : cart.appliedPromotionCode
          ? { code: cart.appliedPromotionCode, amount: 0, currency }
          : null,
    appliedPromotions: application
      ? application.appliedPromotions.map((ap) => ({
          promotionId: ap.promotionId,
          couponId: ap.couponId ?? null,
          amount: ap.amount,
          currency,
        }))
      : [],
    grandTotal: {
      amount: cartTotalAfterDiscount(subtotal, application?.discountTotal ?? 0),
      currency,
    },
    primaryCta: resolvePrimaryCta(cart),
    droppedLines: [],
    couponDroppedThisRead,
    createdAt: cart.createdAt.toISOString(),
    updatedAt: cart.updatedAt.toISOString(),
    lastActivityAt: cart.lastActivityAt.toISOString(),
  };
}

function resolvePrimaryCta(cart: Cart) {
  // The `submit_for_approval` branch needs the Organization's policy
  // flag, which the route handler does not have on hand here. The
  // helper is callable from the org-admin route with the flag passed
  // through explicitly; for the storefront read we default to
  // `requiresApproval: false`, which makes `not_required` + cart-active
  // collapse to `checkout`.
  return derivePrimaryCta({
    status: cart.status,
    approvalStatus: cart.approvalStatus,
    requiresApproval: false,
  });
}

/**
 * Bulk-fetches the product records for every productId on the cart — one read
 * the display names and the minimum flags share (feature 155, R11). Deliberately
 * the wide read: a soft-deleted product still names the line it is on.
 */
async function loadCartProducts(
  catalogProducts: CatalogProductReadPort,
  productIds: string[],
): Promise<CatalogProductRecord[]> {
  if (productIds.length === 0) return [];
  return catalogProducts.findByIds(Array.from(new Set(productIds)));
}

/**
 * Per-product display metadata, the name resolved from the record's per-locale
 * `name` in the response's language, through the `pickLocalized` fallback chain.
 * A product without a record has no entry (the serializer treats it as an
 * unknown name and the storefront falls back to the productId).
 */
function productMetaOf(
  products: readonly CatalogProductRecord[],
  preferredLanguage: string | undefined,
): Map<string, ProductMeta> {
  const meta = new Map<string, ProductMeta>();
  for (const p of products) {
    meta.set(p.id, {
      name: pickLocalized(p.name, preferredLanguage),
      slug: p.slug,
      sku: p.sku,
    });
  }
  return meta;
}

declare const crypto: { randomUUID: () => string };
