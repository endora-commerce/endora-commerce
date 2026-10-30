import {
  extractRecordReferenceTokens,
  type AdminUserReadPort,
  type CatalogProductReadPort,
  type OrderReadPort,
  type RecordReference,
  type RecordReferenceOrder,
  type RecordReferenceToken,
  type RecordReferenceType,
} from '@endora-commerce/contracts';
import { actingAdminUserId, type ProjectAccess } from './project-access.js';
import type { LinkedRecordOwners } from './linked-records.js';
import type { OwnerReadChecks } from './owner-read-permissions.js';
import type { ProjectTasks } from './project-tasks.js';

/** What a text of a Project is: its description, or one note or message. */
export type ProjectReferenceSourceKind = 'description' | 'comment';

/** One free text of a Project. */
export interface ProjectReferenceSource {
  projectId: string;
  kind: ProjectReferenceSourceKind;
  /** The comment's id; `null` for the description. */
  sourceId: string | null;
}

/** A row of `project_references`, as the saving Command creates it. */
export interface StoredProjectReference {
  projectId: string;
  sourceKind: ProjectReferenceSourceKind;
  sourceId: string | null;
  targetType: RecordReferenceType;
  targetId: string;
}

/** Which rows belong to one source — what a save deletes before it writes the new ones. */
export function storedReferencesOf(source: ProjectReferenceSource): {
  projectId: string;
  sourceKind: ProjectReferenceSourceKind;
  sourceId: string | null;
} {
  return { projectId: source.projectId, sourceKind: source.kind, sourceId: source.sourceId };
}

/** The tokens of a text — none for a text that is not there. A malformed token is text. */
export function referenceTokensOf(text: string | null | undefined): RecordReferenceToken[] {
  return text ? extractRecordReferenceTokens(text) : [];
}

export interface ProjectReferenceServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  products: CatalogProductReadPort;
  orders: OrderReadPort;
  adminUsers: AdminUserReadPort;
  /** The one door to Quote Requests and Opportunities (`linked-records.ts`) — asked `isPresent` first. */
  quoteRequests: Pick<LinkedRecordOwners, 'isPresent' | 'findMany'>;
  /** The one door to `tasks` — asked `present()` first. */
  tasks: Pick<ProjectTasks, 'present' | 'read'>;
  /** This module's own Projects the reader may see (`specs/165-task-management/` R-5). */
  projects: Pick<ProjectAccess, 'findVisibleMany'>;
  /** Whether the reader may read each kind of target in the module that owns it. */
  mayRead: Pick<OwnerReadChecks, 'orders' | 'products' | 'quoteRequests' | 'tasks' | 'opportunities'>;
}

const FALLBACK_LANGUAGE = 'en';

/** Where a chip leads. A person leads nowhere: an administrator's screen is `admin_users`'. */
function adminUrl(token: RecordReferenceToken): string | null {
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

/** A Product's name in the reader's language, then any name of that language, then any name, then its SKU. */
function isActive(person: { status: string; deletedAt: Date | null }): boolean {
  return person.status === 'active' && person.deletedAt === null;
}

/**
 * References to people, Orders, Quote Requests, Tasks and Products in a
 * Project's description, notes and messages
 * (`specs/163-projects-and-tasks/research.md` R-14, FR-026, FR-044) — the
 * standard CRM's `reference-service.ts` states, for Projects.
 *
 * **The text is the truth and is never changed**: it is stored as plain text
 * carrying `[[<type>:<uuid>]]` tokens. **On write** the tokens of one source
 * become rows of `project_references`, replacing that source's rows — an index
 * written by the saving Command, with that Command's EntityManager, never part
 * of its audited state. **On read** the tokens are resolved from the text, in
 * one batched call per kind mentioned, under the reader's tenant scope and only
 * with the owner's read code (`orders:read`, `catalog:read`, `rfqs:handle`,
 * `tasks:read`); a Quote Request or a Task is also unavailable while its
 * module is off — presence is decided before the port is asked, and nothing is
 * caught. A target the reader may not see, one that is gone and one whose owner
 * is off are alike: `available: false`, no label, no URL. A person is named to
 * every reader of the text, unless removed or deactivated since.
 */
export class ProjectReferenceService {
  constructor(private readonly deps: ProjectReferenceServiceDeps) {}

  /** The rows one source's text asks for now — nothing for `null` text. The write is the Command's. */
  rowsFor(source: ProjectReferenceSource, text: string | null | undefined): StoredProjectReference[] {
    return referenceTokensOf(text).map((token) => ({
      projectId: source.projectId,
      sourceKind: source.kind,
      sourceId: source.sourceId,
      targetType: token.type,
      targetId: token.id,
    }));
  }

  /** The references of one text, for the reader. */
  async resolve(text: string | null | undefined): Promise<RecordReference[]> {
    const [resolved] = await this.resolveMany([text]);
    return resolved ?? [];
  }

  /** The references of several texts — a page of comments — in one call per kind for all of them. */
  async resolveMany(texts: ReadonlyArray<string | null | undefined>): Promise<RecordReference[][]> {
    const tokens = texts.map((text) => referenceTokensOf(text));
    if (tokens.every((list) => list.length === 0)) return texts.map(() => []);
    const idsOf = (type: RecordReferenceType) => [
      ...new Set(tokens.flatMap((list) => list.filter((token) => token.type === type).map((token) => token.id))),
    ];
    const productIds = idsOf('product');
    const orderIds = idsOf('order');
    const personIds = idsOf('admin_user');
    const quoteRequestIds = idsOf('quote_request');
    const taskIds = idsOf('task');
    const opportunityIds = idsOf('opportunity');
    const projectIds = idsOf('project');

    const opportunitiesPresent = opportunityIds.length > 0 && this.deps.quoteRequests.isPresent('opportunity');
    const quoteRequestsPresent = quoteRequestIds.length > 0 && this.deps.quoteRequests.isPresent('quote_request');
    const tasksPresent = taskIds.length > 0 && this.deps.tasks.present();
    const [mayReadProducts, mayReadOrders, mayReadQuoteRequests, mayReadTasks] = await Promise.all([
      productIds.length > 0 ? this.deps.mayRead.products() : Promise.resolve(false),
      orderIds.length > 0 ? this.deps.mayRead.orders() : Promise.resolve(false),
      quoteRequestsPresent ? this.deps.mayRead.quoteRequests() : Promise.resolve(false),
      tasksPresent ? this.deps.mayRead.tasks() : Promise.resolve(false),
    ]);
    // An Opportunity through `crm`'s port with `crm:read`; a Project is this
    // module's own, read through `ProjectAccess` — one the reader may not see is absent.
    const [opportunities, projects] = await Promise.all([
      opportunitiesPresent && (await this.deps.mayRead.opportunities())
        ? this.deps.quoteRequests.findMany('opportunity', opportunityIds)
        : Promise.resolve(new Map()),
      projectIds.length > 0 ? this.deps.projects.findVisibleMany(projectIds) : Promise.resolve([]),
    ]);
    const [products, orders, people, quoteRequests, tasks, _language] = await Promise.all([
      mayReadProducts ? this.deps.products.findByIds(productIds, { liveOnly: true }) : Promise.resolve([]),
      mayReadOrders ? this.deps.orders.findByIds(orderIds) : Promise.resolve([]),
      personIds.length > 0 ? this.deps.adminUsers.findByIds(personIds) : Promise.resolve([]),
      mayReadQuoteRequests
        ? this.deps.quoteRequests.findMany('quote_request', quoteRequestIds)
        : Promise.resolve(new Map()),
      mayReadTasks ? this.deps.tasks.read.findByIds(taskIds) : Promise.resolve([]),
      mayReadProducts ? this.#viewerLanguage() : Promise.resolve(FALLBACK_LANGUAGE),
    ]);

    const labels = new Map<string, string>();
    const orderFacts = new Map<string, RecordReferenceOrder>();
    for (const product of products)
      labels.set(`product:${product.id}`, product.name /* 168-shim: Global text */);
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
    for (const person of people.filter(isActive)) {
      labels.set(`admin_user:${person.id}`, `${person.firstName} ${person.lastName}`.trim() || person.email);
    }
    for (const view of quoteRequests.values()) labels.set(`quote_request:${view.id}`, view.number);
    for (const task of tasks) labels.set(`task:${task.id}`, task.number);
    for (const view of opportunities.values()) labels.set(`opportunity:${view.id}`, view.number);
    for (const project of projects) labels.set(`project:${project.id}`, project.number);

    return tokens.map((list) =>
      list.map((token): RecordReference => {
        const label = labels.get(`${token.type}:${token.id}`);
        if (label === undefined) return { type: token.type, id: token.id, available: false, label: null, url: null };
        const facts = token.type === 'order' ? orderFacts.get(token.id) : undefined;
        return {
          type: token.type,
          id: token.id,
          available: true,
          label,
          url: adminUrl(token),
          ...(facts ? { order: facts } : {}),
        };
      }),
    );
  }

  /** The reader's stored language — what the Admin UI renders in — or English. */
  async #viewerLanguage(): Promise<string> {
    const reader = actingAdminUserId();
    if (reader === null) return FALLBACK_LANGUAGE;
    const admin = await this.deps.adminUsers.findById(reader);
    return admin?.preferredLanguage ?? FALLBACK_LANGUAGE;
  }
}
