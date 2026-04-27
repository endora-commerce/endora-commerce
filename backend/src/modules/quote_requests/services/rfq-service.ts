import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type QuoteRequest as RfqDto } from '@b2b/contracts';
import type { EventBase, EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';

/**
 * Customer-facing RFQ service (T076).
 *
 * Business rules:
 *   - One open `draft` RFQ per (organization, customerAccount) — enforced by
 *     the partial unique index in migration 002 + by `getOrCreateDraft`.
 *   - Only `draft` RFQs are editable by the Customer; any item mutation on a
 *     submitted RFQ throws 409 RFQ_NOT_DRAFT.
 *   - Submit with zero items → 422 RFQ_EMPTY.
 *   - Accept on expired quote → 410 RFQ_EXPIRED (live check of `expiresAt` even
 *     before the scheduled expiry worker flips status).
 *   - Optimistic concurrency: PATCH path bumps `version` via a CAS UPDATE.
 *
 * Every public method opens one EntityManager fork (one unit-of-work) and uses
 * it throughout — entities fetched by sub-helpers stay attached to the same
 * `em`, so flushes land every change.
 */

export interface RfqEvents extends Record<string, EventBase> {
  'rfq.created.v1': EventBase & { rfqId: string; organizationId: string };
  'rfq.accepted.v1': EventBase & { rfqId: string };
  'rfq.rejected.v1': EventBase & { rfqId: string; reason: string };
  'rfq.claimed.v1': EventBase & { rfqId: string; adminUserId: string };
  'rfq.quoted.v1': EventBase & { rfqId: string; expiresAt: string };
}
export type RfqEventBus = EventBus<RfqEvents>;

export interface CustomerContext {
  customerAccountId: string;
  organizationId: string;
}

export class RfqService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: RfqEventBus,
  ) {}

  /** Public API convenience — creates its own em. Tests call this directly. */
  async getOrCreateDraft(ctx: CustomerContext): Promise<QuoteRequest> {
    const em = this.emFactory();
    return this.#getOrCreateDraftOn(em, ctx);
  }

  /** Internal variant that uses the caller's em (so entity identity is preserved). */
  async #getOrCreateDraftOn(em: EntityManager, ctx: CustomerContext): Promise<QuoteRequest> {
    let rfq = await em.findOne(QuoteRequest, {
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
      status: 'draft',
    });
    if (!rfq) {
      rfq = em.create(QuoteRequest, {
        organizationId: ctx.organizationId,
        customerAccountId: ctx.customerAccountId,
      });
      await em.persistAndFlush(rfq);
    }
    return rfq;
  }

  async getById(rfqId: string, ctx: CustomerContext): Promise<QuoteRequest> {
    const em = this.emFactory();
    const rfq = await em.findOne(QuoteRequest, {
      id: rfqId,
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
    });
    if (!rfq) {
      // 404 not 403 — avoid leaking existence (contracts/quote_requests.contract.md).
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'RFQ not found.');
    }
    return rfq;
  }

  async addItem(
    ctx: CustomerContext,
    input: { productId: string; variantId?: string | undefined; quantity: number; requesterNote?: string | undefined },
  ): Promise<QuoteRequest> {
    const em = this.emFactory();
    const rfq = await this.#getOrCreateDraftOn(em, ctx);
    this.assertDraft(rfq);

    if (input.quantity <= 0) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Quantity must be > 0.');
    }
    const product = await em.findOne(Product, { id: input.productId });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    const item = em.create(QuoteRequestItem, {
      quoteRequestId: rfq.id,
      productId: product.id,
      productName: this.anyValue(product.name),
      ...(input.variantId ? { variantId: input.variantId } : {}),
      quantity: input.quantity,
      ...(input.requesterNote ? { requesterNote: input.requesterNote } : {}),
    });
    rfq.version += 1;
    await em.persistAndFlush(item);
    await em.flush();
    return rfq;
  }

  async updateItem(
    ctx: CustomerContext,
    itemId: string,
    patch: { quantity?: number; requesterNote?: string | null },
    expectedVersion: number | null,
  ): Promise<QuoteRequest> {
    const em = this.emFactory();
    const item = await em.findOne(QuoteRequestItem, { id: itemId });
    if (!item) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'RFQ item not found.');

    const rfq = await em.findOne(QuoteRequest, { id: item.quoteRequestId });
    if (!rfq) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'RFQ not found.');
    if (
      rfq.organizationId !== ctx.organizationId ||
      rfq.customerAccountId !== ctx.customerAccountId
    ) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'RFQ not found.');
    }
    this.assertDraft(rfq);

    // Optimistic concurrency — CAS on the RFQ's version column. Two concurrent
    // PATCHes with the same If-Match race here; exactly one's UPDATE matches,
    // the other hits 0 rows and we raise 409 VERSION_CONFLICT.
    if (expectedVersion !== null) {
      const updated = await em.nativeUpdate(
        QuoteRequest,
        { id: rfq.id, version: expectedVersion },
        { version: expectedVersion + 1 },
      );
      if (updated === 0) {
        throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'RFQ was updated concurrently.');
      }
    } else {
      rfq.version += 1;
      await em.flush();
    }

    if (patch.quantity !== undefined) {
      if (patch.quantity <= 0) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Quantity must be > 0.');
      }
      item.quantity = patch.quantity;
    }
    if (patch.requesterNote !== undefined) {
      item.requesterNote = patch.requesterNote;
    }
    await em.flush();

    // Re-read to pick up the CAS-bumped version.
    const fresh = await em.findOne(QuoteRequest, { id: rfq.id });
    return fresh ?? rfq;
  }

  async removeItem(ctx: CustomerContext, itemId: string): Promise<QuoteRequest> {
    const em = this.emFactory();
    const item = await em.findOne(QuoteRequestItem, { id: itemId });
    if (!item) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'RFQ item not found.');

    const rfq = await em.findOne(QuoteRequest, { id: item.quoteRequestId });
    if (!rfq) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'RFQ not found.');
    if (
      rfq.organizationId !== ctx.organizationId ||
      rfq.customerAccountId !== ctx.customerAccountId
    ) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'RFQ not found.');
    }
    this.assertDraft(rfq);
    await em.removeAndFlush(item);
    rfq.version += 1;
    await em.flush();
    return rfq;
  }

  async submit(ctx: CustomerContext, requesterNote?: string): Promise<QuoteRequest> {
    const em = this.emFactory();
    const rfq = await this.#getOrCreateDraftOn(em, ctx);
    this.assertDraft(rfq);

    const items = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id });
    if (items.length === 0) {
      throw new HttpError(422, ERROR_CODES.RFQ_EMPTY, 'RFQ has no items.');
    }

    rfq.status = 'new';
    rfq.submittedAt = new Date();
    if (requesterNote !== undefined) rfq.requesterNote = requesterNote;
    rfq.version += 1;
    await em.flush();

    this.events.emit('rfq.created.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      rfqId: rfq.id,
      organizationId: rfq.organizationId,
    });
    return rfq;
  }

  async accept(rfqId: string, ctx: CustomerContext): Promise<QuoteRequest> {
    const em = this.emFactory();
    const rfq = await em.findOne(QuoteRequest, {
      id: rfqId,
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
    });
    if (!rfq) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'RFQ not found.');
    if (rfq.status !== 'quoted') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'RFQ is not in the "quoted" state.');
    }
    if (rfq.expiresAt && rfq.expiresAt.getTime() <= Date.now()) {
      // Live-time expiry check — covers the window before the expiry worker runs.
      throw new HttpError(410, ERROR_CODES.RFQ_EXPIRED, 'Quote has expired.');
    }
    rfq.status = 'accepted';
    rfq.respondedAt = new Date();
    rfq.version += 1;
    await em.flush();

    this.events.emit('rfq.accepted.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      rfqId: rfq.id,
    });
    return rfq;
  }

  async reject(
    rfqId: string,
    ctx: CustomerContext,
    input: { reason: 'price' | 'terms' | 'other'; message?: string | undefined; requestChanges?: boolean | undefined },
  ): Promise<QuoteRequest> {
    const em = this.emFactory();
    const rfq = await em.findOne(QuoteRequest, {
      id: rfqId,
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
    });
    if (!rfq) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'RFQ not found.');
    if (rfq.status !== 'quoted') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'RFQ is not in the "quoted" state.');
    }
    rfq.status = input.requestChanges ? 'under_review' : 'rejected';
    rfq.respondedAt = new Date();
    rfq.version += 1;
    await em.flush();

    this.events.emit('rfq.rejected.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      rfqId: rfq.id,
      reason: input.reason,
    });
    return rfq;
  }

  async list(ctx: CustomerContext): Promise<QuoteRequest[]> {
    const em = this.emFactory();
    return em.find(
      QuoteRequest,
      { organizationId: ctx.organizationId, customerAccountId: ctx.customerAccountId },
      { orderBy: { createdAt: 'desc' } },
    );
  }

  private assertDraft(rfq: QuoteRequest): void {
    if (rfq.status !== 'draft') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_DRAFT, 'RFQ is not in the "draft" state.');
    }
  }

  private anyValue(blob: Record<string, string>): string {
    const k = Object.keys(blob)[0];
    return k ? (blob[k] ?? '') : '';
  }
}

export async function loadRfqWithItems(
  em: EntityManager,
  rfq: QuoteRequest,
): Promise<RfqDto> {
  const items = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id });
  return serializeRfq(rfq, items);
}

export function serializeRfq(rfq: QuoteRequest, items: QuoteRequestItem[]): RfqDto {
  return {
    id: rfq.id,
    organizationId: rfq.organizationId,
    customerAccountId: rfq.customerAccountId,
    ...(rfq.assignedAdminUserId !== undefined ? { assignedAdminUserId: rfq.assignedAdminUserId } : {}),
    status: rfq.status,
    requesterNote: rfq.requesterNote ?? null,
    items: items.map((it) => ({
      id: it.id,
      productId: it.productId,
      productName: it.productName,
      variantId: it.variantId ?? null,
      variantLabel: it.variantLabel ?? null,
      quantity: it.quantity,
      requesterNote: it.requesterNote ?? null,
      quotedUnitPrice: it.quotedUnitPrice != null ? Number(it.quotedUnitPrice) : null,
      quotedDiscountPercent: it.quotedDiscountPercent != null ? Number(it.quotedDiscountPercent) : null,
    })),
    quoteTerms: rfq.quoteTerms
      ? {
          leadTimeDays: rfq.quoteTerms.leadTimeDays,
          validityDays: rfq.quoteTerms.validityDays,
          deliveryTerms: rfq.quoteTerms.deliveryTerms ?? null,
          remarks: rfq.quoteTerms.remarks ?? null,
        }
      : null,
    submittedAt: rfq.submittedAt?.toISOString() ?? null,
    quotedAt: rfq.quotedAt?.toISOString() ?? null,
    respondedAt: rfq.respondedAt?.toISOString() ?? null,
    expiresAt: rfq.expiresAt?.toISOString() ?? null,
    createdAt: rfq.createdAt.toISOString(),
    updatedAt: rfq.updatedAt.toISOString(),
    version: rfq.version,
  };
}
