import { NO_DISCOUNT, type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { expandUnits, round2 } from './util.js';

/** Buy X units of a specific product → Y (amount) off the whole cart. */
export const buyXUnitsAmountOffAction: PromotionActionDefinition<
  ActionConfigFor<'buy_x_units_amount_off'>
> = {
  type: 'buy_x_units_amount_off',
  labelKey: 'action.buy_x_units_amount_off',
  apply: (config, ctx) => {
    if (config.currency !== ctx.currency) return NO_DISCOUNT;
    const count = expandUnits(ctx.lines).filter((u) => u.productId === config.productId).length;
    if (count < config.buyUnits) return NO_DISCOUNT;
    return {
      discountSubtotalDelta: round2(Math.min(config.amount, ctx.subtotal)),
      discountDeliveryDelta: 0,
    };
  },
};
