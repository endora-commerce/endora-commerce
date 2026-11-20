import type { OrderTransitionEffectService } from './order-transition-effect-service.js';
import type { OrderPaymentSettlementEffectsPort } from '../../ports/index.js';

/**
 * `orderPaymentSettlementEffectsPort` — attempts a payment-status settlement's
 * recorded follow-up after commit.
 *
 * `orderPaymentStatusApplyPort` records the obligation on the settlement
 * transaction. This drain uses its own `EntityManager` and must run **after**
 * that transaction commits (issue #200). Payments never touches
 * `OrderTransitionEffectService` or `CreditLimitPort` directly — both stay
 * inside `orders` (Constitution I).
 */
export class OrderPaymentSettlementEffectsService
  implements OrderPaymentSettlementEffectsPort
{
  constructor(
    private readonly transitionEffects: OrderTransitionEffectService,
  ) {}

  async drainForOrder(orderId: string): Promise<void> {
    await this.transitionEffects.drainForOrder(orderId);
  }
}
