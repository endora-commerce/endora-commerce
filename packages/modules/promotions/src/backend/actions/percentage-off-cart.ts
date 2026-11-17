import type { ActionConfigFor, PromotionActionDefinition } from './types.js';
import { percentOf, round2 } from './util.js';

/** X% off what the buyer pays for the goods — the gross (issue #1350). */
export const percentageOffCartAction: PromotionActionDefinition<ActionConfigFor<'percentage_off_cart'>> = {
  type: 'percentage_off_cart',
  labelKey: 'action.percentage_off_cart',
  apply: (config, ctx) => {
    const delta = Math.min(percentOf(ctx.grossSubtotal, config.percent), ctx.grossSubtotal);
    return { discountSubtotalDelta: round2(Math.max(0, delta)), discountDeliveryDelta: 0 };
  },
};
