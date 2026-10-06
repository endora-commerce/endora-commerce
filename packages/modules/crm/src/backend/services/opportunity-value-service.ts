import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OpportunityDocumentKind,
  OpportunityExcludedDocument,
  OrderReadPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
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
  /**
   * Ask for one Opportunity to be recalculated later, off the caller's path.
   * Never rejects: a queue that cannot be reached is the asker's to log.
   */
  requestRecalculation: (opportunityId: string) => Promise<unknown>;
}

/**
 * How many times one recalculation evaluates an Opportunity before it hands
 * the matter to the queue. A figure that changes takes two — the write, and
 * the look after it.
 */
const MAX_PASSES = 3;

/** The set of documents an evaluation was made of, whatever order they were read in. */
function linkSetKey(links: readonly CrmOpportunityLink[]): string {
  return links
    .map((link) => `${link.documentKind}:${link.documentId}`)
    .sort()
    .join(',');
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
   *
   * **The documents are read before the Command, never inside it** (research
   * N-S1). A port obtains an EntityManager of its own, so a transaction that
   * waits for one holds a connection while it asks for a second — and as many
   * recalculations at once as the pool has connections wait for each other
   * until the pool gives up. The Command locks the Opportunity, reads this
   * module's own tables and writes; it asks nobody.
   *
   * What the lock used to guarantee — that the figure left behind is the one
   * read last — is held by two checks instead:
   *
   * - **the link set**, re-read under the lock: one that differs from the set
   *   that was evaluated means the figure is of another set of documents, so
   *   nothing is written and the Opportunity is evaluated again;
   * - **a look after every write**: a figure is left only once an evaluation
   *   that *began after it was committed* agrees with it. Of two
   *   recalculations that overlap, whichever writes last looks again, and that
   *   look is later than anything either of them read.
   *
   * Bounded: after {@link MAX_PASSES} passes that did not settle, the figure
   * is left as it is and another recalculation is asked for off the request.
   */
  async recalculate(opportunityId: string): Promise<boolean> {
    if (!isUuid(opportunityId)) return false;
    let changed = false;
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const em = this.deps.emFactory();
      const visible = await em.findOne(CrmOpportunity, { id: opportunityId });
      if (!visible || visible.valueMode !== 'computed') return changed;
      const evaluated = await this.#evaluate(em, visible);

      const outcome = await this.deps.commandBus.run<'settled' | 'stale' | 'written'>({
        action: 'crm.opportunity.value_recalculate',
        objectType: 'crm_opportunity',
        objectId: visible.id,
        run: async ({ em: tx }) => {
          // Locked, so two recalculations of one Opportunity write one after
          // the other, and each compares against what the other left.
          const opportunity = await loadOpportunity(tx, visible.id, { lockMode: LockMode.PESSIMISTIC_WRITE });
          if (opportunity.valueMode !== 'computed') return { result: 'settled', skipAudit: true };
          const links = await tx.find(CrmOpportunityLink, { opportunityId: opportunity.id });
          if (linkSetKey(links) !== evaluated.linkSet) return { result: 'stale', skipAudit: true };
          if (opportunity.computedValue === evaluated.value) return { result: 'settled', skipAudit: true };
          opportunity.computedValue = evaluated.value;
          // Derived data: no audit entry, and no version bump — an edit form
          // open on the Opportunity is not invalidated by arithmetic.
          return { result: 'written', skipAudit: true };
        },
      });
      if (outcome === 'settled') return changed;
      if (outcome === 'written') changed = true;
    }
    // Still moving after every pass. The figure stays as the last pass left
    // it, and the queue is asked to look again.
    await this.deps.requestRecalculation(opportunityId);
    return changed;
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
   *
   * **One Opportunity that cannot be recalculated does not cost the others
   * theirs**: the pass goes on to the end and only then fails, naming how many
   * it left and the first few of them — so the job that ran it is retried, and
   * the retry has those few left to do. A module switched off is not such a
   * failure: it ends the pass there and then.
   */
  async recalculateAll(): Promise<number> {
    let changed = 0;
    let after = '';
    const failed: string[] = [];
    let firstFailure = '';
    const finish = (): number => {
      if (failed.length === 0) return changed;
      throw new Error(
        `crm: ${failed.length} computed opportunity value(s) could not be recalculated ` +
          `(${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ', …' : ''}): ${firstFailure}`,
      );
    };
    for (;;) {
      const page = await this.deps.emFactory().find(
        CrmOpportunity,
        { valueMode: 'computed', ...(after ? { id: { $gt: after } } : {}) },
        { orderBy: { id: 'asc' }, limit: RECALCULATE_ALL_PAGE, fields: ['id'] },
      );
      for (const opportunity of page) {
        try {
          if (await this.recalculate(opportunity.id)) changed += 1;
        } catch (error) {
          rethrowIfModuleDisabled(error);
          if (failed.length === 0) firstFailure = error instanceof Error ? error.message : String(error);
          failed.push(opportunity.id);
        }
      }
      const last = page[page.length - 1];
      if (!last || page.length < RECALCULATE_ALL_PAGE) return finish();
      after = last.id;
    }
  }

  /**
   * What a computed Opportunity is worth **now**, for its detail screen, with
   * the documents that figure leaves out. `null` for a manual one.
   *
   * Evaluated on read. The stored figure follows the events its documents
   * announce, and not every change is announced: a customer editing a Pending
   * Quote Request emits nothing (research N-S3). So the detail answers the
   * figure its own links add up to, and when that is not the stored one it
   * **asks for a recalculation and writes nothing** — a read is a read, and the
   * queue holds at most one request per Opportunity however often it is opened.
   *
   * **An excluded entry says something of the document** — that its status
   * counts and that it is in another currency — so it is named only to a
   * reader who may read that kind of document in the module that owns it
   * (research N-R13). The narrowing is here, on what is *shown*, and never in
   * the evaluation: the figure is the Opportunity's own and must be the same
   * whoever's request happened to ask for it.
   */
  async liveFigure(
    opportunity: CrmOpportunity,
  ): Promise<{ value: string; excludedDocuments: OpportunityExcludedDocument[] } | null> {
    if (opportunity.valueMode !== 'computed') return null;
    const { value, excludedDocuments } = await this.#evaluate(this.deps.emFactory(), opportunity);
    if (value !== opportunity.computedValue) await this.deps.requestRecalculation(opportunity.id);
    if (excludedDocuments.length === 0) return { value, excludedDocuments };
    const [orders, quoteRequests] = await Promise.all([
      this.deps.mayRead.orders(),
      this.deps.mayRead.quoteRequests(),
    ]);
    return {
      value,
      excludedDocuments: excludedDocuments.filter((document) => (document.kind === 'order' ? orders : quoteRequests)),
    };
  }

  /**
   * **`opportunity` was loaded through a tenant-scoped EntityManager by the
   * caller** — the links carry no tenant column of their own.
   */
  async #evaluate(
    em: EntityManager,
    opportunity: CrmOpportunity,
  ): Promise<OpportunityValueResult & { linkSet: string }> {
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

    const result = calculateOpportunityValue({
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
    return { ...result, linkSet: linkSetKey(links) };
  }
}
