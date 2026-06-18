import type { CartLine, PromotionAction } from '@b2b/contracts';

/**
 * The cart facts an action operates on. The engine clamps the returned
 * deltas so nothing goes below zero; individual actions also cap their own
 * subtotal delta at `ctx.subtotal` defensively (FR-015).
 */
export interface CartApplyContext {
  lines: readonly CartLine[];
  subtotal: number;
  deliveryTotal: number;
  currency: string;
}

export interface DiscountResult {
  /** Amount removed from the cart subtotal (≥ 0). */
  discountSubtotalDelta: number;
  /** Amount removed from delivery (≥ 0; used by free_delivery). */
  discountDeliveryDelta: number;
  /** Optional per-line attribution for display/debug. */
  perLine?: { productId: string; variantId: string | null; amount: number }[];
}

/** Narrow the action union to the variant a definition handles. */
export type ActionConfigFor<T extends PromotionAction['type']> = Extract<PromotionAction, { type: T }>;

/** A registrable promotion action — built-in or contributed by another module (FR-012). */
export interface PromotionActionDefinition<C extends PromotionAction = PromotionAction> {
  type: C['type'];
  /** i18n key for the admin action picker. */
  labelKey: string;
  apply(config: C, ctx: CartApplyContext): DiscountResult;
}

export const NO_DISCOUNT: DiscountResult = { discountSubtotalDelta: 0, discountDeliveryDelta: 0 };
