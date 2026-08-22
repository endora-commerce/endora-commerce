import { createHash } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  ERROR_CODES,
  isProductVisibleTo,
  type CartMergeOutcome,
  type ProductAudience,
} from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import type {
  CatalogPackagingUnitRecord,
  CatalogProductReadPort,
  CatalogProductRecord,
  LinePricePort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import type { SalesChannelMembershipPort } from '../../../kernel/ports/sales-channel.js';
import { outOfRequestChannel } from '../../../kernel/sales-channels/request-channel-assortment.js';
import type { CartApprovalService } from './cart-approval-service.js';
import type { CartAuditService } from './cart-audit-service.js';
import type { CartRecomputeCache } from './cart-recompute-cache.js';
import type { DisplayMode } from '@endora-commerce/contracts';

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

/**
 * Cart-line hard cap (feature 027 FR-001 / spec edge case "Cart contents
 * cap"). The 201st distinct line is refused with HTTP 422.
 */
export const CART_MAX_LINES = 200;

export class CartService {
  /**
   * `pricingService` is **required** since issue #124. It used to be optional
   * "for test rigs", and the cart then read the legacy
   * `attributeValues['defaultPrice']` whenever it was missing — so a rig, a
   * wiring slip and `price_lists` switched off all produced the same thing: a
   * cart line priced from a catalogue attribute that no price list supports.
   * Absence is now a `lazyPort` gate that throws `MODULE_DISABLED` at the call,
   * which nothing downstream can mistake for a price.
   *
   * Cart entities don't currently track which sales channel they were
   * created on (multi-channel cart attribution is a separate
   * follow-up), so the resolver runs against the system-default
   * channel — matching the behaviour the foundation cart already had.
   * Lists with a `salesChannel` criterion targeting other channels
   * therefore won't apply on the cart line until cart-side channel
   * tracking lands.
   */
  /**
   * `approvalService` and `auditService` are optional — when wired
   * (production composition), any buyer-driven mutation on an
   * `approved` cart re-arms approval to `pending` and a typed audit
   * row is landed (line_added / line_qty_changed / line_removed).
   * Foundation tests and legacy test rigs that don't wire either still
   * construct the service without them; both hooks no-op when absent.
   */
  constructor(
    private readonly emFactory: () => EntityManager,
    /** `price_lists`' line-resolution slice (feature 075, Phase C). */
    private readonly pricingService: LinePricePort,
    /** `catalog`'s product read model — products, variants, packaging units. */
    private readonly catalogProducts: CatalogProductReadPort,
    /** `organizations`' read model — the buying org the price resolves against. */
    private readonly organizations: OrganizationDetailsPort,
    /**
     * The sanctioned bridge accessor (Constitution XII), for the assortment
     * gate `addItem` owes (issue #259). Required, like `catalogProducts`: an
     * optional one would make "this rig did not wire it" and "this channel
     * publishes the product" the same answer, which is the fail-open shape the
     * whole issue is about.
     */
    private readonly channelMembership: SalesChannelMembershipPort,
    private readonly approvalService?: CartApprovalService,
    private readonly auditService?: CartAuditService,
    private readonly recomputeCache?: CartRecomputeCache,
  ) {}

  /** Invalidate the per-cart price-recompute cache on every cart-side write. */
  async #invalidateRecomputeCache(cartId: string): Promise<void> {
    if (!this.recomputeCache) return;
    try {
      await this.recomputeCache.invalidate(cartId);
    } catch {
      // Cache invalidation is best-effort — never block a write.
    }
  }

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
        salesChannelId: await this.#defaultSalesChannelId(em),
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
        salesChannelId: await this.#defaultSalesChannelId(em),
      });
      await em.persistAndFlush(cart);
    }
    return cart;
  }

  /**
   * Feature 052 — a cart MUST carry a resolved sales channel so promotion and
   * pricing evaluation is channel-scoped (the promotion channel gate fails closed
   * on a null-channel cart, FR-005). Until request-driven channel resolution is
   * unified (spec 03), a new cart defaults to the system-default channel. Returns
   * `null` only if no system-default channel exists (a misconfigured store).
   */
  async #defaultSalesChannelId(em: EntityManager): Promise<string | null> {
    const channel = await em.findOne(SalesChannel, { systemDefault: true }, { fields: ['id'] });
    return channel?.id ?? null;
  }

  async getItems(cartId: string): Promise<CartItem[]> {
    const em = this.emFactory();
    return em.find(CartItem, { cartId });
  }

  async addItem(
    actor: { customer?: CustomerContext; anonymousToken?: string },
    input: { productId: string; variantId?: string; quantity: number; packagingUnitId?: string },
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
    const product = await this.catalogProducts.findById(input.productId);
    // Issue #227 — a product this shopper may not see is a product they may not
    // put in a cart. The read port is the row-level one and applies no policy of
    // its own, deliberately: an order line has to resolve its product long after
    // the operator restricted it. That makes enforcement the caller's, and this
    // caller is holding a `productId` the buyer chose.
    //
    // 404 and not 403, matching the product detail: a caller who may not see the
    // row may not learn it exists, and the two answers are indistinguishable to
    // an honest client because they are the same answer.
    if (!product || !isProductVisibleTo(product, cartAudience(actor))) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    // Issue #259 — the second filter the predicate above says it is not. The
    // channel is a property of the request, so it is read off the request scope
    // and never re-resolved here; outside a request there is no channel to be
    // out of and `outOfRequestChannel` answers `false`.
    //
    // The same 404 as the two lines above, deliberately: "sold on another
    // channel", "restricted to another organisation" and "does not exist" have
    // to be one answer, or the pair of them is an enumeration oracle over an
    // operator's private assortment — the defect issue #174 found in the
    // type-ahead next door.
    if (await outOfRequestChannel(this.channelMembership, product.id)) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    // Feature 043 — ordering by a packaging unit (e.g. a pallet): the line is
    // measured in base pieces (`baseQuantity × units`) and snapshots the unit
    // name so the cart/order/RFQ can append it to the product name.
    //
    // `findPackagingUnitInProduct` is the two-argument form of the same read:
    // the "does this unit belong to this product?" test was the second half of
    // the `where` clause and stays inside one query.
    let packagingUnit: CatalogPackagingUnitRecord | null = null;
    if (input.packagingUnitId) {
      packagingUnit = await this.catalogProducts.findPackagingUnitInProduct(
        product.id,
        input.packagingUnitId,
      );
      if (!packagingUnit) {
        throw new HttpError(
          404,
          ERROR_CODES.PACKAGING_UNIT_NOT_FOUND,
          'Packaging unit not found for this product.',
        );
      }
    }
    const effectiveQuantity = packagingUnit
      ? packagingUnit.baseQuantity * input.quantity
      : input.quantity;

    // If the same product+variant+packaging-unit is already in the cart, bump
    // quantity. A packaging-unit line and a single-piece line of the same
    // product stay distinct (different `packagingUnitId`).
    const existing = await em.findOne(CartItem, {
      cartId: cart.id,
      productId: product.id,
      variantId: input.variantId ?? null,
      packagingUnitId: input.packagingUnitId ?? null,
    });
    if (existing) {
      existing.quantity += effectiveQuantity;
      cart.lastActivityAt = new Date();
      await em.flush();
    } else {
      // Feature 027 FR-001: enforce the 200-line cap on the 201st distinct
      // (productId, variantId) pair. Foundation duplicate-summation above
      // does not trigger the cap.
      const currentLineCount = await em.count(CartItem, { cartId: cart.id });
      if (currentLineCount >= CART_MAX_LINES) {
        throw new HttpError(
          422,
          ERROR_CODES.CART_LINE_CAP_EXCEEDED,
          'cart_line_cap_exceeded',
        );
      }
      const resolved = await this.#resolveLineUnitPrice(em, {
        product,
        organizationId: actor.customer?.organizationId ?? null,
        quantity: effectiveQuantity,
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
        ...(packagingUnit
          ? {
              packagingUnitId: packagingUnit.id,
              packagingUnitName: packagingUnit.name,
              packagingUnitBaseQuantity: packagingUnit.baseQuantity,
            }
          : {}),
        quantity: effectiveQuantity,
        // `resolved === null` is `price_lists` answering "no list applies to
        // this line"; the catalogue attribute is the legacy stand-in for that
        // case and is reported as remaining debt (issue #124). What can no
        // longer land here is an *absent* `price_lists`: resolving the port
        // throws `MODULE_DISABLED` before this expression runs.
        unitPrice: resolved
          ? Number(resolved.amount).toFixed(2)
          : (Number(
              product.attributeValues['defaultPrice'] ??
                product.attributeValues['price'] ??
                0,
            )).toFixed(2),
        currency: resolved?.currency ?? 'PLN',
      });
      em.persist(item);
      cart.lastActivityAt = new Date();
      await em.flush();
    }

    if (this.approvalService && actor.customer) {
      await this.approvalService.maybeReArm(cart, {
        customerAccountId: actor.customer.customerAccountId,
      });
    }

    if (this.auditService) {
      await this.auditService.record({
        cartId: cart.id,
        actorType: actor.customer ? 'customer' : 'system',
        ...(actor.customer ? { actorId: actor.customer.customerAccountId } : {}),
        action: 'line_added',
        metadata: {
          productId: input.productId,
          ...(input.variantId ? { variantId: input.variantId } : {}),
          quantity: input.quantity,
        },
      });
    }

    await this.#invalidateRecomputeCache(cart.id);

    const items = await em.find(CartItem, { cartId: cart.id });
    return { cart, items };
  }

  /**
   * Look up the line's unit price via the resolver.
   *
   * `null` means "the price-list engine answered, and nothing applies" —
   * `resolveLinePrice`'s own documented answer — so there is no `catch` here
   * (issue #84). There used to be one, and it made the two answers
   * indistinguishable: a `price_lists` switched off, or a resolver bug, both
   * came back as "this line has no price", and the cart quietly re-priced from
   * the catalogue default. An absent `price_lists` now throws through this
   * method to the route (issue #124).
   */
  async #resolveLineUnitPrice(
    em: EntityManager,
    input: {
      product: CatalogProductRecord;
      organizationId: string | null;
      quantity: number;
      variantId: string | null;
    },
  ): Promise<{
    amount: string;
    currency: string;
    priceListId: string;
    displayMode: DisplayMode;
  } | null> {
    const channel = await em.findOne(SalesChannel, { systemDefault: true });
    if (!channel) return null;
    const organization = input.organizationId
      ? await this.organizations.findById(input.organizationId)
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

    const oldQuantity = item.quantity;
    if (quantity <= 0) {
      em.remove(item);
    } else {
      item.quantity = quantity;
    }
    cart.lastActivityAt = new Date();
    await em.flush();
    if (this.approvalService && actor.customer) {
      await this.approvalService.maybeReArm(cart, {
        customerAccountId: actor.customer.customerAccountId,
      });
    }
    if (this.auditService) {
      await this.auditService.record({
        cartId: cart.id,
        actorType: actor.customer ? 'customer' : 'system',
        ...(actor.customer ? { actorId: actor.customer.customerAccountId } : {}),
        action: quantity <= 0 ? 'line_removed' : 'line_qty_changed',
        metadata: {
          productId: item.productId,
          ...(item.variantId ? { variantId: item.variantId } : {}),
          oldQuantity,
          newQuantity: quantity,
        },
      });
    }
    await this.#invalidateRecomputeCache(cart.id);
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
    const removedProductId = item.productId;
    const removedVariantId = item.variantId ?? null;
    const removedQuantity = item.quantity;
    em.remove(item);
    cart.lastActivityAt = new Date();
    await em.flush();
    if (this.approvalService && actor.customer) {
      await this.approvalService.maybeReArm(cart, {
        customerAccountId: actor.customer.customerAccountId,
      });
    }
    if (this.auditService) {
      await this.auditService.record({
        cartId: cart.id,
        actorType: actor.customer ? 'customer' : 'system',
        ...(actor.customer ? { actorId: actor.customer.customerAccountId } : {}),
        action: 'line_removed',
        metadata: {
          productId: removedProductId,
          ...(removedVariantId ? { variantId: removedVariantId } : {}),
          quantity: removedQuantity,
        },
      });
    }
    await this.#invalidateRecomputeCache(cart.id);
    const items = await em.find(CartItem, { cartId: cart.id });
    return { cart, items };
  }

  /**
   * Explicit "this buyer just opened the cart page" ping (feature 027 §R4 /
   * FR-032). Bumps `last_activity_at` and, if the cart had transitioned to
   * `abandoned`, brings it back to `active` and clears
   * `abandonment_notified_at` so the next abandonment cycle can notify
   * again. No-op on a missing cart.
   */
  async touch(actor: { customer?: CustomerContext; anonymousToken?: string }): Promise<Cart | null> {
    // command-coverage-ignore: bumps the ephemeral cart's lastActivityAt for the
    // abandonment sweep — transient bookkeeping, not an audited domain mutation.
    const em = this.emFactory();
    let cart: Cart | null = null;
    if (actor.customer) {
      cart = await em.findOne(Cart, {
        customerAccountId: actor.customer.customerAccountId,
        status: { $in: ['active', 'abandoned'] },
      });
    } else if (actor.anonymousToken) {
      cart = await em.findOne(Cart, {
        anonymousCartToken: actor.anonymousToken,
        status: { $in: ['active', 'abandoned'] },
      });
    }
    if (!cart) return null;
    cart.lastActivityAt = new Date();
    if (cart.status === 'abandoned') {
      cart.status = 'active';
      cart.abandonmentNotifiedAt = null;
    }
    await em.flush();
    return cart;
  }

  /**
   * Merge an anonymous cart's items into the customer's cart at login
   * time (feature 037-cart-merge-on-login).
   *
   * Returns a `CartMergeOutcome` diagnostic the caller (the login route
   * via the `onLogin` hook) uses to surface the result to the storefront
   * and to decide whether to clear the stale `b2b_cart_anon` cookie.
   * See specs/037-cart-merge-on-login/contracts/cart-merge.md § 3.
   *
   * State matrix:
   *   - `adopted`        — the customer had no active cart; the anon
   *     cart's lines were placed onto a freshly-created destination.
   *   - `merged`         — the customer already had an active cart and
   *     ≥ 1 anon line was moved or summed into it.
   *   - `noop_empty`     — the anon cart was found but carried no items;
   *     the source row is still flipped to `completed` + detokenised
   *     (cleanup), no audit row is written.
   *   - `noop_no_anon`   — no cart for the supplied token; no DB change.
   *
   * Coupons on the source cart are NOT carried to the destination
   * (R-05 / FR-010 — the destination's existing `appliedPromotionCode`
   * is preserved verbatim).
   */
  async mergeAnonymousIntoCustomer(
    anonymousToken: string,
    ctx: CustomerContext,
  ): Promise<CartMergeOutcome> {
    const em = this.emFactory();
    // Look up the source first so the noop_no_anon branch can skip the
    // destination-cart creation. Per the spec, the diagnostic still
    // includes a destinationCartId so the storefront has a stable id to
    // re-read its cart from on next render.
    const anon = await em.findOne(Cart, { anonymousCartToken: anonymousToken, status: 'active' });
    if (!anon) {
      const destForNoop = await this.#getOrCreateForCustomerOn(em, ctx);
      return {
        outcome: 'noop_no_anon',
        movedLineCount: 0,
        summedLineCount: 0,
        destinationCartId: destForNoop.id,
      };
    }

    // Detect "the customer's destination cart was newly created right now":
    // peek for an existing active cart row BEFORE calling the get-or-create
    // helper. If absent and the source has items, we will return `adopted`.
    const preExistingDest = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      status: 'active',
    });
    const customerCart = preExistingDest ?? (await this.#getOrCreateForCustomerOn(em, ctx));

    let movedLineCount = 0;
    let summedLineCount = 0;
    const anonItems = await em.find(CartItem, { cartId: anon.id });
    for (const item of anonItems) {
      const existing = await em.findOne(CartItem, {
        cartId: customerCart.id,
        productId: item.productId,
        variantId: item.variantId ?? null,
      });
      if (existing) {
        existing.quantity += item.quantity;
        summedLineCount += 1;
      } else {
        item.cartId = customerCart.id;
        movedLineCount += 1;
      }
    }

    // Merge complete — mark the source anonymous cart as `completed` even
    // when the merge was a noop_empty (it never produced anything down-
    // stream, but leaving it `active` would let the abandonment sweep
    // pick it up later, and leaving the token live would let a second
    // login try to re-merge an already-consumed source). Treating it as
    // `abandoned` would falsely flag it for the abandonment-notification
    // sweep. See feature 027 §R10.
    anon.status = 'completed';
    anon.anonymousCartToken = null;

    const isNoopEmpty = movedLineCount + summedLineCount === 0;
    const outcome: CartMergeOutcome['outcome'] = isNoopEmpty
      ? 'noop_empty'
      : preExistingDest
        ? 'merged'
        : 'adopted';

    // Audit only on observable state-changes on the destination cart
    // (R-08). noop_empty and noop_no_anon are not destination-state
    // changes and are observable in the application log instead.
    if ((outcome === 'adopted' || outcome === 'merged') && this.auditService) {
      const sourceAnonTokenHash = createHash('sha256').update(anonymousToken).digest('hex');
      await this.auditService.record({
        cartId: customerCart.id,
        actorType: 'system',
        action: 'cart_merged_from_anon',
        metadata: {
          sourceAnonTokenHash,
          outcome,
          movedLineCount,
          summedLineCount,
        },
      });
    }

    await em.flush();

    return {
      outcome,
      movedLineCount,
      summedLineCount,
      destinationCartId: customerCart.id,
    };
  }

  async clearForCustomer(ctx: CustomerContext): Promise<void> {
    // command-coverage-ignore: empties the ephemeral cart — transient pre-order
    // working state; the resulting order captures the audited final state.
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

/**
 * The {@link ProductAudience} a cart operation speaks for (issue #227).
 *
 * An anonymous cart is the anonymous audience — the token in the cookie
 * identifies a basket, not a buyer, and it is minted by asking for one. A
 * signed-in shopper carries their Organization, `null` included: the guest-style
 * accounts of feature 026 have none, and they are exactly the caller
 * `logged_in_only` distinguishes from the public.
 */
function cartAudience(actor: {
  customer?: CustomerContext;
  anonymousToken?: string;
}): ProductAudience {
  if (!actor.customer) return ANONYMOUS_PRODUCT_AUDIENCE;
  return { organizationId: actor.customer.organizationId, authenticated: true };
}
