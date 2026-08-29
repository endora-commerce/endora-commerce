import { type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { expandUnits, round2 } from './util.js';

/**
 * Buy X units of a specific product, get Y of that product free. For every
 * (X + Y) units of the product, Y are free (the cheapest such units).
 */
export const buyXUnitsYFreeAction: PromotionActionDefinition<ActionConfigFor<'buy_x_units_y_free'>> = {
  type: 'buy_x_units_y_free',
  labelKey: 'action.buy_x_units_y_free',
  apply: (config, ctx) => {
    const units = expandUnits(ctx.lines)
      .filter((u) => u.productId === config.productId)
      .sort((a, b) => a.price - b.price);
    const groupSize = config.buyUnits + config.freeUnits;
    const groups = Math.floor(units.length / groupSize);
    const freeCount = groups * config.freeUnits;
    const delta = round2(units.slice(0, freeCount).reduce((acc, u) => acc + u.price, 0));
    return { discountSubtotalDelta: Math.min(delta, ctx.subtotal), discountDeliveryDelta: 0 };
  },
};
