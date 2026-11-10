import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OpportunityDocumentLookupQuery,
  OpportunityQuoteRequestLookupQuery,
  OpportunityQuoteRequestOption,
  OpportunityReadPort,
  OrderListPort,
  QuoteRequestReadPort,
  QuoteRequestRecord,
  RecordDocumentLookupGroup,
  RecordDocumentLookupResponse,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { orgInScope } from '@endora-commerce/platform/tenancy';
import type { CrmProjects } from './crm-projects.js';
import type { CrmQuoteRequests } from './crm-quote-requests.js';
import type { CrmTasks } from './crm-tasks.js';
import { loadOpportunity } from './opportunity-access.js';
import { assertMayReadQuoteRequests, type OwnerReadChecks } from './owner-read-permissions.js';

/** How many documents each group of the `@@` list offers for one search. */
export const DOCUMENT_LIST_GROUP_LIMIT = 10;

export interface CrmDocumentLookupServiceDeps {
  /** The tenant-scoped EntityManager an Opportunity is loaded through. */
  emFactory: () => EntityManager;
  /** The one door to `quote_requests`' presence (research N-E5). */
  quoteRequestPresence: Pick<CrmQuoteRequests, 'isPresent'>;
  /** `quote_requests`' read port — lazy, resolved per call, never captured. */
  quoteRequests: QuoteRequestReadPort;
  /** `orders`' list — lazy, resolved per call. `orders` cannot be switched off. */
  orders: OrderListPort;
  /** The one door to `tasks` — asked `isPresent()` before anything else. */
  tasks: Pick<CrmTasks, 'isPresent' | 'search'>;
  /** This module's own Opportunities, under the caller's tenant scope (`specs/165-task-management/` R-5). */
  opportunities: Pick<OpportunityReadPort, 'search'>;
  /** The one door to `projects` — asked `isPresent()` before anything else. */
  projects: Pick<CrmProjects, 'isPresent' | 'search'>;
  /** Whether the caller may read each kind of document in the module that owns it. */
  mayRead: Pick<OwnerReadChecks, 'orders' | 'quoteRequests' | 'tasks' | 'projects'>;
}

/**
 * The documents an Opportunity's link picker chooses from that CRM answers
 * itself (`specs/143-crm-sales-opportunities/research.md` N-H2, after N-D4),
 * and the `@@` document list of its texts ({@link CrmDocumentLookupService.documents}).
 *
 * **The link picker: Quote Requests only**, and for a holder of `rfqs:handle` — the code the
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
    await assertMayReadQuoteRequests(this.deps.mayRead.quoteRequests);
    if (!(await orgInScope(query.organizationId))) return [];
    return (await this.quoteRequestRecords(query.organizationId, query.q ?? '', query.limit)).map((record) => ({
      id: record.id,
      number: record.businessId,
      status: record.status,
    }));
  }

  /**
   * The `@@` document list of an Opportunity's texts
   * (`specs/163-projects-and-tasks/` FR-044, research R-14) — one grouped
   * answer, Orders · Quote Requests · Tasks · Opportunities · Projects
   * (the last two since `specs/165-task-management/` R-5), the shape Projects
   * and Tasks serve too.
   *
   * A group is in the answer only for a caller holding its owner's read code
   * (`orders:read`, `rfqs:handle`, `tasks:read`, `projects:read`; Opportunities
   * are this module's own, read with the caller's `crm:read`) and only while its owner is
   * present: a group nobody may open is not offered empty, it is not offered.
   * Orders and Quote Requests are the Opportunity's Organization's — the one
   * chosen on the create form, before there is an Opportunity — and are not
   * offered without one, or for one out of the caller's reach; Tasks are any
   * the caller may see (`tasks`' context visibility, research R-9).
   *
   * An Opportunity the caller cannot have answers 404 as one that does not
   * exist. Presence is decided before each switchable owner is asked, and
   * nothing is caught.
   */
  async documents(query: OpportunityDocumentLookupQuery): Promise<RecordDocumentLookupResponse> {
    const organizationId = await this.organizationOf(query);
    const q = (query.q ?? '').trim();
    const withOrganization = organizationId !== null && (await orgInScope(organizationId));
    const quoteRequestsPresent = this.deps.quoteRequestPresence.isPresent();
    const tasksPresent = this.deps.tasks.isPresent();
    const projectsPresent = this.deps.projects.isPresent();
    const [mayReadOrders, mayReadQuoteRequests, mayReadTasks, mayReadProjects] = await Promise.all([
      withOrganization ? this.deps.mayRead.orders() : Promise.resolve(false),
      withOrganization && quoteRequestsPresent ? this.deps.mayRead.quoteRequests() : Promise.resolve(false),
      tasksPresent ? this.deps.mayRead.tasks() : Promise.resolve(false),
      projectsPresent ? this.deps.mayRead.projects() : Promise.resolve(false),
    ]);

    const [orders, quoteRequests, tasks, opportunities, projects] = await Promise.all([
      mayReadOrders && organizationId !== null ? this.orderItems(organizationId, q) : Promise.resolve(null),
      mayReadQuoteRequests && organizationId !== null
        ? this.quoteRequestItems(organizationId, q)
        : Promise.resolve(null),
      mayReadTasks
        ? this.deps.tasks
            .search(q, DOCUMENT_LIST_GROUP_LIMIT)
            .then((found) => found.map((task) => ({ id: task.id, label: task.number, sublabel: task.title })))
        : Promise.resolve(null),
      this.deps.opportunities
        .search({ ...(q !== '' ? { q } : {}), limit: DOCUMENT_LIST_GROUP_LIMIT })
        .then((found) => found.map((record) => ({ id: record.id, label: record.number, sublabel: record.title }))),
      mayReadProjects
        ? this.deps.projects
            .search(q, DOCUMENT_LIST_GROUP_LIMIT)
            .then((found) => found.map((record) => ({ id: record.id, label: record.number, sublabel: record.title })))
        : Promise.resolve(null),
    ]);
    const groups: RecordDocumentLookupGroup[] = [];
    if (orders) groups.push({ kind: 'order', items: orders });
    if (quoteRequests) groups.push({ kind: 'quote_request', items: quoteRequests });
    if (tasks) groups.push({ kind: 'task', items: tasks });
    groups.push({ kind: 'opportunity', items: opportunities });
    if (projects) groups.push({ kind: 'project', items: projects });
    return { groups };
  }

  /** The Organization whose documents are offered: the Opportunity's, else the one named, else none. */
  private async organizationOf(query: OpportunityDocumentLookupQuery): Promise<string | null> {
    if (query.opportunityId !== undefined) {
      return (await loadOpportunity(this.deps.emFactory(), query.opportunityId)).organizationId;
    }
    return query.organizationId ?? null;
  }

  /** The Organization's Orders by number, newest placed first — `orders`' own list. */
  private async orderItems(organizationId: string, q: string): Promise<RecordDocumentLookupGroup['items']> {
    const page = await this.deps.orders.list(
      { organizationId, ...(q !== '' ? { q } : {}), page: 1, pageSize: DOCUMENT_LIST_GROUP_LIMIT },
      { allowedOrganizationIds: [organizationId] },
    );
    return page.rows.map((row) => ({ id: row.id, label: row.businessId }));
  }

  /** The Organization's Quote Requests, as the link picker finds them. */
  private async quoteRequestItems(organizationId: string, q: string): Promise<RecordDocumentLookupGroup['items']> {
    const found = await this.quoteRequestRecords(organizationId, q, DOCUMENT_LIST_GROUP_LIMIT);
    return found.map((record) => ({ id: record.id, label: record.businessId }));
  }

  /**
   * The Organization's open Quote Requests narrowed by `typed`, plus the one
   * whose number is typed in full, newest first — what both lookups offer.
   */
  private async quoteRequestRecords(organizationId: string, typed: string, limit: number): Promise<QuoteRequestRecord[]> {
    const needle = typed.trim().toLowerCase();
    const found = new Map<string, QuoteRequestRecord>();
    for (const record of await this.deps.quoteRequests.listOpenForOrganizations([organizationId])) {
      if (record.organizationId !== organizationId) continue;
      if (needle === '' || record.businessId.toLowerCase().includes(needle)) found.set(record.id, record);
    }
    if (needle !== '') {
      const exact = await this.exactByNumber(typed);
      if (exact && exact.organizationId === organizationId) found.set(exact.id, exact);
    }
    return [...found.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit);
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
