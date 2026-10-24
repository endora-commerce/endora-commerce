import { type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { expandUnits, percentOf, unitsTotal } from './util.js';

/**
 * Every Nth product in the cart is Y% cheaper. The discounted units are the
 * cheapest `floor(totalUnits / nth)` units (deterministic on ties).
 */
export const everyNthProductPercentOffAction: PromotionActionDefinition<
  ActionConfigFor<'every_nth_product_percent_off'>
> = {
  type: 'every_nth_product_percent_off',
  labelKey: 'action.every_nth_product_percent_off',
  apply: (config, ctx) => {
    const units = expandUnits(ctx.lines).sort((a, b) => a.price - b.price);
    const count = Math.floor(units.length / config.nth);
    // The discounted units' prices summed exactly, then the percentage taken once.
    const delta = percentOf(unitsTotal(units.slice(0, count)), config.percent);
    return { discountSubtotalDelta: Math.min(delta, ctx.subtotal), discountDeliveryDelta: 0 };
  },
};
