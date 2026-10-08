import type { EntityManager } from '@mikro-orm/postgresql';
import {
  OriginReferenceSchema,
  type AdminTenantScopePort,
  type OpportunityDocumentKind,
  type OriginReference,
} from '@endora-commerce/contracts';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import type { OpportunityLinkService } from './opportunity-link-service.js';

/**
 * The `origin.type` this module answers to. The create screens of `orders` and
 * `quote_requests` send it when they were opened from an Opportunity; neither
 * of those modules knows the word.
 */
export const CRM_OPPORTUNITY_ORIGIN_TYPE = 'crm_opportunity';

/**
 * The `origin` of an event payload the bus hands over untyped, or `null` when
 * the event carries none — or carries something that is not one.
 */
export function readEventOrigin(payload: unknown): OriginReference | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const parsed = OriginReferenceSchema.safeParse((payload as Record<string, unknown>)['origin']);
  return parsed.success ? parsed.data : null;
}

/** A document that has just been created, as its owner's read port answered it. */
export interface OriginatedDocument {
  kind: OpportunityDocumentKind;
  id: string;
  organizationId: string;
  /**
   * The administrator who created it, where the event names one. Only
   * `rfq.created_by_admin.v1` does; `order.created.v1` carries no actor.
   */
  createdByAdminUserId: string | null;
}

/**
 * What became of an origin:
 *
 * - `linked` / `already-linked` — the document belongs to an Opportunity, so
 *   nothing more is to be done for it;
 * - `not-ours` — the origin is of a type this module does not know;
 * - `refused` — it names an Opportunity, and the link was not made.
 *
 * After the last two the document is handled as one that had no origin.
 */
export type OriginLinkOutcome = 'linked' | 'already-linked' | 'not-ours' | 'refused';

export interface OpportunityOriginLinkServiceDeps {
  emFactory: () => EntityManager;
  links: Pick<OpportunityLinkService, 'linkAutomatically'>;
  /** `organizations`' answer to "which Organizations may this administrator reach" — lazy. */
  adminScope: AdminTenantScopePort;
  /** A refusal is said to the operator's log and to nobody else. */
  warn: (fields: Record<string, unknown>, message: string) => void;
}

/**
 * Links a document to the Opportunity it was created from (User Story 10,
 * FR-026).
 *
 * The `origin` arrives on an event and was typed into a create request, so it
 * is **a claim, not a fact**: `orders` and `quote_requests` validate its shape
 * and hand it on unread. This service is where the claim is checked, and it
 * runs in the subscriber's system scope — nothing filters its reads — so every
 * rule is stated here:
 *
 * 1. the Opportunity exists;
 * 2. it belongs to **the same Organization as the document**. That is what
 *    keeps a link from crossing a tenant, whatever id a request carried;
 * 3. where the event names the administrator who created the document, that
 *    administrator can reach the Opportunity's Organization.
 *
 * A claim that fails is answered `refused`, with one line in the log and
 * nothing to the caller: the document was created and its creator learns
 * nothing about an Opportunity they named and may not see — a missing one and
 * one out of reach are one answer.
 *
 * The write is the link service's `linkAutomatically`: one Command, idempotent
 * on the unique `(document_kind, document_id)` constraint, so an event
 * delivered twice links once.
 */
export class OpportunityOriginLinkService {
  constructor(private readonly deps: OpportunityOriginLinkServiceDeps) {}

  async link(origin: OriginReference, document: OriginatedDocument): Promise<OriginLinkOutcome> {
    if (origin.type !== CRM_OPPORTUNITY_ORIGIN_TYPE) return 'not-ours';

    const opportunity = await this.deps.emFactory().findOne(CrmOpportunity, { id: origin.id });
    if (!opportunity || opportunity.organizationId !== document.organizationId) {
      return this.#refuse(origin, document, 'no such opportunity for the organization of the document');
    }
    if (
      document.createdByAdminUserId !== null &&
      !(await this.#canReach(document.createdByAdminUserId, opportunity.organizationId))
    ) {
      return this.#refuse(origin, document, 'the opportunity is out of reach of the administrator who created the document');
    }

    return this.deps.links.linkAutomatically({
      opportunityId: opportunity.id,
      documentKind: document.kind,
      documentId: document.id,
      linkSource: 'created_from_opportunity',
    });
  }

  async #canReach(adminUserId: string, organizationId: string): Promise<boolean> {
    const scope = await this.deps.adminScope.resolveForAdmin(adminUserId);
    return scope.allowAll || scope.allowedOrganizationIds.includes(organizationId);
  }

  #refuse(origin: OriginReference, document: OriginatedDocument, reason: string): 'refused' {
    this.deps.warn(
      { opportunityId: origin.id, documentKind: document.kind, documentId: document.id, reason },
      'crm: a document named an opportunity as its origin and was not linked to it',
    );
    return 'refused';
  }
}
