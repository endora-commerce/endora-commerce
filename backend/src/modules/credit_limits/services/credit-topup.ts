import type { CreditTopupInput, CreditTopupPort, CreditTopupResult } from '@b2b/contracts';
import type { CreditLimitService } from './credit-limit-service.js';

/**
 * Credit-limits-side implementation of the returns module's `CreditTopupPort`
 * (feature 046, R7). The three declarations are read from `@b2b/contracts`,
 * where Phase P published them: `returns` still states the shape and this
 * module still satisfies it, but neither names a file in the other's directory
 * (feature 075, Phase C). A "credit toward future orders" resolution increases the
 * organization's credit-limit grant by the refund amount; the credit_limits
 * checkout credit-check already provides redemption. Returns `applied: false`
 * when the organization has no grant.
 */
export class CreditTopupProvider implements CreditTopupPort {
  /**
   * The service arrives as an accessor, not as an instance: `creditLimitService`
   * is a gated port, and a composition root that resolves it while wiring this
   * provider asks about `credit_limits`' effective state at boot — which is how
   * switching the module off used to stop the whole backend from starting. Read
   * per settlement, the gate answers at the call it is about.
   */
  constructor(private readonly creditLimitService: () => CreditLimitService) {}

  async creditFromReturn(input: CreditTopupInput): Promise<CreditTopupResult> {
    const creditLimits = this.creditLimitService();
    const current = await creditLimits.getForOrganization(input.organizationId);
    if (!current) return { applied: false };
    const newAmount = round2(Number(current.grantedAmount) + input.amount);
    const res = await creditLimits.adjust({
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
