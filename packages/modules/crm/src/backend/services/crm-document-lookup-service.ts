import type {
  OpportunityQuoteRequestLookupQuery,
  OpportunityQuoteRequestOption,
  QuoteRequestReadPort,
  QuoteRequestRecord,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { isOrgInScope } from '@endora-commerce/platform/tenancy';
import type { CrmQuoteRequests } from './crm-quote-requests.js';
import { assertMayReadQuoteRequests, type OwnerReadCheck } from './owner-read-permissions.js';

export interface CrmDocumentLookupServiceDeps {
  /** The one door to `quote_requests`' presence (research N-E5). */
  quoteRequestPresence: Pick<CrmQuoteRequests, 'isPresent'>;
  /** `quote_requests`' read port — lazy, resolved per call, never captured. */
  quoteRequests: QuoteRequestReadPort;
  /** Whether the caller holds the code `quote_requests` reads a request with. */
  mayReadQuoteRequests: OwnerReadCheck;
}

/**
 * The documents an Opportunity's link picker chooses from that CRM answers
 * itself (`specs/143-crm-sales-opportunities/research.md` N-H2, after N-D4).
 *
 * **Quote Requests only**, and for a holder of `rfqs:handle` — the code the
 * quote desk reads a request with (research N-R13, which reverses N-H2 on this
 * point): what another module owns is offered to somebody who may read it
 * there. The answer stays narrower than the desk's own list — one
 * Organization, three fields. Orders are still searched through `orders`' own list:
 * `crm:read` names `orders:read` as what its holder should also hold, and the
 * Opportunity screen reads Orders with it already.
 *
 * **What is offered** is what the published port can answer: the
 * Organization's *open* Quote Requests, narrowed by the number typed, plus the
 * one whose number is typed in full, whatever its status — so an approved or
 * completed request is linked by its number. The port has no search.
 *
 * **Tenant scope is applied here, by name**, as the Organization lookup does:
 * an Organization out of the caller's reach has no Quote Requests to offer.
 * With `quote_requests` off the answer is 503 `MODULE_DISABLED` naming that
 * module — the same answer linking one gives (research N-E5).
 */
export class CrmDocumentLookupService {
  constructor(private readonly deps: CrmDocumentLookupServiceDeps) {}

  async quoteRequests(
    query: OpportunityQuoteRequestLookupQuery,
  ): Promise<OpportunityQuoteRequestOption[]> {
    if (!this.deps.quoteRequestPresence.isPresent()) throw new ModuleDisabledError('quote_requests');
    await assertMayReadQuoteRequests(this.deps.mayReadQuoteRequests);
    if (!isOrgInScope(query.organizationId)) return [];

    const needle = (query.q ?? '').trim().toLowerCase();
    const found = new Map<string, QuoteRequestRecord>();
    for (const record of await this.deps.quoteRequests.listOpenForOrganizations([
      query.organizationId,
    ])) {
      if (record.organizationId !== query.organizationId) continue;
      if (needle === '' || record.businessId.toLowerCase().includes(needle)) {
        found.set(record.id, record);
      }
    }
    if (needle !== '') {
      const exact = await this.exactByNumber(query.q ?? '');
      if (exact && exact.organizationId === query.organizationId) found.set(exact.id, exact);
    }
    return [...found.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, query.limit)
      .map((record) => ({ id: record.id, number: record.businessId, status: record.status }));
  }

  /** Numbers are stored upper-case; a person types them either way. */
  private async exactByNumber(typed: string): Promise<QuoteRequestRecord | null> {
    const trimmed = typed.trim();
    return (
      (await this.deps.quoteRequests.findByBusinessId(trimmed)) ??
      (trimmed.toUpperCase() !== trimmed
        ? await this.deps.quoteRequests.findByBusinessId(trimmed.toUpperCase())
        : null)
    );
  }
}
