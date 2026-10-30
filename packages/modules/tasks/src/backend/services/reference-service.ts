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
import type { TaskReferenceSourceKind } from '../entities/task-reference.entity.js';
import { actingAdminUserId } from './task-access.js';
import type { OwnerReadChecks } from './owner-read-permissions.js';
import type { SwitchableRecordKind, TaskRecordOwners } from './record-owners.js';

/** One free text of a Task: its description, or one comment. */
export interface TaskReferenceSource {
  taskId: string;
  kind: TaskReferenceSourceKind;
  /** The comment's id; `null` for the description. */
  sourceId: string | null;
}

/** A row of `task_references`, as the saving Command creates it. */
export interface StoredTaskReference {
  taskId: string;
  sourceKind: TaskReferenceSourceKind;
  sourceId: string | null;
  targetType: RecordReferenceType;
  targetId: string;
}

/** The tokens of a text — none for a text that is not there. A malformed token is text. */
export function referenceTokensOf(text: string | null | undefined): RecordReferenceToken[] {
  return text ? extractRecordReferenceTokens(text) : [];
}

/** The rows one source's text asks for now — nothing for `null` text. The write is the saving Command's. */
export function referenceRowsFor(source: TaskReferenceSource, text: string | null | undefined): StoredTaskReference[] {
  const seen = new Set<string>();
  const rows: StoredTaskReference[] = [];
  for (const token of referenceTokensOf(text)) {
    const key = `${token.type}:${token.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      taskId: source.taskId,
      sourceKind: source.kind,
      sourceId: source.sourceId,
      targetType: token.type,
      targetId: token.id,
    });
  }
  return rows;
}

export interface TaskReferenceServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  products: CatalogProductReadPort;
  orders: OrderReadPort;
  adminUsers: AdminUserReadPort;
  /** The one door to Quote Requests, Opportunities and Projects — asked `isPresent` first. */
  owners: Pick<TaskRecordOwners, 'isPresent' | 'labels'>;
  /** Tasks the reader may see, by id — this module's own visibility seam. */
  tasks: (ids: readonly string[]) => Promise<ReadonlyArray<{ id: string; number: string }>>;
  /** Whether the reader may read each kind of target in the module that owns it. */
  mayRead: OwnerReadChecks;
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

const SWITCHABLE: Readonly<Record<SwitchableRecordKind, keyof OwnerReadChecks>> = {
  quote_request: 'quoteRequests',
  opportunity: 'opportunities',
  project: 'projects',
};

/**
 * References in a Task's description and comments to people, Orders,
 * Products, Quote Requests, Tasks, Opportunities and Projects
 * (`specs/165-task-management/` FR-004, FR-005, research R-5; issue #446) —
 * Projects' `reference-service.ts`, the model, with the seven kinds of the
 * shared grammar.
 *
 * **The text is the truth and is never changed**: it is stored as rich text
 * carrying `[[<type>:<uuid>]]` tokens. **On write** the tokens of one source
 * become rows of `task_references`, replacing that source's rows — written by
 * the saving Command with its EntityManager, never part of its audited state.
 * **On read** the tokens are resolved from the text, in one batched call per
 * kind mentioned, under the reader's tenant scope and only with the owner's
 * read code (`orders:read`, `catalog:read`, `rfqs:handle`, `crm:read`,
 * `projects:read`); a Quote Request, an Opportunity or a Project is also
 * unavailable while its module is off — presence is decided before the port is
 * asked, and nothing is caught. A Task is resolved through this module's own
 * visibility, so a Task that is gone, hidden by its context, or someone else's
 * draft or private Task is unavailable. A target the reader may not see, one
 * that is gone and one whose owner is off are alike: `available: false`, no
 * label, no URL. A person is named to every reader of the text, unless removed
 * or deactivated since.
 */
export class TaskReferenceService {
  constructor(private readonly deps: TaskReferenceServiceDeps) {}

  /** The references of one text, for the reader. */
  async resolve(text: string | null | undefined): Promise<RecordReference[]> {
    const [resolved] = await this.resolveMany([text]);
    return resolved ?? [];
  }

  /** The references of several texts — a page of comments — in one call per kind for all of them. */
  async resolveMany(texts: ReadonlyArray<string | null | undefined>): Promise<RecordReference[][]> {
    return this.#resolveTokens(texts.map((text) => referenceTokensOf(text)));
  }

  /**
   * Records named by kind and id rather than by a text — a Task's record links
   * (research R-16) — resolved for the reader exactly as a reference to them
   * is: the same owner presence, read code and port, in the order given.
   */
  async resolveTargets(targets: readonly RecordReferenceToken[]): Promise<RecordReference[]> {
    const [resolved] = await this.#resolveTokens([targets]);
    return resolved ?? [];
  }

  async #resolveTokens(tokens: ReadonlyArray<readonly RecordReferenceToken[]>): Promise<RecordReference[][]> {
    if (tokens.every((list) => list.length === 0)) return tokens.map(() => []);
    const idsOf = (type: RecordReferenceType) => [
      ...new Set(tokens.flatMap((list) => list.filter((token) => token.type === type).map((token) => token.id))),
    ];
    const productIds = idsOf('product');
    const orderIds = idsOf('order');
    const personIds = idsOf('admin_user');
    const taskIds = idsOf('task');

    const [mayReadProducts, mayReadOrders] = await Promise.all([
      productIds.length > 0 ? this.deps.mayRead.products() : Promise.resolve(false),
      orderIds.length > 0 ? this.deps.mayRead.orders() : Promise.resolve(false),
    ]);
    const [products, orders, people, tasks, _language, switchable] = await Promise.all([
      mayReadProducts ? this.deps.products.findByIds(productIds, { liveOnly: true }) : Promise.resolve([]),
      mayReadOrders ? this.deps.orders.findByIds(orderIds) : Promise.resolve([]),
      personIds.length > 0 ? this.deps.adminUsers.findByIds(personIds) : Promise.resolve([]),
      taskIds.length > 0 ? this.deps.tasks(taskIds) : Promise.resolve([]),
      mayReadProducts ? this.#viewerLanguage() : Promise.resolve(FALLBACK_LANGUAGE),
      Promise.all(
        (Object.keys(SWITCHABLE) as SwitchableRecordKind[]).map(async (kind) => {
          const ids = idsOf(kind);
          // Presence first, then the reader's code, then the port.
          if (ids.length === 0 || !this.deps.owners.isPresent(kind)) return [kind, new Map()] as const;
          if (!(await this.deps.mayRead[SWITCHABLE[kind]]())) return [kind, new Map()] as const;
          return [kind, await this.deps.owners.labels(kind, ids)] as const;
        }),
      ),
    ]);

    const labels = new Map<string, string>();
    const orderFacts = new Map<string, RecordReferenceOrder>();
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
    for (const person of people.filter(isActive)) {
      labels.set(`admin_user:${person.id}`, `${person.firstName} ${person.lastName}`.trim() || person.email);
    }
    for (const task of tasks) labels.set(`task:${task.id}`, task.number);
    for (const [kind, found] of switchable) {
      for (const record of found.values()) labels.set(`${kind}:${record.id}`, record.label);
    }

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
