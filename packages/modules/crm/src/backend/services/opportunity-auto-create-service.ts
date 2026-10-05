import {
  CRM_EVENTS,
  type OpportunityDocumentKind,
  type OpportunityDocumentLinkedEvent,
  type OrderReadPort,
  type OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { CRM_SETTING_CODES } from '../../manifest.js';
import type { CrmQuoteRequests } from './crm-quote-requests.js';
import type { OpportunityLinkService } from './opportunity-link-service.js';
import type { AutomaticOpportunityInput } from './opportunity-service.js';

export interface OpportunityAutoCreateServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  orders: OrderReadPort;
  organizations: OrganizationDetailsPort;
  settings: SettingsReadPort;
  /** Quote Requests, behind their presence decision. */
  quoteRequests: CrmQuoteRequests;
  links: Pick<OpportunityLinkService, 'linkOrderPlacedFromQuoteRequest' | 'opportunityIdOf'>;
  /** Creates the Opportunity and links the document in one Command. */
  createForDocument: (
    input: AutomaticOpportunityInput,
  ) => Promise<{ id: string; number: string } | 'already-linked'>;
  /** Announces the link — the creating Command has declared its one event already. */
  events: { emit(eventName: string, payload: OpportunityDocumentLinkedEvent): void };
  /** Injected so a test does not wait; `setTimeout` in the composed module. */
  sleep?: (milliseconds: number) => Promise<void>;
}

/** What became of one placed document — for the tests and for whoever reads a log. */
export type AutoCreateOutcome =
  | 'created'
  | 'joined'
  | 'already-linked'
  | 'setting-off'
  | 'document-not-found'
  | 'owner-absent';

/**
 * How long a handler waits for a document its event has announced: the pauses
 * between reads, in milliseconds — a little over two seconds in all.
 *
 * `orders` announces `order.created.v1` from **inside** the transaction that
 * places the Order (`order-service.ts`, the emit before the transactional
 * callback returns), and the bus runs a handler straight away. Measured through
 * the storefront route: a subscriber that reads the Order at once does not find
 * it on a cold connection and finds it five milliseconds later
 * (`research.md`, N-E7). So the first read is not the answer — a document that
 * is still missing after the last pause was rolled back, and nothing is created
 * for it.
 */
const COMMIT_WAIT_PAUSES = [10, 25, 75, 150, 250, 500, 1000] as const;

const booleanSetting = z.boolean();

/**
 * Automatic creation of an Opportunity for a placed Order or a submitted Quote
 * Request (`specs/143-crm-sales-opportunities/research.md` R-8, FR-060, FR-061).
 *
 * The decision for an Order, in this order:
 *
 * 1. it was placed from a Quote Request that is linked to an Opportunity → it
 *    joins that Opportunity, **whatever the setting says** (FR-027);
 * 2. it is linked already → nothing;
 * 3. `crm.auto_create_from_orders` is on for the Order's Sales Channel → an
 *    Opportunity is created for it and linked.
 *
 * For a Quote Request: linked already → nothing; else
 * `crm.auto_create_from_quote_requests` on → created and linked.
 *
 * **Idempotent.** The same event handled twice finds the link at step 2, and
 * two handlers racing past it are stopped by the unique `(document_kind,
 * document_id)` constraint inside the one creating Command.
 *
 * Every call runs in the subscriber's system scope. Nothing here catches a
 * port's refusal: `orders`, `organizations` and `settings` cannot be switched
 * off, and `quote_requests`' presence is decided before its port is asked.
 */
export class OpportunityAutoCreateService {
  constructor(private readonly deps: OpportunityAutoCreateServiceDeps) {}

  async onOrderCreated(orderId: string): Promise<AutoCreateOutcome> {
    const order = await this.#whenCommitted(() => this.deps.orders.findById(orderId));
    if (!order) return 'document-not-found';

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

  async onQuoteRequestCreated(quoteRequestId: string): Promise<AutoCreateOutcome> {
    // Presence first. The event comes from that module, so it is on — unless it
    // was switched off between the emit and this line.
    if (!this.deps.quoteRequests.isPresent()) return 'owner-absent';
    const quoteRequest = await this.#whenCommitted(() => this.deps.quoteRequests.load(quoteRequestId));
    if (!quoteRequest) return 'document-not-found';
    const { record } = quoteRequest;

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

  /** Read a document its event announced, allowing for a commit that is still in flight. */
  async #whenCommitted<T>(read: () => Promise<T | null>): Promise<T | null> {
    const sleep =
      this.deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    let found = await read();
    for (const pause of COMMIT_WAIT_PAUSES) {
      if (found !== null) return found;
      await sleep(pause);
      found = await read();
    }
    return found;
  }
}
