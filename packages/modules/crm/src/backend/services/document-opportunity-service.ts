import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  OpportunitySummarySchema,
  type OpportunityDetail,
  type OpportunitySummary,
  type OrderReadPort,
  type QuoteRequestReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityLink } from '../entities/crm-opportunity-link.entity.js';
import type { CrmQuoteRequests } from './crm-quote-requests.js';
import { isUuid } from './opportunity-access.js';
import { assertMayReadQuoteRequests, type OwnerReadCheck } from './owner-read-permissions.js';

export interface DocumentOpportunityServiceDeps {
  emFactory: () => EntityManager;
  /** `orders`' read port — lazy, resolved per call, never captured. */
  orders: OrderReadPort;
  /** The one door to `quote_requests`' presence (research N-E5). */
  quoteRequestPresence: Pick<CrmQuoteRequests, 'isPresent'>;
  /** `quote_requests`' read port — lazy, resolved per call, and only while that module is present. */
  quoteRequests: QuoteRequestReadPort;
  /** Whether the caller holds the code `quote_requests` reads a request with. */
  mayReadQuoteRequests: OwnerReadCheck;
  /** The Opportunity as its own screen reads it; the summary is cut from it. */
  getOpportunity: (opportunityId: string) => Promise<OpportunityDetail>;
}

function documentNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.CRM_DOCUMENT_NOT_FOUND, 'Document not found.');
}

/**
 * "Which Opportunity is this document linked to" — the read behind the panel
 * on the Order screen and on the Quote Request screen
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12b).
 *
 * **The document first.** It is read through its owner's port, under the
 * caller's tenant scope: a document the caller may not see is 404
 * `CRM_DOCUMENT_NOT_FOUND`, the same as one that does not exist, *before*
 * anything is said about a link — otherwise the difference between `null` and
 * a refusal would tell a stranger whether somebody else's Order has an
 * Opportunity.
 *
 * **Then the parent, not the child.** A link carries no tenant column, so it is
 * read only to learn which Opportunity to ask for; the Opportunity itself is
 * read through the scoped EntityManager, and a link to one the caller may not
 * see answers `null`.
 *
 * **A Quote Request's owner can be switched off.** Its presence is decided
 * first, from the same door linking one goes through: while `quote_requests`
 * is off the answer is 503 `MODULE_DISABLED` naming that module, whoever asks
 * and whatever they hold — never `null`, which would claim the request is
 * unlinked. Only then is the caller's `rfqs:handle` asked (research N-R13), and
 * only then the request itself, through `quoteRequestReadPort` under the
 * caller's tenant scope. An Order's read permission is the route's to ask:
 * `orders` cannot be switched off.
 */
export class DocumentOpportunityService {
  constructor(private readonly deps: DocumentOpportunityServiceDeps) {}

  async findForDocument(documentKind: string, documentId: string): Promise<OpportunitySummary | null> {
    if (documentKind !== 'order' && documentKind !== 'quote_request') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, `"${documentKind}" is not a kind of document.`);
    }
    if (documentKind === 'quote_request') {
      if (!this.deps.quoteRequestPresence.isPresent()) throw new ModuleDisabledError('quote_requests');
      await assertMayReadQuoteRequests(this.deps.mayReadQuoteRequests);
      if (!isUuid(documentId)) throw documentNotFound();
      if (!(await this.deps.quoteRequests.findById(documentId))) throw documentNotFound();
    } else {
      if (!isUuid(documentId)) throw documentNotFound();
      if (!(await this.deps.orders.findById(documentId))) throw documentNotFound();
    }

    const em = this.deps.emFactory();
    const link = await em.findOne(CrmOpportunityLink, { documentKind, documentId });
    if (!link) return null;
    const visible = await em.findOne(CrmOpportunity, { id: link.opportunityId }, { fields: ['id'] });
    if (!visible) return null;
    // The detail is the one place an Opportunity is rendered for a reader; the
    // schema keeps the summary's fields and drops the rest.
    return OpportunitySummarySchema.parse(await this.deps.getOpportunity(visible.id));
  }
}
