import { NO_DISCOUNT, type ActionConfigFor, type PromotionActionDefinition } from './types.js';
import { round2 } from './util.js';

/**
 * Y (amount) off the whole cart, capped at the gross the buyer pays (issue
 * #1396): it can make the goods free, VAT included. Skips on currency mismatch.
 */
export const amountOffCartAction: PromotionActionDefinition<ActionConfigFor<'amount_off_cart'>> = {
  type: 'amount_off_cart',
  labelKey: 'action.amount_off_cart',
  apply: (config, ctx) => {
    if (config.currency !== ctx.currency) return NO_DISCOUNT;
    return {
      discountSubtotalDelta: round2(Math.min(config.amount, ctx.grossSubtotal)),
      discountDeliveryDelta: 0,
    };
  },
};
