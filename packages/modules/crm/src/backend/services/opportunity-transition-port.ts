import type {
  OpportunityCommandPort,
  OpportunityStatusActor,
  OpportunityTransitionOutcome,
  OpportunityTransitionPort,
} from '@endora-commerce/contracts';

/**
 * Moving an Opportunity from another module — the shape `crm` publishes as
 * `opportunityTransitionPort`
 * (`specs/143-crm-sales-opportunities/contracts/events-and-ports.md` §4).
 *
 * **Deprecated since 0.113.0** (`specs/186-aggregate-ports/` US9, OD-4): it
 * delegates to `opportunityCommandPort.transition`, which runs the same
 * Command, guards and events and answers the same outcome, and is removed in
 * 0.114.0. The input `actor` is no longer read — the actor of an aggregate
 * port is the ambient one (R-4), and the cause follows it as this port always
 * derived it, `manual` under an administrator, `system` under none (research
 * R-21.2).
 */
export class OpportunityTransitionPortService implements OpportunityTransitionPort {
  /** The aggregate port's implementation, resolved per call. */
  constructor(private readonly commands: () => Pick<OpportunityCommandPort, 'transition'>) {}

  /** @deprecated since 0.113.0; use {@link OpportunityCommandPort.transition} instead. */
  async applyStatus(input: {
    opportunityId: string;
    to: string;
    actor: OpportunityStatusActor;
    reason?: string | null;
  }): Promise<OpportunityTransitionOutcome> {
    return this.commands().transition(input.opportunityId, { to: input.to, reason: input.reason ?? null });
  }
}
