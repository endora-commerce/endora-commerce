import {
  CRM_EVENTS,
  type OpportunityDocumentKind,
  type OpportunityDocumentLinkedEvent,
  type OrderReadPort,
  type OrderRecord,
  type OrganizationDetailsPort,
  type OriginReference,
} from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { CRM_SETTING_CODES } from '../../manifest.js';
import type { CrmQuoteRequestDocument, CrmQuoteRequests } from './crm-quote-requests.js';
import type { OpportunityLinkService } from './opportunity-link-service.js';
import type { OriginatedDocument, OriginLinkOutcome } from './opportunity-origin-link-service.js';
import type { AutomaticOpportunityInput } from './opportunity-service.js';

export interface OpportunityAutoCreateServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  orders: OrderReadPort;
  organizations: OrganizationDetailsPort;
  settings: SettingsReadPort;
  /** Quote Requests, behind their presence decision. */
  quoteRequests: CrmQuoteRequests;
  links: Pick<OpportunityLinkService, 'linkOrderPlacedFromQuoteRequest' | 'opportunityIdOf'>;
  /**
   * Links a document to the Opportunity its `origin` names (User Story 10) —
   * the checks are that service's. Absent in a composition that knows no origin.
   */
  linkByOrigin?: (origin: OriginReference, document: OriginatedDocument) => Promise<OriginLinkOutcome>;
  /** Creates the Opportunity and links the document in one Command. */
  createForDocument: (
    input: AutomaticOpportunityInput,
  ) => Promise<{ id: string; number: string } | 'already-linked'>;
  /** Announces the link — the creating Command has declared its one event already. */
  events: { emit(eventName: string, payload: OpportunityDocumentLinkedEvent): void };
  /**
   * Runs `work` **off the bus's dispatch chain**, in a scope of its own, and
   * answers when it has finished — never rejecting. The composition supplies
   * it; see {@link OpportunityAutoCreateService} for why the wait must not be
   * awaited by the handler.
   */
  defer: (work: () => Promise<unknown>) => Promise<void>;
  /**
   * Whether this module is still present. A deferred look waits up to two
   * seconds, and an operator may switch the module off in any of them: it is
   * asked after every pause, right before the document is read and handled.
   */
  stillPresent: () => boolean;
  /** Injected so a test does not wait; `setTimeout` in the composed module. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** What became of one placed document — for the tests and for whoever reads a log. */
export type AutoCreateOutcome =
  | 'created'
  | 'joined'
  /** Linked to the Opportunity the document was created from. */
  | 'linked-to-origin'
  | 'already-linked'
  | 'setting-off'
  | 'document-not-found'
  | 'owner-absent'
  /** The document was not readable yet; it is read again off the bus's chain. */
  | 'deferred';

/**
 * How long a handler waits for a document its event has announced: the pauses
 * between reads, in milliseconds — a little over two seconds in all.
 *
 * `orders` announces `order.created.v1` once the transaction that places the
 * Order has committed (issue #171), so a first read normally finds it and this
 * wait is not entered. It is kept as a second line: until that fix the event
 * was emitted from **inside** the transaction and a subscriber that read the
 * Order at once did not find it on a cold connection (`research.md`, N-E7). A
 * document that is still missing after the last pause is treated as not
 * placed, and nothing is created for it.
 */
const COMMIT_WAIT_PAUSES = [10, 25, 75, 150, 250, 500, 1000] as const;

/** What a deferred look found, once it has looked for the last time. */
type Placed<T> = (document: T) => Promise<AutoCreateOutcome>;

const booleanSetting = z.boolean();

/**
 * Automatic creation of an Opportunity for a placed Order or a submitted Quote
 * Request (`specs/143-crm-sales-opportunities/research.md` R-8, FR-060, FR-061).
 *
 * The decision for an Order, in this order:
 *
 * 0. it was created from an Opportunity (its event carries an `origin` naming
 *    one, and the claim holds) → it is linked to **that** Opportunity,
 *    whatever the setting says, and none is created for it (FR-026). An origin
 *    that does not hold is as good as none;
 * 1. it was placed from a Quote Request that is linked to an Opportunity → it
 *    joins that Opportunity, **whatever the setting says** (FR-027);
 * 2. it is linked already → nothing;
 * 3. `crm.auto_create_from_orders` is on for the Order's Sales Channel → an
 *    Opportunity is created for it and linked.
 *
 * For a Quote Request: created from an Opportunity → linked to it; linked
 * already → nothing; else `crm.auto_create_from_quote_requests` on → created
 * and linked. One an administrator creates is announced by
 * `rfq.created_by_admin.v1` and takes the same path.
 *
 * **Idempotent.** The same event handled twice finds the link at step 2, and
 * two handlers racing past it are stopped by the unique `(document_kind,
 * document_id)` constraint inside the one creating Command.
 *
 * **A document that is not readable yet is not waited for on the bus.** The
 * bus runs the subscribers of an event one after another and awaits each, so a
 * handler that slept until a commit landed would hold every later subscriber
 * of `order.created.v1` — the webhook bridge among them — for as long as it
 * slept, and for the whole two seconds when the placement was rolled back. So
 * the handler reads once; if the document is there it is handled at once, and
 * if it is not, the reads that follow are handed to `defer`, which runs them
 * off the chain in a scope of their own. {@link idle} answers when nothing
 * deferred is still running.
 *
 * Every call runs in the subscriber's system scope. Nothing here catches a
 * port's refusal: `orders`, `organizations` and `settings` cannot be switched
 * off, and `quote_requests`' presence is decided before its port is asked.
 */
export class OpportunityAutoCreateService {
  readonly #deferred = new Set<Promise<void>>();

  constructor(private readonly deps: OpportunityAutoCreateServiceDeps) {}

  /** Resolves once no deferred look is still running — for a test, or a shutdown, to wait on. */
  async idle(): Promise<void> {
    while (this.#deferred.size > 0) await Promise.all([...this.#deferred]);
  }

  async onOrderCreated(orderId: string, origin: OriginReference | null = null): Promise<AutoCreateOutcome> {
    const read = () => this.deps.orders.findById(orderId);
    const order = await read();
    return order
      ? this.#placedOrder(order, origin)
      : this.#lookAgain(read, (late) => this.#placedOrder(late, origin));
  }

  async #placedOrder(order: OrderRecord, origin: OriginReference | null): Promise<AutoCreateOutcome> {
    // First, and before anything is created: an Order created from an
    // Opportunity must not get a second one. `order.created.v1` names no actor.
    const linked = await this.#linkToOrigin(origin, {
      kind: 'order',
      id: order.id,
      organizationId: order.organizationId,
      createdByAdminUserId: null,
    });
    if (linked) return linked;
    if (await this.deps.links.linkOrderPlacedFromQuoteRequest(order)) return 'joined';
    if (await this.deps.links.opportunityIdOf('order', order.id)) return 'already-linked';

    const enabled = await this.deps.settings.get(
      CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS,
      order.salesChannelId,
      booleanSetting,
    );
    if (!enabled) return 'setting-off';

    return this.#create({
      title: await this.#title(order.businessId, order.organizationId),
      organizationId: order.organizationId,
      currency: order.currency,
      salesChannelId: order.salesChannelId,
      source: 'order',
      document: { kind: 'order', id: order.id },
    });
  }

  /**
   * `origin` and `createdByAdminUserId` come with `rfq.created_by_admin.v1`;
   * a Quote Request a customer submits has neither.
   */
  async onQuoteRequestCreated(
    quoteRequestId: string,
    origin: OriginReference | null = null,
    createdByAdminUserId: string | null = null,
  ): Promise<AutoCreateOutcome> {
    const submitted = (quoteRequest: CrmQuoteRequestDocument) =>
      this.#submittedQuoteRequest(quoteRequest, origin, createdByAdminUserId);
    // Presence first. The event comes from that module, so it is on — unless it
    // was switched off between the emit and this line.
    if (!this.deps.quoteRequests.isPresent()) return 'owner-absent';
    // Asked again before every later read: a look that was deferred must not
    // find the module switched off underneath it.
    const read = async () =>
      this.deps.quoteRequests.isPresent() ? this.deps.quoteRequests.load(quoteRequestId) : null;
    const quoteRequest = await read();
    return quoteRequest ? submitted(quoteRequest) : this.#lookAgain(read, submitted);
  }

  async #submittedQuoteRequest(
    quoteRequest: CrmQuoteRequestDocument,
    origin: OriginReference | null,
    createdByAdminUserId: string | null,
  ): Promise<AutoCreateOutcome> {
    const { record } = quoteRequest;

    const linked = await this.#linkToOrigin(origin, {
      kind: 'quote_request',
      id: record.id,
      organizationId: record.organizationId,
      createdByAdminUserId,
    });
    if (linked) return linked;

    if (await this.deps.links.opportunityIdOf('quote_request', record.id)) return 'already-linked';

    // Platform-wide: `quoteRequestReadPort` does not publish the Sales Channel a
    // Quote Request was submitted on, so there is none to read the setting for,
    // and the Opportunity is created without one.
    const enabled = await this.deps.settings.get(
      CRM_SETTING_CODES.AUTO_CREATE_FROM_QUOTE_REQUESTS,
      null,
      booleanSetting,
    );
    if (!enabled) return 'setting-off';
    // A Quote Request cannot be submitted without a line; one that has none
    // has no currency to give an Opportunity.
    if (quoteRequest.currency === null) return 'document-not-found';

    return this.#create({
      title: await this.#title(record.businessId, record.organizationId),
      organizationId: record.organizationId,
      currency: quoteRequest.currency,
      salesChannelId: null,
      source: 'quote_request',
      document: { kind: 'quote_request', id: record.id },
    });
  }

  /**
   * The outcome when the document's origin settled where it belongs, or `null`
   * when the document is to be handled as one that had no origin.
   */
  async #linkToOrigin(
    origin: OriginReference | null,
    document: OriginatedDocument,
  ): Promise<AutoCreateOutcome | null> {
    if (!origin || !this.deps.linkByOrigin) return null;
    const outcome = await this.deps.linkByOrigin(origin, document);
    if (outcome === 'linked') return 'linked-to-origin';
    return outcome === 'already-linked' ? 'already-linked' : null;
  }

  async #create(input: AutomaticOpportunityInput): Promise<AutoCreateOutcome> {
    const created = await this.deps.createForDocument(input);
    if (created === 'already-linked') return 'already-linked';
    this.#announceLink(created.id, input.organizationId, input.document.kind, input.document.id);
    return 'created';
  }

  /** After the commit, and only for a link that was written. */
  #announceLink(
    opportunityId: string,
    organizationId: string,
    documentKind: OpportunityDocumentKind,
    documentId: string,
  ): void {
    this.deps.events.emit(CRM_EVENTS.DOCUMENT_LINKED, {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      opportunityId,
      organizationId,
      documentKind,
      documentId,
      linkSource: 'auto',
    });
  }

  /** "`<document number>` — `<organization name>`". */
  async #title(documentNumber: string, organizationId: string): Promise<string> {
    const organization = await this.deps.organizations.findById(organizationId);
    return organization?.name ? `${documentNumber} — ${organization.name}` : documentNumber;
  }

  /**
   * The document was not there on the first read: its commit may still be in
   * flight. Look again — after each pause, off the bus's chain — and handle it
   * when it appears; a document that never does was rolled back.
   */
  #lookAgain<T>(read: () => Promise<T | null>, placed: Placed<T>): AutoCreateOutcome {
    const sleep =
      this.deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const looking = this.deps.defer(async () => {
      for (const pause of COMMIT_WAIT_PAUSES) {
        await sleep(pause);
        // Off behaves as if never installed: nothing is read, nothing created.
        if (!this.deps.stillPresent()) return;
        const found = await read();
        if (found !== null) {
          await placed(found);
          return;
        }
      }
    });
    this.#deferred.add(looking);
    void looking.then(() => this.#deferred.delete(looking));
    return 'deferred';
  }
}
