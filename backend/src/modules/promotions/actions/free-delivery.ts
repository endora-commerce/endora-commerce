import type { ActionConfigFor, PromotionActionDefinition } from './types.js';
import { round2 } from './util.js';

/** Zero the cart's delivery cost. */
export const freeDeliveryAction: PromotionActionDefinition<ActionConfigFor<'free_delivery'>> = {
  type: 'free_delivery',
  labelKey: 'action.free_delivery',
  apply: (_config, ctx) => ({
    discountSubtotalDelta: 0,
    discountDeliveryDelta: round2(ctx.deliveryTotal),
  }),
};
