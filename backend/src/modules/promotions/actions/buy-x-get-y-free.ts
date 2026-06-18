import { type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { expandUnits, round2 } from './util.js';

/**
 * Buy X get Y free across the whole cart. For every (X + Y) units the cart
 * holds, Y units are free; the discounted units are the cheapest or the most
 * expensive depending on `target`. Ties are resolved by the stable sort.
 */
export const buyXGetYFreeAction: PromotionActionDefinition<ActionConfigFor<'buy_x_get_y_free'>> = {
  type: 'buy_x_get_y_free',
  labelKey: 'action.buy_x_get_y_free',
  apply: (config, ctx) => {
    const units = expandUnits(ctx.lines).sort((a, b) =>
      config.target === 'cheapest' ? a.price - b.price : b.price - a.price,
    );
    const groupSize = config.buyQuantity + config.freeQuantity;
    const groups = Math.floor(units.length / groupSize);
    const freeCount = groups * config.freeQuantity;
    const delta = round2(units.slice(0, freeCount).reduce((acc, u) => acc + u.price, 0));
    return { discountSubtotalDelta: Math.min(delta, ctx.subtotal), discountDeliveryDelta: 0 };
  },
};
