import type {
  AdminUserReadPort,
  CatalogProductReadPort,
  OpportunityReadPort,
  OpportunityReference,
  OpportunityReferenceOrder,
  OpportunityReferenceToken,
  OrderReadPort,
} from '@endora-commerce/contracts';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { referenceTokensOf } from '../domain/reference-tokens.js';
import type {
  CrmReferenceSourceKind,
  CrmReferenceTargetType,
} from '../entities/crm-opportunity-reference.entity.js';
import type { CrmProjects } from './crm-projects.js';
import type { CrmQuoteRequests } from './crm-quote-requests.js';
import type { CrmTasks } from './crm-tasks.js';
import { isActiveAdministrator } from './opportunity-assignment-service.js';
import type { OwnerReadChecks } from './owner-read-permissions.js';

export interface ReferenceServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  products: CatalogProductReadPort;
  orders: OrderReadPort;
  adminUsers: AdminUserReadPort;
  /** The one door to `quote_requests` — operator-switchable, so asked `isPresent()` first. */
  quoteRequests: Pick<CrmQuoteRequests, 'isPresent' | 'findRecord'>;
  /** The one door to `tasks` — operator-switchable, so asked `isPresent()` first. */
  tasks: Pick<CrmTasks, 'isPresent' | 'findByIds'>;
  /** This module's own Opportunities, under the reader's tenant scope (`specs/165-task-management/` R-5). */
  opportunities: Pick<OpportunityReadPort, 'findByIds'>;
  /** The one door to `projects` — operator-switchable, so asked `isPresent()` first. */
  projects: Pick<CrmProjects, 'isPresent' | 'findByIds'>;
  /** Whether the reader may read each kind of target in the module that owns it. */
  mayRead: Pick<OwnerReadChecks, 'orders' | 'products' | 'quoteRequests' | 'tasks' | 'projects'>;
}

/** A row of `crm_opportunity_references`, as the saving Command creates it. */
export interface StoredReference {
  opportunityId: string;
  sourceKind: CrmReferenceSourceKind;
  sourceId: string | null;
  targetType: CrmReferenceTargetType;
  targetId: string;
}

/** Which rows belong to one source — what a save deletes before it writes the new ones. */
export function storedReferencesOf(source: ReferenceSource): {
  opportunityId: string;
  sourceKind: CrmReferenceSourceKind;
  sourceId: string | null;
} {
  return { opportunityId: source.opportunityId, sourceKind: source.kind, sourceId: source.sourceId };
}

/** One free text of an Opportunity: its description, or one comment. */
export interface ReferenceSource {
  opportunityId: string;
  kind: CrmReferenceSourceKind;
  /** The comment's id; `null` for the description. */
  sourceId: string | null;
}

const FALLBACK_LANGUAGE = 'en';

/**
 * Where a chip leads in the Admin UI. A person leads nowhere: the screen of an
 * administrator is `admin_users`', behind the right to manage administrators.
 */
function adminUrl(token: OpportunityReferenceToken): string | null {
  switch (token.type) {
    case 'admin_user':
      return null;
    case 'product':
      return `/catalog/products/${token.id}`;
    case 'order':
      return `/orders/${token.id}`;
    case 'quote_request':
      return `/quote-requests/${token.id}`;
    case 'task':
      return `/tasks/${token.id}`;
    // Platform-wide since `specs/165-task-management/` (research R-5).
    case 'opportunity':
      return `/crm/opportunities/${token.id}`;
    case 'project':
      return `/projects/${token.id}`;
  }
}

/**
 * A Product's name in the reader's language: the exact locale, then any locale
 * of the same language (`pl` reads `pl-PL`), then whatever name there is, then
 * the SKU — a Product always has something to be called by.
 */
/**
 * References to Products, Orders, people, Quote Requests and Tasks in an
 * Opportunity's free text (`specs/143-crm-sales-opportunities/research.md`
 * R-21, N-M1; the last two since `specs/163-projects-and-tasks/` FR-044 — one
 * reference standard with Projects).
 *
 * **The text is the truth and is never changed**: it is stored and returned as
 * plain text carrying `[[product:<uuid>]]` / `[[order:<uuid>]]` /
 * `[[admin_user:<uuid>]]` / `[[quote_request:<uuid>]]` / `[[task:<uuid>]]`
 * tokens, and nothing in it is interpreted as markup.
 *
 * **On write** the tokens of one source are stored as rows of
 * `crm_opportunity_references`, replacing that source's rows wholesale — an
 * index of who mentions what, derived from the text and rebuilt with it. This
 * service says which rows; the Command that saves the text writes them.
 *
 * **On read** the tokens are taken from the text itself and resolved in one
 * batched port call per kind mentioned, so a label is the target's *current*
 * name. The ports
 * read under the reader's tenant scope: an Order of an Organization the reader
 * does not reach is not returned, and so — like a target that is gone — comes
 * back `available: false` with no label and no URL. So does a target whose
 * owner's read permission the reader does not hold — `orders:read` for an
 * Order, `catalog:read` for a Product, `rfqs:handle` for a Quote Request,
 * `tasks:read` for a Task (research N-R13): `crm:read` lets somebody read the
 * text, not what another module would refuse to show them. A Task whose
 * context hides it from the reader (`tasks`' research R-9) is not returned by
 * its port either. A Quote Request or a Task is also unavailable while its
 * module is off — presence is decided before the port is asked. Nothing here
 * remembers a name, which is what makes that leak-proof.
 *
 * A person is named to anybody who reads the text — an administrator's name is
 * what every CRM screen already shows of an author or an assignee — unless
 * they were removed or deactivated since, when the mention is unavailable like
 * any other target that is gone.
 */
export class ReferenceService {
  constructor(private readonly deps: ReferenceServiceDeps) {}

  /**
   * The rows one source's text asks for now — nothing for `null` text (a
   * cleared description, a deleted note). **This only says what they are.**
   * The write is the saving Command's own, in the service that holds it —
   * delete {@link storedReferencesOf} the source, create these — so a child
   * row is written where its parent was loaded through the scoped
   * EntityManager.
   */
  rowsFor(source: ReferenceSource, text: string | null | undefined): StoredReference[] {
    return referenceTokensOf(text).map((token) => ({
      opportunityId: source.opportunityId,
      sourceKind: source.kind,
      sourceId: source.sourceId,
      targetType: token.type,
      targetId: token.id,
    }));
  }

  /** The references of one text, for the reader. */
  async resolve(text: string | null | undefined): Promise<OpportunityReference[]> {
    const [resolved] = await this.resolveMany([text]);
    return resolved ?? [];
  }

  /**
   * The references of several texts — a page of comments — in **one** port
   * call per kind for all of them, each list in its text's own order.
   */
  async resolveMany(texts: ReadonlyArray<string | null | undefined>): Promise<OpportunityReference[][]> {
    const tokens = texts.map((text) => referenceTokensOf(text));
    const idsOf = (type: OpportunityReferenceToken['type']) => [
      ...new Set(tokens.flatMap((list) => list.filter((token) => token.type === type).map((token) => token.id))),
    ];
    const productIds = idsOf('product');
    const orderIds = idsOf('order');
    const personIds = idsOf('admin_user');
    const quoteRequestIds = idsOf('quote_request');
    const taskIds = idsOf('task');
    const opportunityIds = idsOf('opportunity');
    const projectIds = idsOf('project');
    if (tokens.every((list) => list.length === 0)) return texts.map(() => []);

    // Asked only for a kind the texts mention; the owner's port is not asked
    // at all for a reader who could not have opened the target, nor while the
    // owner of a switchable kind is off.
    const quoteRequestsPresent = quoteRequestIds.length > 0 && this.deps.quoteRequests.isPresent();
    const tasksPresent = taskIds.length > 0 && this.deps.tasks.isPresent();
    const projectsPresent = projectIds.length > 0 && this.deps.projects.isPresent();
    const [mayReadProducts, mayReadOrders, mayReadQuoteRequests, mayReadTasks, mayReadProjects] = await Promise.all([
      productIds.length > 0 ? this.deps.mayRead.products() : Promise.resolve(false),
      orderIds.length > 0 ? this.deps.mayRead.orders() : Promise.resolve(false),
      quoteRequestsPresent ? this.deps.mayRead.quoteRequests() : Promise.resolve(false),
      tasksPresent ? this.deps.mayRead.tasks() : Promise.resolve(false),
      projectsPresent ? this.deps.mayRead.projects() : Promise.resolve(false),
    ]);
    // An Opportunity is this module's own, read under the reader's tenant scope
    // with the `crm:read` the text is read with.
    const [opportunities, projects] = await Promise.all([
      opportunityIds.length > 0 ? this.deps.opportunities.findByIds(opportunityIds) : Promise.resolve([]),
      mayReadProjects ? this.deps.projects.findByIds(projectIds) : Promise.resolve([]),
    ]);
    const [products, orders, people, quoteRequests, tasks, _language] = await Promise.all([
      // Live products only: one that was deleted is gone for the reader.
      mayReadProducts ? this.deps.products.findByIds(productIds, { liveOnly: true }) : Promise.resolve([]),
      mayReadOrders ? this.deps.orders.findByIds(orderIds) : Promise.resolve([]),
      personIds.length > 0 ? this.deps.adminUsers.findByIds(personIds) : Promise.resolve([]),
      // The quote desk's port reads one at a time; a text names a few.
      mayReadQuoteRequests
        ? Promise.all(quoteRequestIds.map((id) => this.deps.quoteRequests.findRecord(id)))
        : Promise.resolve([]),
      mayReadTasks ? this.deps.tasks.findByIds(taskIds) : Promise.resolve([]),
      mayReadProducts ? this.#viewerLanguage() : Promise.resolve(FALLBACK_LANGUAGE),
    ]);
    const labels = new Map<string, string>();
    const orderFacts = new Map<string, OpportunityReferenceOrder>();
    for (const product of products) {
      labels.set(`product:${product.id}`, product.name /* 168-shim: Global text */);
    }
    for (const order of orders) {
      labels.set(`order:${order.id}`, order.businessId);
      orderFacts.set(order.id, {
        status: order.status,
        total: order.total,
        currency: order.currency,
        placedAt: new Date(order.placedAt).toISOString(),
        customerName: order.billingAddress?.companyName || order.billingAddress?.recipientName || null,
      });
    }
    for (const person of people.filter(isActiveAdministrator)) {
      labels.set(
        `admin_user:${person.id}`,
        `${person.firstName} ${person.lastName}`.trim() || person.email,
      );
    }
    for (const quoteRequest of quoteRequests) {
      if (quoteRequest) labels.set(`quote_request:${quoteRequest.id}`, quoteRequest.businessId);
    }
    for (const task of tasks) labels.set(`task:${task.id}`, task.number);
    for (const opportunity of opportunities) labels.set(`opportunity:${opportunity.id}`, opportunity.number);
    for (const project of projects) labels.set(`project:${project.id}`, project.number);

    return tokens.map((list) =>
      list.map((token) => {
        const label = labels.get(`${token.type}:${token.id}`);
        return label === undefined
          ? { type: token.type, id: token.id, available: false, label: null, url: null }
          : {
              type: token.type,
              id: token.id,
              available: true,
              label,
              url: adminUrl(token),
              ...(token.type === 'order' && orderFacts.has(token.id)
                ? { order: orderFacts.get(token.id) as OpportunityReferenceOrder }
                : {}),
            };
      }),
    );
  }

  /** The acting administrator's stored language — what the Admin UI renders in — or English. */
  async #viewerLanguage(): Promise<string> {
    const actor = getTenantContext()?.actor;
    if (actor?.kind !== 'admin' || !actor.id) return FALLBACK_LANGUAGE;
    const admin = await this.deps.adminUsers.findById(actor.id);
    return admin?.preferredLanguage ?? FALLBACK_LANGUAGE;
  }
}
