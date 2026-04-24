import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type SendQuoteRequest } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import type { RfqEventBus } from './rfq-service.js';

/**
 * Admin-side RFQ workflow (T077).
 *
 * Every mutating method opens one EntityManager fork and uses it through every
 * sub-step so the entity identity map persists — otherwise the RFQ fetched by
 * a helper would be detached from the em doing the flush.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

export class RfqAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: RfqEventBus,
  ) {}

  async listAll(filter: { organizationId?: string; status?: string; assignedAdminUserId?: string } = {}): Promise<QuoteRequest[]> {
    const em = this.emFactory();
    const where: Record<string, unknown> = {};
    if (filter.organizationId) where['organizationId'] = filter.organizationId;
    if (filter.status) where['status'] = filter.status;
    if (filter.assignedAdminUserId) where['assignedAdminUserId'] = filter.assignedAdminUserId;
    return em.find(QuoteRequest, where, { orderBy: { createdAt: 'desc' } });
  }

  async getById(rfqId: string): Promise<QuoteRequest> {
    const em = this.emFactory();
    return this.#getByIdOn(em, rfqId);
  }

  async #getByIdOn(em: EntityManager, rfqId: string): Promise<QuoteRequest> {
    const rfq = await em.findOne(QuoteRequest, { id: rfqId });
    if (!rfq) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'RFQ not found.');
    return rfq;
  }

  async claim(rfqId: string, adminUserId: string): Promise<QuoteRequest> {
    const em = this.emFactory();
    const rfq = await this.#getByIdOn(em, rfqId);
    if (rfq.status !== 'new') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_NEW, 'RFQ is not in the "new" state.');
    }
    if (rfq.assignedAdminUserId) {
      throw new HttpError(409, ERROR_CODES.RFQ_ALREADY_CLAIMED, 'RFQ is already claimed.');
    }
    rfq.assignedAdminUserId = adminUserId;
    rfq.status = 'under_review';
    rfq.version += 1;
    await em.flush();
    this.events.emit('rfq.claimed.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      rfqId: rfq.id,
      adminUserId,
    });
    return rfq;
  }

  async sendQuote(rfqId: string, req: SendQuoteRequest): Promise<QuoteRequest> {
    const em = this.emFactory();
    const rfq = await this.#getByIdOn(em, rfqId);
    if (rfq.status !== 'under_review' && rfq.status !== 'new') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_NEW, 'RFQ cannot be quoted from its current state.');
    }

    const items = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id });
    // Every RFQ item must have a pricing entry; every pricing entry must match
    // an existing item. Partial quotes → 422 QUOTE_INCOMPLETE.
    const priceByItem = new Map(req.items.map((i) => [i.itemId, i]));
    const missingForItems = items.filter((it) => !priceByItem.has(it.id));
    const extraPricings = req.items.filter((p) => !items.some((it) => it.id === p.itemId));
    if (missingForItems.length > 0 || extraPricings.length > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.QUOTE_INCOMPLETE,
        'Every RFQ item must have exactly one pricing entry.',
      );
    }

    for (const item of items) {
      const price = priceByItem.get(item.id)!;
      item.quotedUnitPrice = price.quotedUnitPrice.toString();
      if (price.quotedDiscountPercent !== undefined) {
        item.quotedDiscountPercent = price.quotedDiscountPercent.toString();
      }
    }

    const expiresAt = new Date(Date.now() + req.terms.validityDays * MS_PER_DAY);
    rfq.quoteTerms = {
      leadTimeDays: req.terms.leadTimeDays,
      validityDays: req.terms.validityDays,
      deliveryTerms: req.terms.deliveryTerms ?? null,
      remarks: req.terms.remarks ?? null,
    };
    rfq.status = 'quoted';
    rfq.quotedAt = new Date();
    rfq.expiresAt = expiresAt;
    rfq.version += 1;
    await em.flush();

    this.events.emit('rfq.quoted.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      rfqId: rfq.id,
      expiresAt: expiresAt.toISOString(),
    });
    return rfq;
  }

  async decline(rfqId: string, message: string): Promise<QuoteRequest> {
    const em = this.emFactory();
    const rfq = await this.#getByIdOn(em, rfqId);
    if (rfq.status === 'accepted' || rfq.status === 'rejected' || rfq.status === 'expired') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_NEW, 'RFQ has already been resolved.');
    }
    rfq.status = 'rejected';
    rfq.respondedAt = new Date();
    rfq.requesterNote = `[supplier-decline] ${message}`;
    rfq.version += 1;
    await em.flush();

    this.events.emit('rfq.rejected.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      rfqId: rfq.id,
      reason: 'supplier_decline',
    });
    return rfq;
  }
}
