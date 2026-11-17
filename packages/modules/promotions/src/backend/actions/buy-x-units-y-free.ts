import { type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { compareUnitGross, expandUnits, unitsGross } from './util.js';

/**
 * Buy X units of a specific product, get Y of that product free. For every
 * (X + Y) units of the product, Y are free (the cheapest such units), VAT
 * included (issue #1350).
 */
export const buyXUnitsYFreeAction: PromotionActionDefinition<ActionConfigFor<'buy_x_units_y_free'>> = {
  type: 'buy_x_units_y_free',
  labelKey: 'action.buy_x_units_y_free',
  apply: (config, ctx) => {
    const units = expandUnits(ctx.lines)
      .filter((u) => u.productId === config.productId)
      .sort(compareUnitGross);
    const groupSize = config.buyUnits + config.freeUnits;
    const groups = Math.floor(units.length / groupSize);
    const freeCount = groups * config.freeUnits;
    const delta = unitsGross(units.slice(0, freeCount));
    return { discountSubtotalDelta: Math.min(delta, ctx.grossSubtotal), discountDeliveryDelta: 0 };
  },
};
