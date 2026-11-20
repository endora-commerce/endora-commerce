import { moneySum, type CreditAvailabilityReadPort } from '@endora-commerce/contracts';
import type { CreditLimitService } from './credit-limit-service.js';
import { availableCredit } from './credit-money.js';

/**
 * `creditAvailabilityReadPort` — an Organization's available credit, computed as
 * `GET /api/v1/me/credit-limit` computes it (`routes.ts` `serializeView`): the grant
 * `getForOrganization` resolves under the inheritance rule, less its active reservations.
 * One computation, so the payer's figure at checkout and the payer's own widget agree.
 */
export class CreditAvailabilityReadService implements CreditAvailabilityReadPort {
  constructor(private readonly service: () => CreditLimitService) {}

  async availableFor(organizationId: string): Promise<{ availableAmount: number; currency: string } | null> {
    const service = this.service();
    const limit = await service.getForOrganization(organizationId);
    if (!limit) return null;
    const reservations = await service.listActiveReservations(limit.id);
    const reserved = moneySum(reservations.map((r) => r.amount));
    return { availableAmount: Number(availableCredit(limit.grantedAmount, reserved)), currency: limit.currency };
  }
}
