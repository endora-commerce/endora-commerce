import type {
  CreditTopupInput,
  CreditTopupPort,
  CreditTopupResult,
} from '../../returns/ports/credit-topup.port.js';
import type { CreditLimitService } from './credit-limit-service.js';

/**
 * Credit-limits-side implementation of the returns module's `CreditTopupPort`
 * (feature 046, R7). A "credit toward future orders" resolution increases the
 * organization's credit-limit grant by the refund amount; the credit_limits
 * checkout credit-check already provides redemption. Returns `applied: false`
 * when the organization has no grant.
 */
export class CreditTopupProvider implements CreditTopupPort {
  constructor(private readonly creditLimitService: CreditLimitService) {}

  async creditFromReturn(input: CreditTopupInput): Promise<CreditTopupResult> {
    const current = await this.creditLimitService.getForOrganization(input.organizationId);
    if (!current) return { applied: false };
    const newAmount = round2(Number(current.grantedAmount) + input.amount);
    const res = await this.creditLimitService.adjust({
      organizationId: input.organizationId,
      grantedAmount: newAmount,
      allowOverAllocation: true,
    });
    if (!res.ok) return { applied: false };
    return { applied: true, availableAmountAfter: newAmount };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
