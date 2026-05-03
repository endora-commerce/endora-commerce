import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminCreateQuoteRequest,
  type AdminPatchQuoteRequest,
  type QuoteRequest as RfqDto,
  type QuoteRequestSummary,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { QuoteRequest, type QuoteRequestStatus } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { RfqService, type RfqEventBus } from './rfq-service.js';
import { RfqEventService } from './rfq-event-service.js';
import { RfqRevisionService } from './rfq-revision-service.js';
import { RfqNotificationService } from './rfq-notification-service.js';
import { SalesRepAssignmentService } from '../../organizations/services/sales-rep-assignment-service.js';

/**
 * Admin-facing Quote Requests service — feature 008 workflow.
 *
 * Endpoints implemented:
 *   - listAll(scope)       (US2)
 *   - getById              (US2)
 *   - approve              (US2)
 *   - cancel               (US2)
 *   - assign               (US2)
 *   - modify               (US3)
 *   - createOnBehalf       (US4)
 *
 * Visibility scoping is centralised in `SalesRepAssignmentService.canSeeOrganization`
 * (research §R2). Platform admins skip the predicate.
 */

export interface AdminContext {
  adminUserId: string;
  isPlatformAdmin: boolean;
  /** Display label embedded in event records ('Sales representative', 'Platform administrator', …) */
  roleLabel: string;
}

export type AdminAssignmentScope = 'mine' | 'unassigned' | 'all';

export interface AdminListFilter {
  scope?: AdminAssignmentScope;
  status?: QuoteRequestStatus | QuoteRequestStatus[];
  organizationId?: string;
}

export interface RfqAdminServiceDeps {
  emFactory: () => EntityManager;
  events: RfqEventBus;
  rfqService: RfqService;
  eventService: RfqEventService;
  revisionService: RfqRevisionService;
  notificationService: RfqNotificationService;
  salesRepAssignment: SalesRepAssignmentService;
}

export class RfqAdminService {
  constructor(private readonly deps: RfqAdminServiceDeps) {}

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  async listAll(ctx: AdminContext, filter: AdminListFilter = {}): Promise<QuoteRequestSummary[]> {
    const em = this.deps.emFactory();
    const where: Record<string, unknown> = {};
    if (filter.organizationId) where['organizationId'] = filter.organizationId;
    if (filter.status) where['status'] = filter.status;

    let rfqs: QuoteRequest[] = await em.find(QuoteRequest, where, {
      orderBy: { createdAt: 'desc' },
    });

    // Visibility scoping (skipped for platform admin)
    if (!ctx.isPlatformAdmin) {
      const visible = await Promise.all(
        rfqs.map((r) =>
          this.deps.salesRepAssignment.canSeeOrganization(ctx.adminUserId, r.organizationId),
        ),
      );
      rfqs = rfqs.filter((_, i) => visible[i]);
    }

    if (filter.scope === 'mine') {
      const assigned = new Set(
        await this.deps.salesRepAssignment.listAssignedOrganizationIds(ctx.adminUserId),
      );
      rfqs = rfqs.filter((r) => assigned.has(r.organizationId));
    } else if (filter.scope === 'unassigned') {
      const flagged = await Promise.all(rfqs.map((r) => this.isUnassigned(em, r.organizationId)));
      rfqs = rfqs.filter((_, i) => flagged[i]);
    }

    if (rfqs.length === 0) return [];

    const items = await em.find(QuoteRequestItem, {
      quoteRequestId: { $in: rfqs.map((r) => r.id) },
    });
    const itemsByRfq = groupBy(items, (i) => i.quoteRequestId);

    const orgs = await em.find(Organization, { id: { $in: rfqs.map((r) => r.organizationId) } });
    const orgById = new Map(orgs.map((o) => [o.id, o]));

    const customers = await em.find(CustomerAccount, {
      id: { $in: rfqs.map((r) => r.customerAccountId) },
    });
    const customerById = new Map(customers.map((c) => [c.id, c]));

    return rfqs.map((rfq) => {
      const rfqItems = itemsByRfq.get(rfq.id) ?? [];
      const customer = customerById.get(rfq.customerAccountId);
      const org = orgById.get(rfq.organizationId);
      const totalAtAgreedPrice = rfqItems.every((it) => it.agreedUnitPrice != null)
        ? rfqItems.reduce(
            (sum, it) => sum + Number(it.agreedUnitPrice ?? 0) * it.quantity,
            0,
          )
        : null;
      const totalAtCustomerPrice = rfqItems.every((it) => it.desiredUnitPrice != null)
        ? rfqItems.reduce(
            (sum, it) => sum + Number(it.desiredUnitPrice ?? 0) * it.quantity,
            0,
          )
        : null;
      return {
        id: rfq.id,
        organizationId: rfq.organizationId,
        customerAccountId: rfq.customerAccountId,
        status: rfq.status,
        awaitingCustomerRevisionAcceptance: rfq.awaitingCustomerRevisionAcceptance,
        lineCount: rfqItems.length,
        totalAtCustomerPrice,
        totalAtAgreedPrice,
        currency: rfqItems[0]?.lineCurrency ?? 'PLN',
        submittedAt: rfq.submittedAt?.toISOString() ?? null,
        expiresAt: rfq.expiresAt?.toISOString() ?? null,
        createdAt: rfq.createdAt.toISOString(),
        updatedAt: rfq.updatedAt.toISOString(),
        version: rfq.version,
        organizationName: org?.name ?? '',
        customerDisplayName: customer ? customerDisplayName(customer) : null,
      };
    });
  }

  async getById(ctx: AdminContext, rfqId: string): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    return this.deps.rfqService.serializeFull(em, rfq, /* includeFullActorIdentity */ true);
  }

  // -------------------------------------------------------------------------
  // Approve (US2)
  // -------------------------------------------------------------------------

  async approve(
    ctx: AdminContext,
    rfqId: string,
    expectedVersion: number | null,
    note: string | undefined,
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    if (rfq.status !== 'Pending') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request is not pending approval.');
    }
    this.assertVersion(rfq, expectedVersion);

    const now = new Date();
    rfq.status = 'Approved';
    rfq.approvedAt = now;
    rfq.awaitingCustomerRevisionAcceptance = false;
    rfq.assignedAdminUserId = ctx.adminUserId;
    rfq.version += 1;
    await em.flush();

    if (note && note.trim().length > 0) {
      await this.deps.eventService.append({
        quoteRequestId: rfq.id,
        eventType: 'note-added',
        actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
        payload: { type: 'note-added', note },
      });
    }
    const evt = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'approved',
      actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
      payload: { type: 'approved', approvedBy: 'admin' },
    });

    await this.deps.notificationService.enqueue({
      quoteRequestId: rfq.id,
      sourceEventId: evt.id,
      recipients: [{ customerAccountId: rfq.customerAccountId }],
      channels: ['email', 'in_app'],
    });

    this.deps.events.emit('rfq.approved.v1', {
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      rfqId: rfq.id,
    });

    return this.deps.rfqService.serializeFull(em, rfq, true);
  }

  // -------------------------------------------------------------------------
  // Cancel (US2)
  // -------------------------------------------------------------------------

  async cancel(
    ctx: AdminContext,
    rfqId: string,
    expectedVersion: number | null,
    reason: string | undefined,
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    if (rfq.status !== 'Pending' && rfq.status !== 'Created from admin') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request cannot be canceled in its current state.');
    }
    this.assertVersion(rfq, expectedVersion);

    const now = new Date();
    rfq.status = 'Canceled';
    rfq.canceledAt = now;
    rfq.awaitingCustomerRevisionAcceptance = false;
    if (reason) rfq.cancellationReason = reason;
    rfq.assignedAdminUserId = ctx.adminUserId;
    rfq.version += 1;
    await em.flush();

    const evt = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'canceled',
      actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
      payload: { type: 'canceled', canceledBy: 'admin', reason: reason ?? null },
    });

    await this.deps.notificationService.enqueue({
      quoteRequestId: rfq.id,
      sourceEventId: evt.id,
      recipients: [{ customerAccountId: rfq.customerAccountId }],
      channels: ['email', 'in_app'],
    });

    this.deps.events.emit('rfq.canceled.v1', {
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      rfqId: rfq.id,
      reason: reason ?? null,
    });

    return this.deps.rfqService.serializeFull(em, rfq, true);
  }

  // -------------------------------------------------------------------------
  // Internal-side claim (informational; visibility is per-org, not per-rfq)
  // -------------------------------------------------------------------------

  async assign(ctx: AdminContext, rfqId: string, targetAdminUserId: string): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    rfq.assignedAdminUserId = targetAdminUserId;
    rfq.version += 1;
    await em.flush();
    return this.deps.rfqService.serializeFull(em, rfq, true);
  }

  // -------------------------------------------------------------------------
  // Modify (US3) — also handles edits to Created from admin (US4)
  // -------------------------------------------------------------------------

  async modify(
    ctx: AdminContext,
    rfqId: string,
    expectedVersion: number | null,
    body: AdminPatchQuoteRequest,
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForAdmin(em, ctx, rfqId);
    if (rfq.status !== 'Pending' && rfq.status !== 'Created from admin') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request is not editable.');
    }
    this.assertVersion(rfq, expectedVersion);

    if (body.headerNote !== undefined) rfq.headerNote = body.headerNote ?? null;

    if (body.items) {
      const products = await em.find(Product, { id: { $in: body.items.map((it) => it.productId) } });
      const productById = new Map(products.map((p) => [p.id, p]));
      if (productById.size !== new Set(body.items.map((it) => it.productId)).size) {
        throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'One or more products do not exist.');
      }
      const existing = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id });
      await em.removeAndFlush(existing);
      const items: QuoteRequestItem[] = [];
      for (const lineInput of body.items) {
        const product = productById.get(lineInput.productId)!;
        items.push(
          em.create(QuoteRequestItem, {
            quoteRequestId: rfq.id,
            productId: product.id,
            productName: anyLocaleValue(product.name),
            productSlug: product.slug,
            variantId: lineInput.variantId ?? null,
            quantity: lineInput.quantity,
            agreedUnitPrice:
              lineInput.agreedUnitPrice !== undefined && lineInput.agreedUnitPrice !== null
                ? lineInput.agreedUnitPrice.toFixed(2)
                : null,
            lineNote: lineInput.lineNote ?? null,
            lineCurrency: 'PLN',
          }),
        );
      }
      await em.persistAndFlush(items);
    }

    rfq.currentRevisionNumber += 1;
    rfq.awaitingCustomerRevisionAcceptance = true;
    rfq.assignedAdminUserId = ctx.adminUserId;
    if (body.expiresInDays !== undefined) {
      rfq.expiresAt = new Date(Date.now() + body.expiresInDays * 86_400_000);
    }
    rfq.version += 1;
    await em.flush();

    const items = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id });
    const previousRevision = await this.deps.revisionService.byNumber(
      rfq.id,
      rfq.currentRevisionNumber - 1,
    );
    const revision = await this.deps.revisionService.record({
      rfq,
      items,
      actor: { adminUserId: ctx.adminUserId },
      previousRevisionId: previousRevision?.id ?? null,
    });

    const diff = previousRevision
      ? this.deps.revisionService.diffRevisions({
          beforeHeaderNote: previousRevision.headerNoteSnapshot ?? null,
          afterHeaderNote: rfq.headerNote ?? null,
          beforeItems: previousRevision.itemsSnapshot,
          afterItems: revision.itemsSnapshot,
        })
      : [];

    const evt = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'modified',
      actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
      payload: { type: 'modified', diff },
      revisionId: revision.id,
    });

    await this.deps.notificationService.enqueue({
      quoteRequestId: rfq.id,
      sourceEventId: evt.id,
      recipients: [{ customerAccountId: rfq.customerAccountId }],
      channels: ['email', 'in_app'],
    });

    this.deps.events.emit('rfq.modified.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      rfqId: rfq.id,
      revisionNumber: rfq.currentRevisionNumber,
    });

    return this.deps.rfqService.serializeFull(em, rfq, true);
  }

  // -------------------------------------------------------------------------
  // Create on behalf (US4)
  // -------------------------------------------------------------------------

  async createOnBehalf(
    ctx: AdminContext,
    body: AdminCreateQuoteRequest,
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();

    // Visibility on the target organization (platform_admin always passes).
    if (
      !ctx.isPlatformAdmin &&
      !(await this.deps.salesRepAssignment.canSeeOrganization(ctx.adminUserId, body.organizationId))
    ) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Not authorized for this organization.');
    }

    const customer = await em.findOne(CustomerAccount, {
      id: body.customerAccountId,
      organizationId: body.organizationId,
    });
    if (!customer) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        'Customer does not belong to the organization.',
      );
    }

    const products = await em.find(Product, { id: { $in: body.items.map((it) => it.productId) } });
    const productById = new Map(products.map((p) => [p.id, p]));
    if (productById.size !== new Set(body.items.map((it) => it.productId)).size) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'One or more products do not exist.');
    }

    const rfq = em.create(QuoteRequest, {
      organizationId: body.organizationId,
      customerAccountId: body.customerAccountId,
      createdByAdminUserId: ctx.adminUserId,
      assignedAdminUserId: ctx.adminUserId,
      status: 'Created from admin' satisfies QuoteRequestStatus,
      headerNote: body.headerNote ?? null,
      currentRevisionNumber: 1,
      lastCustomerSeenRevisionNumber: 0,
      expiresAt:
        body.expiresInDays !== undefined
          ? new Date(Date.now() + body.expiresInDays * 86_400_000)
          : null,
    });
    await em.persistAndFlush(rfq);

    const items: QuoteRequestItem[] = [];
    for (const lineInput of body.items) {
      const product = productById.get(lineInput.productId)!;
      items.push(
        em.create(QuoteRequestItem, {
          quoteRequestId: rfq.id,
          productId: product.id,
          productName: anyLocaleValue(product.name),
          productSlug: product.slug,
          variantId: lineInput.variantId ?? null,
          quantity: lineInput.quantity,
          agreedUnitPrice: lineInput.agreedUnitPrice.toFixed(2),
          lineNote: lineInput.lineNote ?? null,
          lineCurrency: 'PLN',
        }),
      );
    }
    await em.persistAndFlush(items);

    const revision = await this.deps.revisionService.record({
      rfq,
      items,
      actor: { adminUserId: ctx.adminUserId },
    });

    await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'created',
      actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
      payload: { type: 'created' },
      revisionId: revision.id,
    });

    const evt = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'note-added',
      actor: { adminUserId: ctx.adminUserId, roleLabel: ctx.roleLabel },
      payload: { type: 'note-added', note: 'Quote Request created on customer behalf — awaiting customer acceptance.' },
      revisionId: revision.id,
    });

    await this.deps.notificationService.enqueue({
      quoteRequestId: rfq.id,
      sourceEventId: evt.id,
      recipients: [{ customerAccountId: rfq.customerAccountId }],
      channels: ['email', 'in_app'],
    });

    return this.deps.rfqService.serializeFull(em, rfq, true);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async findVisibleForAdmin(
    em: EntityManager,
    ctx: AdminContext,
    rfqId: string,
  ): Promise<QuoteRequest> {
    const rfq = await em.findOne(QuoteRequest, { id: rfqId });
    if (!rfq) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Quote Request not found.');
    if (
      !ctx.isPlatformAdmin &&
      !(await this.deps.salesRepAssignment.canSeeOrganization(ctx.adminUserId, rfq.organizationId))
    ) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Not authorized for this Quote Request.');
    }
    return rfq;
  }

  private assertVersion(rfq: QuoteRequest, expectedVersion: number | null): void {
    if (expectedVersion !== null && rfq.version !== expectedVersion) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Quote Request was updated concurrently.');
    }
  }

  private async isUnassigned(em: EntityManager, organizationId: string): Promise<boolean> {
    const reps = await this.deps.salesRepAssignment.listForOrganization(organizationId);
    void em;
    return reps.length === 0;
  }
}

function anyLocaleValue(blob: Record<string, string>): string {
  const k = Object.keys(blob)[0];
  return k ? (blob[k] ?? '') : '';
}

function customerDisplayName(c: CustomerAccount): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email;
}

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const v of arr) {
    const k = key(v);
    const existing = out.get(k);
    if (existing) existing.push(v);
    else out.set(k, [v]);
  }
  return out;
}
