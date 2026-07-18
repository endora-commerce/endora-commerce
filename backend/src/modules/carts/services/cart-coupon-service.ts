import type { EntityManager } from '@mikro-orm/postgresql';
import type { CartSnapshot, CouponDropReason, PromotionApplication } from '@b2b/contracts';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { Promotion } from '../../promotions/entities/promotion.entity.js';
import { PromotionCoupon } from '../../promotions/entities/promotion-coupon.entity.js';
import type { PromotionService } from '../../promotions/services/promotion-service.js';
import type { CartApprovalService } from './cart-approval-service.js';

/**
 * Cart-level coupon application (feature 027 US2).
 *
 * Plumbs the buyer's coupon code through `PromotionService.applyToCart`:
 *   - `apply(cart, code)` writes the code on the cart and asks the
 *     promotion engine whether the named promotion would stick. If yes,
 *     the discount is reflected via the recomputed snapshot the caller
 *     returns to the buyer. If no, the cart's previous code (if any) is
 *     preserved and a typed `CouponApplyResult.dropped` is returned
 *     identifying the precise reason from the snapshot's eligibility
 *     filter.
 *   - `clear(cart)` removes the active code. Idempotent.
 *   - `reevaluateOnRead(cart, snapshot)` is called from the GET-cart
 *     read path. If a previously-applied code is no longer eligible
 *     (e.g. the cart fell below `min_cart_subtotal` after a line
 *     removal), the code is silently dropped and the caller can surface
 *     `couponDroppedThisRead` in the response.
 *
 * The service never mutates promotion rows — only `cart.applied_promotion_code`.
 */

export interface CouponApplyOk {
  outcome: 'applied';
  cart: Cart;
  appliedCode: string;
}

export interface CouponApplyDropped {
  outcome: 'dropped';
  reason: CouponDropReason;
  shortfall?: { amount: number; currency: string };
}

export type CouponApplyResult = CouponApplyOk | CouponApplyDropped;

export interface CouponReevaluateResult {
  /** When non-null, the read path should populate `couponDroppedThisRead`. */
  dropped: { code: string; reason: CouponDropReason } | null;
}

export class CartCouponService {
  /**
   * `approvalService` is optional — when wired, applying or clearing a
   * coupon on an `approved` cart re-arms approval to `pending`. Legacy
   * compositions without the approval surface omit it (re-arm is a
   * no-op when absent).
   */
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly promotionService: PromotionService,
    private readonly approvalService?: CartApprovalService,
  ) {}

  /**
   * Apply (or replace) the active coupon on the cart. Validates against
   * the promotion engine using the current cart contents.
   *
   * `code === null` clears any active coupon (use the `clear` alias for
   * readability — both are equivalent).
   *
   * Note: the cart passed in may have been loaded by a different
   * EntityManager fork. We re-load it on our own fork so the
   * `appliedPromotionCode` mutation flushes to the DB and the
   * caller's in-memory cart is also updated.
   */
  async apply(cart: Cart, code: string | null): Promise<CouponApplyResult> {
    // command-coverage-ignore: transient cart coupon state — the durable applied
    // promotion is captured on the order at checkout (audited there); the cart is
    // ephemeral pre-order working state.
    if (code === null) {
      await this.clear(cart);
      return { outcome: 'applied', cart, appliedCode: '' };
    }

    const em = this.emFactory();
    const managedCart = await em.findOne(Cart, { id: cart.id });
    if (!managedCart) {
      return { outcome: 'dropped', reason: 'invalid_code' };
    }

    // Resolve the promotion row by code so we can build the reason-specific
    // drop response (the snapshot's eligibility filter inside applyToCart
    // is opaque to callers, so we re-implement the precondition checks
    // here for the reason mapping).
    const promotion = await this.resolvePromotionByCode(em, code);
    if (!promotion) {
      return { outcome: 'dropped', reason: 'invalid_code' };
    }

    const now = new Date();
    if (promotion.validFrom && now < promotion.validFrom) {
      return { outcome: 'dropped', reason: 'expired' };
    }
    if (promotion.validUntil && now > promotion.validUntil) {
      return { outcome: 'dropped', reason: 'expired' };
    }
    if (promotion.organizationId && promotion.organizationId !== managedCart.organizationId) {
      return { outcome: 'dropped', reason: 'wrong_organization' };
    }

    const items = await em.find(CartItem, { cartId: managedCart.id });
    const subtotal = items.reduce(
      (acc, it) => acc + Number(it.unitPrice) * it.quantity,
      0,
    );
    const currency = items[0]?.currency ?? 'PLN';

    if (promotion.minCartSubtotal != null) {
      const min = Number(promotion.minCartSubtotal);
      if (min > subtotal) {
        return {
          outcome: 'dropped',
          reason: 'below_min_spend',
          shortfall: { amount: round2(min - subtotal), currency },
        };
      }
    }

    // Double-check via the promotion engine — this catches any criteria
    // we don't replicate here (e.g. attribute/category rules from
    // feature 012).
    const snapshot: CartSnapshot = {
      organizationId: cart.organizationId ?? null,
      customerGroupId: null,
      currency,
      lines: items.map((it) => ({
        productId: it.productId,
        variantId: it.variantId ?? null,
        // Feature 012 / US8 category criteria — hydrated by the engine
        // when needed. Empty seed keeps the contract satisfied.
        categoryIds: [],
        quantity: it.quantity,
        unitPrice: { amount: Number(it.unitPrice), currency: it.currency },
      })),
      deliveryTotal: 0,
      promotionCode: code,
    };

    const application = await this.promotionService.applyToCart(snapshot);
    const stuck = application.appliedPromotions.some((ap) => ap.promotionId === promotion.id);
    if (!stuck) {
      // Eligible by the local pre-checks but rejected by the engine's
      // criteria — bucket as `wrong_customer_group` since that's the
      // most common criterion we don't pre-check here. (The promotion
      // engine doesn't expose a typed reason, so this is the best
      // generic mapping.)
      return { outcome: 'dropped', reason: 'wrong_customer_group' };
    }

    managedCart.appliedPromotionCode = code;
    managedCart.lastActivityAt = new Date();
    await em.flush();
    // Mirror the persisted mutation onto the caller's in-memory cart so
    // serializeCart in the route handler reflects it without re-reading.
    cart.appliedPromotionCode = code;
    cart.lastActivityAt = managedCart.lastActivityAt;
    if (this.approvalService && managedCart.customerAccountId) {
      await this.approvalService.maybeReArm(managedCart, {
        customerAccountId: managedCart.customerAccountId,
      });
      cart.approvalStatus = managedCart.approvalStatus;
    }
    return { outcome: 'applied', cart, appliedCode: code };
  }

  /**
   * Feature 045 — compute the promotion application for a cart on read, so
   * the serialized cart can show the real discount amount + per-promotion
   * breakdown (automatic action-based promotions plus any applied coupon).
   * Pure read — never mutates the cart.
   */
  async computeApplication(cart: Cart, items: CartItem[]): Promise<PromotionApplication> {
    const currency = items[0]?.currency ?? 'PLN';
    const snapshot: CartSnapshot = {
      organizationId: cart.organizationId ?? null,
      customerGroupId: null,
      currency,
      lines: items.map((it) => ({
        productId: it.productId,
        variantId: it.variantId ?? null,
        categoryIds: [],
        quantity: it.quantity,
        unitPrice: { amount: Number(it.unitPrice), currency: it.currency },
      })),
      deliveryTotal: 0,
      promotionCode: cart.appliedPromotionCode ?? null,
      salesChannelId: cart.salesChannelId ?? null,
    };
    return this.promotionService.applyToCart(snapshot);
  }

  async clear(cart: Cart): Promise<void> {
    // command-coverage-ignore: transient cart coupon state (see apply()).
    if (cart.appliedPromotionCode === null) return;
    const em = this.emFactory();
    const managedCart = await em.findOne(Cart, { id: cart.id });
    if (!managedCart) return;
    managedCart.appliedPromotionCode = null;
    managedCart.lastActivityAt = new Date();
    await em.flush();
    cart.appliedPromotionCode = null;
    cart.lastActivityAt = managedCart.lastActivityAt;
    if (this.approvalService && managedCart.customerAccountId) {
      await this.approvalService.maybeReArm(managedCart, {
        customerAccountId: managedCart.customerAccountId,
      });
      cart.approvalStatus = managedCart.approvalStatus;
    }
  }

  /**
   * Called from the GET-cart read path. If a previously-applied code is
   * no longer eligible (e.g. the cart fell below `min_cart_subtotal`),
   * silently drops it on the cart record and returns a typed result the
   * caller can surface as `couponDroppedThisRead` in the response.
   */
  async reevaluateOnRead(
    cart: Cart,
    items: CartItem[],
  ): Promise<CouponReevaluateResult> {
    if (!cart.appliedPromotionCode) return { dropped: null };
    const code = cart.appliedPromotionCode;

    const em = this.emFactory();
    const promotion = await this.resolvePromotionByCode(em, code);
    if (!promotion) {
      await this.persistDrop(em, cart);
      return { dropped: { code, reason: 'invalid_code' } };
    }

    const now = new Date();
    if (
      (promotion.validFrom && now < promotion.validFrom) ||
      (promotion.validUntil && now > promotion.validUntil)
    ) {
      await this.persistDrop(em, cart);
      return { dropped: { code, reason: 'expired' } };
    }

    const subtotal = items.reduce(
      (acc, it) => acc + Number(it.unitPrice) * it.quantity,
      0,
    );

    if (promotion.minCartSubtotal != null) {
      const min = Number(promotion.minCartSubtotal);
      if (min > subtotal) {
        await this.persistDrop(em, cart);
        return { dropped: { code, reason: 'below_min_spend' } };
      }
    }

    return { dropped: null };
  }

  /**
   * Persists a coupon drop. The caller's `cart` entity may belong to a
   * different EntityManager fork; we reload on our own fork, mutate, and
   * also mirror the change onto the caller's in-memory cart so the
   * read-side serializer sees the dropped coupon.
   */
  /**
   * Resolve a presented code to its active Promotion — first via the legacy
   * `promotions.code` column, then via the feature-045 `promotion_coupons`
   * table.
   */
  private async resolvePromotionByCode(em: EntityManager, code: string): Promise<Promotion | null> {
    const byLegacy = await em.findOne(Promotion, { code, isActive: true });
    if (byLegacy) return byLegacy;
    const coupon = await em.findOne(PromotionCoupon, { code, isActive: true });
    if (!coupon) return null;
    return em.findOne(Promotion, { id: coupon.promotionId, isActive: true });
  }

  private async persistDrop(em: EntityManager, cart: Cart): Promise<void> {
    // command-coverage-ignore: transient cart coupon state (see apply()).
    const managed = await em.findOne(Cart, { id: cart.id });
    if (!managed) return;
    managed.appliedPromotionCode = null;
    await em.flush();
    cart.appliedPromotionCode = null;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
