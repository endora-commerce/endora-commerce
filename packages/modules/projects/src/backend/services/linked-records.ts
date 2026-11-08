import type {
  OpportunityReadPort,
  OrderReadPort,
  ProjectRecordKind,
  QuoteRequestReadPort,
} from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';

/**
 * The records a Project links to, through their owners' own read ports
 * (`specs/163-projects-and-tasks/research.md` R-10) — the one door to the three
 * owners, so that every caller decides an owner's **presence first**.
 *
 * `orders` cannot be switched off and is a binding dependency. `crm` and
 * `quote_requests` are operator-switchable and this module only *degrades*
 * without them (the manifest's `degrades-without` edges): a linked record of
 * an absent owner renders as unavailable, and linking one answers 503. Nothing
 * here, and nothing that calls this, catches a closed gate as a signal — ask
 * {@link LinkedRecordOwners.isPresent} before {@link LinkedRecordOwners.find}.
 *
 * Every read runs under the caller's tenant scope, as the owners' ports do: a
 * record the caller may not reach does not exist for them.
 *
 * A function rather than an object literal at the composition site:
 * `check:port-catches` follows the ports through the value.
 */

/** A linked record as a Project shows it. */
export interface LinkedRecordView {
  kind: ProjectRecordKind;
  id: string;
  organizationId: string;
  number: string;
  status: string;
  /** Two places, or `null` when the record has none (an Opportunity without a value). */
  amount: string | null;
  currency: string | null;
  /**
   * A Quote Request only: `true` while not every line has an agreed price
   * (issue #456). Absent for the other kinds.
   */
  partiallyAgreed?: boolean;
  /** The record's own admin screen. */
  href: string;
}

/** The module that owns each kind of record. */
export const RECORD_OWNER: Readonly<Record<ProjectRecordKind, string>> = {
  order: 'orders',
  quote_request: 'quote_requests',
  opportunity: 'crm',
};

export interface LinkedRecordOwners {
  /** Whether the module that owns `kind` is effectively present. Ask before {@link find}. */
  isPresent(kind: ProjectRecordKind): boolean;
  /** One record as the caller may see it, or `null` — missing or out of reach. Only while present. */
  find(kind: ProjectRecordKind, id: string): Promise<LinkedRecordView | null>;
  /** Several records of one kind, by id; the ones the caller may not see are absent. Only while present. */
  findMany(kind: ProjectRecordKind, ids: readonly string[]): Promise<Map<string, LinkedRecordView>>;
  /**
   * The Quote Requests of `organizationIds` a person typing `typed` is offered
   * after `@@` (FR-044): the open ones whose number holds what is typed, plus
   * the one whose number is typed in full, whatever its status — newest first.
   * Only while `quote_request`'s owner is present.
   */
  searchQuoteRequests(
    organizationIds: readonly string[],
    typed: string,
    limit: number,
  ): Promise<Array<{ id: string; number: string }>>;
  /**
   * The Opportunities a person typing `typed` is offered after `@@`
   * (`specs/165-task-management/` R-5): by number or title, in the caller's
   * reach, newest first. Only while `opportunity`'s owner is present.
   */
  searchOpportunities(typed: string, limit: number): Promise<Array<{ id: string; number: string; title: string }>>;
}

export interface LinkedRecordPorts {
  orders: OrderReadPort;
  quoteRequests: QuoteRequestReadPort;
  opportunities: OpportunityReadPort;
}

export function createLinkedRecordOwners(ports: LinkedRecordPorts): LinkedRecordOwners {
  const quoteRequest = async (id: string): Promise<LinkedRecordView | null> => {
    const record = await ports.quoteRequests.findById(id);
    if (!record) return null;
    // The amount is `quote_requests`' to compute (issue #456), not this module's.
    const worth = await ports.quoteRequests.amountOf(record.id);
    if (!worth) return null;
    const { amount, currency, partiallyAgreed } = worth;
    return {
      kind: 'quote_request',
      id: record.id,
      organizationId: record.organizationId,
      number: record.businessId,
      status: record.status,
      amount,
      currency,
      partiallyAgreed,
      href: `/quote-requests/${record.id}`,
    };
  };

  const opportunity = async (id: string): Promise<LinkedRecordView | null> => {
    const record = await ports.opportunities.findById(id);
    if (!record) return null;
    return {
      kind: 'opportunity',
      id: record.id,
      organizationId: record.organizationId,
      number: record.number,
      status: record.statusCode,
      amount: record.value,
      currency: record.currency,
      href: `/crm/opportunities/${record.id}`,
    };
  };

  const orders = async (ids: readonly string[]): Promise<LinkedRecordView[]> =>
    (await ports.orders.findByIds(ids)).map((record) => ({
      kind: 'order',
      id: record.id,
      organizationId: record.organizationId,
      number: record.businessId,
      status: record.status,
      amount: record.total,
      currency: record.currency,
      href: `/orders/${record.id}`,
    }));

  const many = async (kind: ProjectRecordKind, ids: readonly string[]): Promise<LinkedRecordView[]> => {
    if (ids.length === 0) return [];
    if (kind === 'order') return orders(ids);
    const one = kind === 'quote_request' ? quoteRequest : opportunity;
    const found: LinkedRecordView[] = [];
    // One at a time: neither port publishes a batched read, and a Project
    // links a handful of each.
    for (const id of ids) {
      const view = await one(id);
      if (view) found.push(view);
    }
    return found;
  };

  return {
    isPresent: (kind) => effectiveState.isPresent(RECORD_OWNER[kind]),
    async find(kind, id) {
      return (await many(kind, [id]))[0] ?? null;
    },
    async findMany(kind, ids) {
      return new Map((await many(kind, [...new Set(ids)])).map((view) => [view.id, view]));
    },
    async searchOpportunities(typed, limit) {
      const q = typed.trim();
      return (await ports.opportunities.search({ ...(q !== '' ? { q } : {}), limit })).map((record) => ({
        id: record.id,
        number: record.number,
        title: record.title,
      }));
    },
    async searchQuoteRequests(organizationIds, typed, limit) {
      if (organizationIds.length === 0) return [];
      const allowed = new Set(organizationIds);
      const needle = typed.trim().toLowerCase();
      const found = new Map<string, { id: string; businessId: string; createdAt: Date }>();
      for (const record of await ports.quoteRequests.listOpenForOrganizations([...allowed])) {
        if (!allowed.has(record.organizationId)) continue;
        if (needle === '' || record.businessId.toLowerCase().includes(needle)) found.set(record.id, record);
      }
      if (needle !== '') {
        // Numbers are stored upper-case; a person types them either way.
        const exact =
          (await ports.quoteRequests.findByBusinessId(typed.trim())) ??
          (typed.trim().toUpperCase() !== typed.trim()
            ? await ports.quoteRequests.findByBusinessId(typed.trim().toUpperCase())
            : null);
        if (exact && allowed.has(exact.organizationId)) found.set(exact.id, exact);
      }
      return [...found.values()]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((record) => ({ id: record.id, number: record.businessId }));
    },
  };
}
