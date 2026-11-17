import { type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { compareUnitGross, expandUnits, unitsGross } from './util.js';

/**
 * Buy X get Y free across the whole cart. For every (X + Y) units the cart
 * holds, Y units are free; the discounted units are the cheapest or the most
 * expensive depending on `target`. Ties are resolved by the stable sort. A free
 * unit is free VAT included, and "cheapest" is the cheapest gross (issue #1350).
 */
export const buyXGetYFreeAction: PromotionActionDefinition<ActionConfigFor<'buy_x_get_y_free'>> = {
  type: 'buy_x_get_y_free',
  labelKey: 'action.buy_x_get_y_free',
  apply: (config, ctx) => {
    const units = expandUnits(ctx.lines).sort((a, b) =>
      config.target === 'cheapest' ? compareUnitGross(a, b) : compareUnitGross(b, a),
    );
    const groupSize = config.buyQuantity + config.freeQuantity;
    const groups = Math.floor(units.length / groupSize);
    const freeCount = groups * config.freeQuantity;
    const delta = unitsGross(units.slice(0, freeCount));
    return { discountSubtotalDelta: Math.min(delta, ctx.grossSubtotal), discountDeliveryDelta: 0 };
  },
};
