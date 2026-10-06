import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CRM_EVENTS,
  ERROR_CODES,
  type CreateOpportunityLinkRequest,
  type OpportunityDocumentLinkedEvent,
  type OpportunityLink,
  type OrderReadPort,
  type OrderRecord,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { randomUUID } from 'crypto';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityLink } from '../entities/crm-opportunity-link.entity.js';
import { isUuid, loadOpportunity } from './opportunity-access.js';
import type { OrdersReadCheck } from './orders-permission.js';

export interface OpportunityLinkServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** `orders`' read port — lazy, resolved per call. */
  orders: OrderReadPort;
  /** Whether the caller holds `orders:read`: without it a linked Order shows nothing of itself. */
  canReadOrders: OrdersReadCheck;
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

function toLink(link: CrmOpportunityLink, order: OrderRecord | undefined): OpportunityLink {
  return {
    id: link.id,
    documentKind: link.documentKind,
    documentId: link.documentId,
    available: order !== undefined,
    ...(order
      ? { number: order.businessId, status: order.status, total: order.total, currency: order.currency }
      : {}),
    syncStatus: link.syncStatus,
    linkSource: link.linkSource,
    createdAt: link.createdAt.toISOString(),
  };
}

/**
 * The documents linked to an Opportunity — Orders in this story
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
 */
export class OpportunityLinkService {
  constructor(private readonly deps: OpportunityLinkServiceDeps) {}

  async add(opportunityId: string, input: CreateOpportunityLinkRequest): Promise<OpportunityLink> {
    const em = this.deps.emFactory();
    const opportunity = await loadOpportunity(em, opportunityId);
    if (input.documentKind !== 'order') {
      // Quote Requests become linkable with the story that reads them.
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Only orders can be linked to an opportunity for now.',
      );
    }

    const order = await this.deps.orders.findById(input.documentId);
    if (!order) {
      throw new HttpError(404, ERROR_CODES.CRM_DOCUMENT_NOT_FOUND, 'Order not found.');
    }
    if (order.organizationId !== opportunity.organizationId) {
      throw new HttpError(
        422,
        ERROR_CODES.CRM_LINK_ORGANIZATION_MISMATCH,
        'The order belongs to a different organization than the opportunity.',
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
    return toLink(link, order);
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
   * A document the reader cannot see — gone, or out of their scope — renders as
   * unavailable rather than failing the screen it is listed on.
   */
  async #render(links: readonly CrmOpportunityLink[]): Promise<OpportunityLink[]> {
    const orderIds = links.filter((link) => link.documentKind === 'order').map((link) => link.documentId);
    // An Order's number, status and total are `orders`' to show: a caller
    // without `orders:read` sees that a document is linked, and no more.
    const orders =
      orderIds.length > 0 && (await this.deps.canReadOrders()) ? await this.deps.orders.findByIds(orderIds) : [];
    const byId = new Map(orders.map((order) => [order.id, order]));
    return links.map((link) => toLink(link, link.documentKind === 'order' ? byId.get(link.documentId) : undefined));
  }
}
