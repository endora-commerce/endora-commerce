import { NO_DISCOUNT, type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { round2 } from './util.js';

/** For every X (amount) spent, Y% off the whole cart (capped at 100%). */
export const spendXPercentOffAction: PromotionActionDefinition<ActionConfigFor<'spend_x_percent_off'>> = {
  type: 'spend_x_percent_off',
  labelKey: 'action.spend_x_percent_off',
  apply: (config, ctx) => {
    if (config.currency !== ctx.currency) return NO_DISCOUNT;
    const steps = Math.floor(ctx.subtotal / config.spendStep);
    if (steps <= 0) return NO_DISCOUNT;
    const percent = Math.min(steps * config.percent, 100);
    const delta = Math.min(round2((ctx.subtotal * percent) / 100), ctx.subtotal);
    return { discountSubtotalDelta: round2(Math.max(0, delta)), discountDeliveryDelta: 0 };
  },
};
