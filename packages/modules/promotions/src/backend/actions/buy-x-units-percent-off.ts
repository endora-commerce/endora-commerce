import { NO_DISCOUNT, type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { expandUnits, percentOf, round2 } from './util.js';

/** Buy X units of a specific product → Y% off the whole cart, on the gross (issue #1350). */
export const buyXUnitsPercentOffAction: PromotionActionDefinition<
  ActionConfigFor<'buy_x_units_percent_off'>
> = {
  type: 'buy_x_units_percent_off',
  labelKey: 'action.buy_x_units_percent_off',
  apply: (config, ctx) => {
    const count = expandUnits(ctx.lines).filter((u) => u.productId === config.productId).length;
    if (count < config.buyUnits) return NO_DISCOUNT;
    const delta = Math.min(percentOf(ctx.grossSubtotal, config.percent), ctx.grossSubtotal);
    return { discountSubtotalDelta: round2(Math.max(0, delta)), discountDeliveryDelta: 0 };
  },
};
