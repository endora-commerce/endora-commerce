import { NO_DISCOUNT, type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { compareDecimals, decimalProduct, wholeMultiples } from '@endora-commerce/contracts';
import { percentOf, round2 } from './util.js';

/** For every X (amount) spent, Y% off the whole cart (capped at 100%). */
export const spendXPercentOffAction: PromotionActionDefinition<ActionConfigFor<'spend_x_percent_off'>> = {
  type: 'spend_x_percent_off',
  labelKey: 'action.spend_x_percent_off',
  apply: (config, ctx) => {
    if (config.currency !== ctx.currency) return NO_DISCOUNT;
    const steps = wholeMultiples(ctx.subtotal, config.spendStep);
    if (steps <= 0) return NO_DISCOUNT;
    // Exact (issue #417): 3 × 0.15 is the double 0.44999999999999996.
    const stepped = decimalProduct(steps, config.percent);
    const percent = compareDecimals(stepped, 100) > 0 ? '100' : stepped;
    const delta = Math.min(percentOf(ctx.subtotal, percent), ctx.subtotal);
    return { discountSubtotalDelta: round2(Math.max(0, delta)), discountDeliveryDelta: 0 };
  },
};
