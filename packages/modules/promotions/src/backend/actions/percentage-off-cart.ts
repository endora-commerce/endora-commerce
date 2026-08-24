import type { ActionConfigFor, PromotionActionDefinition } from './types.js';
import { round2 } from './util.js';

/** X% off the whole cart subtotal. */
export const percentageOffCartAction: PromotionActionDefinition<ActionConfigFor<'percentage_off_cart'>> = {
  type: 'percentage_off_cart',
  labelKey: 'action.percentage_off_cart',
  apply: (config, ctx) => {
    const delta = Math.min(round2((ctx.subtotal * config.percent) / 100), ctx.subtotal);
    return { discountSubtotalDelta: round2(Math.max(0, delta)), discountDeliveryDelta: 0 };
  },
};
