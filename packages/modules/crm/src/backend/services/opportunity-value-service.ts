import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OpportunityDocumentKind,
  OpportunityExcludedDocument,
  OrderReadPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  calculateOpportunityValue,
  type OpportunityValueResult,
  type ValueQuoteRequestDocument,
} from '../domain/value-calculation.js';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityLink } from '../entities/crm-opportunity-link.entity.js';
import { CrmValueCountingStatus } from '../entities/crm-value-counting-status.entity.js';
import type { CrmQuoteRequests } from './crm-quote-requests.js';
import { isUuid, loadOpportunity } from './opportunity-access.js';
import type { OwnerReadChecks } from './owner-read-permissions.js';

export interface OpportunityValueServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** `orders`' read port — lazy, resolved per call. */
  orders: OrderReadPort;
  /** Quote Requests, behind their presence decision. */
  quoteRequests: CrmQuoteRequests;
  /** Whether the reader may read an Order, or a Quote Request, in the module that owns it. */
  mayRead: Pick<OwnerReadChecks, 'orders' | 'quoteRequests'>;
}

/** How many Opportunities one pass of {@link OpportunityValueService.recalculateAll} reads at a time. */
const RECALCULATE_ALL_PAGE = 200;

/**
 * The computed value of an Opportunity
 * (`specs/143-crm-sales-opportunities/research.md` R-14).
 *
 * `computed_value` is a **stored** figure: the list, the board's totals and
 * the analytics sort and add by it, and none of them can afford a port call
 * per row. This service is what keeps it true — it is asked again whenever
 * something it is derived from changes: a link, a linked document's status or
 * amount, the mode, the counting configuration.
 *
 * **What counts.** A linked Order whose status is a counting Order status, at
 * its published `total` — the gross figure the customer pays, delivery
 * included. A linked Quote Request whose status is a counting Quote Request
 * status, at `Σ quantity × unit price` — net, as the quote desk shows it. The
 * two are not on the same basis and are not converted to one: each is what its
 * own screen shows. An Order placed from a linked Quote Request is counted
 * once, as the Order. A document in another currency is left out and named.
 *
 * **Only while the mode is `computed`.** A manual Opportunity's value is what
 * was typed; its stored computed figure is not maintained, and switching the
 * mode recalculates.
 *
 * **The write is a Command and writes no audit entry** (`skipAudit`): the
 * figure is derived, the change that caused it — a link, an Order's status —
 * has an entry of its own, and an entry per recalculation would bury the
 * Opportunity's history under arithmetic.
 */
export class OpportunityValueService {
  constructor(private readonly deps: OpportunityValueServiceDeps) {}

  /**
   * Recalculate one Opportunity as the caller may see it. Answers `false`
   * when there was nothing to do: no such Opportunity, a manual one, or a
   * figure that is already right.
   */
  async recalculate(opportunityId: string): Promise<boolean> {
    if (!isUuid(opportunityId)) return false;
    const visible = await this.deps.emFactory().findOne(CrmOpportunity, { id: opportunityId });
    if (!visible || visible.valueMode !== 'computed') return false;

    return this.deps.commandBus.run({
      action: 'crm.opportunity.value_recalculate',
      objectType: 'crm_opportunity',
      objectId: visible.id,
      run: async ({ em }) => {
        // Locked for the whole evaluation, so two recalculations of one
        // Opportunity run one after the other and the later one — which read
        // the documents later — is the one that stays.
        const opportunity = await loadOpportunity(em, visible.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (opportunity.valueMode !== 'computed') return { result: false, skipAudit: true };
        const { value } = await this.#evaluate(em, opportunity);
        if (opportunity.computedValue === value) return { result: false, skipAudit: true };
        opportunity.computedValue = value;
        // Derived data: no audit entry, and no version bump — an edit form
        // open on the Opportunity is not invalidated by arithmetic.
        return { result: true, skipAudit: true };
      },
    });
  }

  /** Recalculate the Opportunity a document is linked to, if it is linked to one. */
  async recalculateForDocument(kind: OpportunityDocumentKind, documentId: string): Promise<boolean> {
    if (!isUuid(documentId)) return false;
    const link = await this.deps
      .emFactory()
      .findOne(CrmOpportunityLink, { documentKind: kind, documentId });
    return link ? this.recalculate(link.opportunityId) : false;
  }

  /**
   * Recalculate every computed Opportunity the caller's scope reaches — the
   * body of the recalculation job, which runs it in a system scope. Answers how
   * many figures changed. Idempotent: a second pass changes nothing.
   */
  async recalculateAll(): Promise<number> {
    let changed = 0;
    let after = '';
    for (;;) {
      const page = await this.deps.emFactory().find(
        CrmOpportunity,
        { valueMode: 'computed', ...(after ? { id: { $gt: after } } : {}) },
        { orderBy: { id: 'asc' }, limit: RECALCULATE_ALL_PAGE, fields: ['id'] },
      );
      for (const opportunity of page) {
        if (await this.recalculate(opportunity.id)) changed += 1;
      }
      const last = page[page.length - 1];
      if (!last || page.length < RECALCULATE_ALL_PAGE) return changed;
      after = last.id;
    }
  }

  /**
   * The documents a computed Opportunity leaves out, for its detail screen.
   * Evaluated on read, from what the reader may see: the stored figure has no
   * room for the names.
   *
   * **An entry says something of the document** — that its status counts and
   * that it is in another currency — so it is named only to a reader who may
   * read that kind of document in the module that owns it (research N-R13).
   * The narrowing is here, on what is *shown*, and never in the evaluation: the
   * stored figure is the Opportunity's own and must be the same whoever's
   * request happened to cause the recalculation.
   */
  async excludedDocuments(opportunity: CrmOpportunity): Promise<OpportunityExcludedDocument[]> {
    if (opportunity.valueMode !== 'computed') return [];
    const { excludedDocuments } = await this.#evaluate(this.deps.emFactory(), opportunity);
    if (excludedDocuments.length === 0) return [];
    const [orders, quoteRequests] = await Promise.all([
      this.deps.mayRead.orders(),
      this.deps.mayRead.quoteRequests(),
    ]);
    return excludedDocuments.filter((document) => (document.kind === 'order' ? orders : quoteRequests));
  }

  /**
   * **`opportunity` was loaded through a tenant-scoped EntityManager by the
   * caller** — the links carry no tenant column of their own.
   */
  async #evaluate(em: EntityManager, opportunity: CrmOpportunity): Promise<OpportunityValueResult> {
    const [links, counting] = await Promise.all([
      em.find(CrmOpportunityLink, { opportunityId: opportunity.id }, { orderBy: { createdAt: 'asc', id: 'asc' } }),
      em.find(CrmValueCountingStatus, {}),
    ]);
    const orderIds = links.filter((link) => link.documentKind === 'order').map((link) => link.documentId);
    const quoteRequestIds = links
      .filter((link) => link.documentKind === 'quote_request')
      .map((link) => link.documentId);

    const orders = orderIds.length > 0 ? await this.deps.orders.findByIds(orderIds) : [];
    const ordersById = new Map(orders.map((order) => [order.id, order]));

    // Presence first: with `quote_requests` off its documents add nothing, and
    // the port is not asked.
    const quoteRequests: ValueQuoteRequestDocument[] = [];
    if (quoteRequestIds.length > 0 && this.deps.quoteRequests.isPresent()) {
      for (const id of quoteRequestIds) {
        const document = await this.deps.quoteRequests.load(id);
        if (!document) continue;
        quoteRequests.push({
          id: document.record.id,
          status: document.record.status,
          convertedOrderId: document.record.convertedOrderId,
          lines: document.lines,
        });
      }
    }

    return calculateOpportunityValue({
      currency: opportunity.currency,
      countingStatuses: {
        order: counting.filter((row) => row.documentKind === 'order').map((row) => row.statusCode),
        quoteRequest: counting
          .filter((row) => row.documentKind === 'quote_request')
          .map((row) => row.statusCode),
      },
      // In link order, so the names of what is left out are stable.
      orders: orderIds.flatMap((id) => {
        const order = ordersById.get(id);
        return order
          ? [
              {
                id: order.id,
                status: order.status,
                total: order.total,
                currency: order.currency,
                sourceQuoteRequestId: order.sourceQuoteRequestId,
              },
            ]
          : [];
      }),
      quoteRequests,
    });
  }
}
