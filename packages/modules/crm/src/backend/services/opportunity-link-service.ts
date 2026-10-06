import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CRM_EVENTS,
  ERROR_CODES,
  type CreateOpportunityLinkRequest,
  type OpportunityDocumentKind,
  type OpportunityDocumentLinkedEvent,
  type OpportunityLink,
  type OpportunityLinkSource,
  type OrderReadPort,
  type OrderRecord,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { randomUUID } from 'crypto';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityLink } from '../entities/crm-opportunity-link.entity.js';
import type { CrmQuoteRequestDocument, CrmQuoteRequests } from './crm-quote-requests.js';
import { isUuid, loadOpportunity } from './opportunity-access.js';
import type { OrdersReadCheck } from './orders-permission.js';

export interface OpportunityLinkServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** `orders`' read port — lazy, resolved per call. */
  orders: OrderReadPort;
  /** Quote Requests, behind their presence decision. */
  quoteRequests: CrmQuoteRequests;
  /**
   * Told after an Opportunity gained or lost a link, once the change has
   * committed — what keeps a computed value following its documents.
   */
  linksChanged: (opportunityId: string) => Promise<unknown>;
  /** Whether the caller holds `orders:read`: without it a linked Order shows nothing of itself. */
  canReadOrders: OrdersReadCheck;
}

/** What a link is rendered from: the document as the reader may see it. */
type LinkedDocument =
  | { kind: 'order'; order: OrderRecord }
  | { kind: 'quote_request'; quoteRequest: CrmQuoteRequestDocument };

/** A link written by the system rather than asked for by an administrator. */
export interface AutomaticLink {
  opportunityId: string;
  documentKind: OpportunityDocumentKind;
  documentId: string;
  linkSource: Exclude<OpportunityLinkSource, 'manual'>;
}

function linkNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This document is not linked to this opportunity.');
}

function alreadyLinked(opportunityId?: string): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.CRM_DOCUMENT_ALREADY_LINKED,
    'This document is already linked to an opportunity.',
    opportunityId ? { opportunityId } : undefined,
  );
}

function documentFields(document: LinkedDocument | undefined): Partial<OpportunityLink> {
  if (!document) return {};
  if (document.kind === 'order') {
    const { order } = document;
    return { number: order.businessId, status: order.status, total: order.total, currency: order.currency };
  }
  const { record, amount, currency } = document.quoteRequest;
  return {
    number: record.businessId,
    status: record.status,
    total: amount,
    ...(currency ? { currency } : {}),
  };
}

function toLink(link: CrmOpportunityLink, document: LinkedDocument | undefined): OpportunityLink {
  return {
    id: link.id,
    documentKind: link.documentKind,
    documentId: link.documentId,
    available: document !== undefined,
    ...documentFields(document),
    syncStatus: link.syncStatus,
    linkSource: link.linkSource,
    createdAt: link.createdAt.toISOString(),
  };
}

/**
 * The documents linked to an Opportunity — Orders and Quote Requests
 * (`contracts/admin-api.md` §3).
 *
 * A link holds the document's id by value: the column is polymorphic, so there
 * is no foreign key, and **the owner's read port is the integrity check**. The
 * port reads under the caller's tenant scope, so an Order the caller may not
 * see does not exist for them; and an Order of another Organization than the
 * Opportunity is refused, which is what keeps a link from becoming a
 * cross-tenant window.
 *
 * A document belongs to at most one Opportunity. The unique constraint is the
 * authority for that; the look-up before the write only exists to name the
 * Opportunity that holds it.
 *
 * **Quote Requests degrade.** `quote_requests` is operator-switchable: while it
 * is off a linked Quote Request renders as unavailable, and linking one answers
 * 503 `MODULE_DISABLED` — decided from that module's presence before its port
 * is asked, never from a caught refusal. A Quote Request's status is its own:
 * `syncStatus` is stored and means nothing for one.
 */
export class OpportunityLinkService {
  constructor(private readonly deps: OpportunityLinkServiceDeps) {}

  async add(opportunityId: string, input: CreateOpportunityLinkRequest): Promise<OpportunityLink> {
    const em = this.deps.emFactory();
    const opportunity = await loadOpportunity(em, opportunityId);
    const { document, organizationId } = await this.#resolve(input.documentKind, input.documentId);
    if (organizationId !== opportunity.organizationId) {
      throw new HttpError(
        422,
        ERROR_CODES.CRM_LINK_ORGANIZATION_MISMATCH,
        'The document belongs to a different organization than the opportunity.',
      );
    }

    const holder = await em.findOne(CrmOpportunityLink, {
      documentKind: input.documentKind,
      documentId: input.documentId,
    });
    if (holder) {
      // Named only to a caller who could open it: a link is not tenant-filtered
      // by itself, so the holder is looked up again through the scoped parent.
      const visible = await em.findOne(CrmOpportunity, { id: holder.opportunityId });
      throw alreadyLinked(visible?.id);
    }

    let link: CrmOpportunityLink;
    try {
      link = await this.deps.commandBus.run({
        action: 'crm.opportunity.link_add',
        objectType: 'crm_opportunity',
        objectId: opportunity.id,
        run: async ({ em: tx, actor }) => {
          const parent = await loadOpportunity(tx, opportunityId);
          const created = tx.create(CrmOpportunityLink, {
            opportunityId: parent.id,
            documentKind: input.documentKind,
            documentId: input.documentId,
            syncStatus: input.syncStatus ?? true,
            linkSource: 'manual',
            linkedByAdminUserId: actor.actorAdminUserId,
          });
          return {
            result: created,
            before: null,
            after: {
              linkId: created.id,
              documentKind: created.documentKind,
              documentId: created.documentId,
              syncStatus: created.syncStatus,
              linkSource: created.linkSource,
            },
          };
        },
        event: (created) => {
          const payload: OpportunityDocumentLinkedEvent = {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            opportunityId: opportunity.id,
            organizationId: opportunity.organizationId,
            documentKind: created.documentKind,
            documentId: created.documentId,
            linkSource: created.linkSource,
          };
          return { eventName: CRM_EVENTS.DOCUMENT_LINKED, payload };
        },
      });
    } catch (error) {
      // Two requests linking one document at once: the look-up above let both
      // through and the unique constraint refused the second at commit. The
      // Command reads no other module's port, so nothing else can be mistaken
      // for this.
      if (error instanceof UniqueConstraintViolationException) throw alreadyLinked();
      throw error;
    }
    await this.deps.linksChanged(opportunity.id);
    return toLink(link, document);
  }

  /**
   * Link a document on the system's behalf — an Order placed from a linked
   * Quote Request, a document an Opportunity was created for. The caller has
   * read the document through its owner's port and holds an Opportunity of the
   * document's Organization.
   *
   * **Idempotent on the unique constraint**: a document that is already linked
   * — an event delivered twice, two handlers racing — answers `already-linked`
   * and writes nothing. The Command reads no other module's port, so nothing
   * else can be mistaken for that.
   */
  async linkAutomatically(link: AutomaticLink): Promise<'linked' | 'already-linked'> {
    const existing = await this.deps
      .emFactory()
      .findOne(CrmOpportunityLink, { documentKind: link.documentKind, documentId: link.documentId });
    if (existing) return 'already-linked';
    try {
      await this.deps.commandBus.run({
        action: 'crm.opportunity.link_add',
        objectType: 'crm_opportunity',
        objectId: link.opportunityId,
        run: async ({ em }) => {
          const parent = await loadOpportunity(em, link.opportunityId);
          const created = em.create(CrmOpportunityLink, {
            opportunityId: parent.id,
            documentKind: link.documentKind,
            documentId: link.documentId,
            syncStatus: true,
            linkSource: link.linkSource,
            linkedByAdminUserId: null,
          });
          return {
            result: { organizationId: parent.organizationId },
            before: null,
            after: {
              linkId: created.id,
              documentKind: created.documentKind,
              documentId: created.documentId,
              syncStatus: created.syncStatus,
              linkSource: created.linkSource,
            },
          };
        },
        event: (result) => {
          const payload: OpportunityDocumentLinkedEvent = {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            opportunityId: link.opportunityId,
            organizationId: result.organizationId,
            documentKind: link.documentKind,
            documentId: link.documentId,
            linkSource: link.linkSource,
          };
          return { eventName: CRM_EVENTS.DOCUMENT_LINKED, payload };
        },
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) return 'already-linked';
      throw error;
    }
    await this.deps.linksChanged(link.opportunityId);
    return 'linked';
  }

  /**
   * An Order placed from a Quote Request joins the Opportunity that Quote
   * Request is linked to (FR-027). Answers the Opportunity's id, or `null` when
   * the Order names no Quote Request or that one is linked nowhere.
   */
  async linkOrderPlacedFromQuoteRequest(order: OrderRecord): Promise<string | null> {
    if (!order.sourceQuoteRequestId) return null;
    const source = await this.deps
      .emFactory()
      .findOne(CrmOpportunityLink, { documentKind: 'quote_request', documentId: order.sourceQuoteRequestId });
    if (!source) return null;
    // The parent as the caller may see it, and of the Order's Organization: a
    // link never crosses a tenant, whatever an Order claims it came from.
    const opportunity = await this.deps.emFactory().findOne(CrmOpportunity, { id: source.opportunityId });
    if (!opportunity || opportunity.organizationId !== order.organizationId) return null;
    await this.linkAutomatically({
      opportunityId: opportunity.id,
      documentKind: 'order',
      documentId: order.id,
      linkSource: 'quote_conversion',
    });
    return opportunity.id;
  }

  /** The Opportunity a document is linked to, if any — unscoped; the caller constrains what it does with it. */
  async opportunityIdOf(documentKind: OpportunityDocumentKind, documentId: string): Promise<string | null> {
    const link = await this.deps.emFactory().findOne(CrmOpportunityLink, { documentKind, documentId });
    return link?.opportunityId ?? null;
  }

  async setSyncStatus(opportunityId: string, linkId: string, syncStatus: boolean): Promise<OpportunityLink> {
    const link = await this.deps.commandBus.run({
      action: 'crm.opportunity.link_sync_set',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const found = await this.#load(em, opportunityId, linkId);
        const before = { linkId: found.id, documentId: found.documentId, syncStatus: found.syncStatus };
        found.syncStatus = syncStatus;
        return { result: found, before, after: { ...before, syncStatus } };
      },
    });
    const [rendered] = await this.#render([link]);
    if (!rendered) throw linkNotFound();
    return rendered;
  }

  async remove(opportunityId: string, linkId: string): Promise<void> {
    await this.deps.commandBus.run({
      action: 'crm.opportunity.link_remove',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const found = await this.#load(em, opportunityId, linkId);
        const before = {
          linkId: found.id,
          documentKind: found.documentKind,
          documentId: found.documentId,
          syncStatus: found.syncStatus,
        };
        em.remove(found);
        return { result: undefined, before, after: null };
      },
    });
    await this.deps.linksChanged(opportunityId);
  }

  /** The Opportunity's links, oldest first, each rendered from its document as the reader may see it. */
  async list(opportunityId: string): Promise<OpportunityLink[]> {
    const em = this.deps.emFactory();
    const opportunity = await loadOpportunity(em, opportunityId);
    const links = await em.find(
      CrmOpportunityLink,
      { opportunityId: opportunity.id },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );
    return this.#render(links);
  }

  /** The parent through the scoped EntityManager first, then the child by `(opportunityId, id)`. */
  async #load(em: EntityManager, opportunityId: string, linkId: string): Promise<CrmOpportunityLink> {
    const opportunity = await loadOpportunity(em, opportunityId);
    if (!isUuid(linkId)) throw linkNotFound();
    const link = await em.findOne(CrmOpportunityLink, { id: linkId, opportunityId: opportunity.id });
    if (!link) throw linkNotFound();
    return link;
  }

  /**
   * The document a link request names, as the caller may see it, with the
   * Organization it belongs to. Missing and out of scope are one answer.
   */
  async #resolve(
    kind: OpportunityDocumentKind,
    documentId: string,
  ): Promise<{ document: LinkedDocument; organizationId: string }> {
    if (kind === 'order') {
      const order = await this.deps.orders.findById(documentId);
      if (!order) throw new HttpError(404, ERROR_CODES.CRM_DOCUMENT_NOT_FOUND, 'Order not found.');
      return { document: { kind, order }, organizationId: order.organizationId };
    }
    // Presence first. With the quote desk switched off there is nothing to
    // link to, and the answer is the one that module's own routes give.
    if (!this.deps.quoteRequests.isPresent()) throw new ModuleDisabledError('quote_requests');
    const quoteRequest = await this.deps.quoteRequests.load(documentId);
    if (!quoteRequest) {
      throw new HttpError(404, ERROR_CODES.CRM_DOCUMENT_NOT_FOUND, 'Quote request not found.');
    }
    return { document: { kind, quoteRequest }, organizationId: quoteRequest.record.organizationId };
  }

  /**
   * A document the reader cannot see — gone, out of their scope, or owned by a
   * module that is switched off — renders as unavailable rather than failing
   * the screen it is listed on.
   */
  async #render(links: readonly CrmOpportunityLink[]): Promise<OpportunityLink[]> {
    const orderIds = links.filter((link) => link.documentKind === 'order').map((link) => link.documentId);
    // An Order's number, status and total are `orders`' to show: a caller
    // without `orders:read` sees that a document is linked, and no more.
    const orders =
      orderIds.length > 0 && (await this.deps.canReadOrders()) ? await this.deps.orders.findByIds(orderIds) : [];
    const documents = new Map<string, LinkedDocument>(
      orders.map((order) => [`order:${order.id}`, { kind: 'order', order }]),
    );
    const quoteRequestIds = links
      .filter((link) => link.documentKind === 'quote_request')
      .map((link) => link.documentId);
    if (quoteRequestIds.length > 0 && this.deps.quoteRequests.isPresent()) {
      for (const id of quoteRequestIds) {
        const quoteRequest = await this.deps.quoteRequests.load(id);
        if (quoteRequest) documents.set(`quote_request:${id}`, { kind: 'quote_request', quoteRequest });
      }
    }
    return links.map((link) => toLink(link, documents.get(`${link.documentKind}:${link.documentId}`)));
  }
}
