import { NO_DISCOUNT, type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { wholeMultiples } from '@endora-commerce/contracts';
import { round2, times } from './util.js';

/**
 * For every X (amount) spent, Y (amount) off the whole cart. The steps count
 * the gross the buyer pays and the amount is capped there (issue #1396).
 */
export const spendXAmountOffAction: PromotionActionDefinition<ActionConfigFor<'spend_x_amount_off'>> = {
  type: 'spend_x_amount_off',
  labelKey: 'action.spend_x_amount_off',
  apply: (config, ctx) => {
    if (config.currency !== ctx.currency) return NO_DISCOUNT;
    const steps = wholeMultiples(ctx.grossSubtotal, config.spendStep);
    if (steps <= 0) return NO_DISCOUNT;
    const delta = Math.min(times(steps, config.amount), ctx.grossSubtotal);
    return { discountSubtotalDelta: round2(Math.max(0, delta)), discountDeliveryDelta: 0 };
  },
};
