import type { EntityManager } from '@mikro-orm/postgresql';
import type { CartSnapshot, CouponDropReason } from '@b2b/contracts';
import { Cart } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { Promotion } from '../../promotions/entities/promotion.entity.js';
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
   */
  async apply(cart: Cart, code: string | null): Promise<CouponApplyResult> {
    if (code === null) {
      await this.clear(cart);
      return { outcome: 'applied', cart, appliedCode: '' };
    }

    const em = this.emFactory();

    // Resolve the promotion row by code so we can build the reason-specific
    // drop response (the snapshot's eligibility filter inside applyToCart
    // is opaque to callers, so we re-implement the precondition checks
    // here for the reason mapping).
    const promotion = await em.findOne(Promotion, { code, isActive: true });
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
    if (promotion.organizationId && promotion.organizationId !== cart.organizationId) {
      return { outcome: 'dropped', reason: 'wrong_organization' };
    }

    const items = await em.find(CartItem, { cartId: cart.id });
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

    cart.appliedPromotionCode = code;
    cart.lastActivityAt = new Date();
    await em.flush();
    if (this.approvalService && cart.customerAccountId) {
      await this.approvalService.maybeReArm(cart, {
        customerAccountId: cart.customerAccountId,
      });
    }
    return { outcome: 'applied', cart, appliedCode: code };
  }

  async clear(cart: Cart): Promise<void> {
    if (cart.appliedPromotionCode === null) return;
    const em = this.emFactory();
    cart.appliedPromotionCode = null;
    cart.lastActivityAt = new Date();
    await em.flush();
    if (this.approvalService && cart.customerAccountId) {
      await this.approvalService.maybeReArm(cart, {
        customerAccountId: cart.customerAccountId,
      });
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
    const promotion = await em.findOne(Promotion, { code, isActive: true });
    if (!promotion) {
      cart.appliedPromotionCode = null;
      await em.flush();
      return { dropped: { code, reason: 'invalid_code' } };
    }

    const now = new Date();
    if (
      (promotion.validFrom && now < promotion.validFrom) ||
      (promotion.validUntil && now > promotion.validUntil)
    ) {
      cart.appliedPromotionCode = null;
      await em.flush();
      return { dropped: { code, reason: 'expired' } };
    }

    const subtotal = items.reduce(
      (acc, it) => acc + Number(it.unitPrice) * it.quantity,
      0,
    );

    if (promotion.minCartSubtotal != null) {
      const min = Number(promotion.minCartSubtotal);
      if (min > subtotal) {
        cart.appliedPromotionCode = null;
        await em.flush();
        return { dropped: { code, reason: 'below_min_spend' } };
      }
    }

    return { dropped: null };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
