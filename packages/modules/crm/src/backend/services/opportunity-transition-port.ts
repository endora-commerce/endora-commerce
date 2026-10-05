import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type OpportunityStatusActor,
  type OpportunityTransitionOutcome,
  type OpportunityTransitionPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { isUuid } from './opportunity-access.js';
import type { OpportunityTransitionService } from './opportunity-transition-service.js';
import type { WorkflowReadService } from './workflow-read-service.js';

/**
 * Moving an Opportunity from another module — the shape `crm` publishes as
 * `opportunityTransitionPort`
 * (`specs/143-crm-sales-opportunities/contracts/events-and-ports.md` §4).
 *
 * `OpportunityTransitionService` is the seam itself; this is how it is
 * published: no entity, no EntityManager, and **a refusal expressed as a
 * value**, deliberately in the shape of `orders`' `OrderTransitionPort`.
 *
 * **The workflow is consulted before `apply`, not after it.** `apply` raises a
 * 409 for a missing edge and another 409 for a guard's veto; deciding
 * `unknown_status` and `not_permitted` against the graph up front leaves the
 * `catch` below with exactly one meaning, so the two stay distinguishable.
 *
 * The Opportunity is read through the scoped EntityManager: one outside the
 * caller's tenant scope is `not_found`, the same as one that does not exist.
 */
export class OpportunityTransitionPortService implements OpportunityTransitionPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly workflowRead: WorkflowReadService,
    private readonly opportunityTransitions: OpportunityTransitionService,
  ) {}

  async applyStatus(input: {
    opportunityId: string;
    to: string;
    actor: OpportunityStatusActor;
    reason?: string | null;
  }): Promise<OpportunityTransitionOutcome> {
    const { opportunityId, to, actor } = input;
    const missing: OpportunityTransitionOutcome = {
      applied: false,
      reason: 'not_found',
      from: null,
      detail: `No opportunity ${opportunityId}.`,
    };
    if (!isUuid(opportunityId)) return missing;
    const opportunity = await this.emFactory().findOne(CrmOpportunity, { id: opportunityId });
    if (!opportunity) return missing;

    // Read before the write: once `apply` has moved it, `from` is gone.
    const from = opportunity.statusCode;
    if (from === to) return { applied: false, reason: 'already_there', from };

    const graph = await this.workflowRead.loadGraph();
    if (!graph.has(to)) {
      return {
        applied: false,
        reason: 'unknown_status',
        from,
        detail: `"${to}" is not a configured opportunity status.`,
      };
    }
    if (!graph.canTransition(from, to)) {
      return {
        applied: false,
        reason: 'not_permitted',
        from,
        detail: `The configured workflow has no transition from "${from}" to "${to}".`,
      };
    }

    try {
      await this.opportunityTransitions.apply(opportunityId, to, {
        actor,
        cause: actor.kind === 'admin' ? 'manual' : 'system',
        reason: input.reason ?? null,
      });
    } catch (error) {
      // The one tolerance this port exists for: with the graph consulted
      // above, a `CRM_TRANSITION_VETOED` left here is a guard's decision,
      // which the caller must be able to read as a value. A module switched
      // off underneath the guards is not a veto — `ModuleDisabledError` is an
      // `HttpError` too, and swallowing it would turn fail-closed into
      // fail-open — so it is rethrown first. Everything else, a concurrent
      // move included, is the caller's to see as thrown.
      rethrowIfModuleDisabled(error);
      if (error instanceof HttpError && error.code === ERROR_CODES.CRM_TRANSITION_VETOED) {
        return { applied: false, reason: 'vetoed', from, detail: error.message };
      }
      throw error;
    }
    return { applied: true, from, to };
  }
}
