import { NO_DISCOUNT, type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { expandUnits, round2 } from './util.js';

/** Buy X units of a specific product → Y% off the whole cart. */
export const buyXUnitsPercentOffAction: PromotionActionDefinition<
  ActionConfigFor<'buy_x_units_percent_off'>
> = {
  type: 'buy_x_units_percent_off',
  labelKey: 'action.buy_x_units_percent_off',
  apply: (config, ctx) => {
    const count = expandUnits(ctx.lines).filter((u) => u.productId === config.productId).length;
    if (count < config.buyUnits) return NO_DISCOUNT;
    const delta = Math.min(round2((ctx.subtotal * config.percent) / 100), ctx.subtotal);
    return { discountSubtotalDelta: round2(Math.max(0, delta)), discountDeliveryDelta: 0 };
  },
};
