import { NO_DISCOUNT, type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { round2 } from './util.js';

/** For every X (amount) spent, Y (amount) off the whole cart. */
export const spendXAmountOffAction: PromotionActionDefinition<ActionConfigFor<'spend_x_amount_off'>> = {
  type: 'spend_x_amount_off',
  labelKey: 'action.spend_x_amount_off',
  apply: (config, ctx) => {
    if (config.currency !== ctx.currency) return NO_DISCOUNT;
    const steps = Math.floor(ctx.subtotal / config.spendStep);
    if (steps <= 0) return NO_DISCOUNT;
    const delta = Math.min(round2(steps * config.amount), ctx.subtotal);
    return { discountSubtotalDelta: round2(Math.max(0, delta)), discountDeliveryDelta: 0 };
  },
};
