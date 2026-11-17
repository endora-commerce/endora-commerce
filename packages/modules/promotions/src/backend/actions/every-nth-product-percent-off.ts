import { type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { compareUnitGross, expandUnits, percentOf, unitsGross } from './util.js';

/**
 * Every Nth product in the cart is Y% cheaper. The discounted units are the
 * cheapest `floor(totalUnits / nth)` units (deterministic on ties), and the
 * percentage is taken of what the buyer pays for them, the gross (issue #1350).
 */
export const everyNthProductPercentOffAction: PromotionActionDefinition<
  ActionConfigFor<'every_nth_product_percent_off'>
> = {
  type: 'every_nth_product_percent_off',
  labelKey: 'action.every_nth_product_percent_off',
  apply: (config, ctx) => {
    const units = expandUnits(ctx.lines).sort(compareUnitGross);
    const count = Math.floor(units.length / config.nth);
    // The discounted units' gross, per rate on their net sum, then the percentage taken once.
    const delta = percentOf(unitsGross(units.slice(0, count)), config.percent);
    return { discountSubtotalDelta: Math.min(delta, ctx.grossSubtotal), discountDeliveryDelta: 0 };
  },
};
