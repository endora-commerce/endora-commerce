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
 *
 * **The rule is one credit per return case (D-91).** This adapter used to read
 * the grant and adjust it to `granted + amount`, ignoring the `returnCaseId`
 * the input has always carried, so a settlement retried after a later step
 * refused credited the organization a second time. The rule now lives in
 * `CreditLimitService.creditFromReturn`, where the credit and the record of it
 * are written by one Command in one transaction; this class is back to being
 * the shape adapter it reads as.
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
    const outcome = await this.creditLimitService().creditFromReturn({
      organizationId: input.organizationId,
      amount: input.amount,
      currency: input.currency,
      returnCaseId: input.returnCaseId,
    });
    return {
      applied: outcome.applied,
      ...(outcome.availableAmountAfter !== undefined
        ? { availableAmountAfter: outcome.availableAmountAfter }
        : {}),
    };
  }
}
