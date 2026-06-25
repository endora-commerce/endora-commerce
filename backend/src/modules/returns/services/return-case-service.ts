import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type {
  CreateReturnCaseRequest,
  ReturnableResponse,
  ReturnCaseDetail,
  ReturnCaseSummary,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseItem } from '../entities/return-case-item.entity.js';
import { ReturnCaseComment } from '../entities/return-case-comment.entity.js';
import { ReturnCaseAttachment } from '../entities/return-case-attachment.entity.js';
import { ReturnReason } from '../entities/return-reason.entity.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import type { OrderReturnContextPort } from '../ports/order-return-context.port.js';

/** Statuses whose cases do NOT consume returnable quantity (FR-003). */
const VOID_STATUS_CODES = new Set(['rejected', 'cancelled']);

export interface ReturnCaseServiceDeps {
  emFactory: () => EntityManager;
  graphService: ReturnStatusGraphService;
  orderContext: OrderReturnContextPort;
  /** Free-return window in days for a sales channel (0 = no free-return option). */
  resolveFreeReturnDays: (salesChannelId: string) => Promise<number>;
  /** Injected for deterministic tests; defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * ReturnCaseService — feature 046 (US1).
 *
 * Eligibility evaluation, remaining-returnable computation, and case creation in
 * the initial workflow status. Reads order facts only through the
 * `OrderReturnContextPort` (Principle I).
 */
export class ReturnCaseService {
  constructor(private readonly deps: ReturnCaseServiceDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** Lines a customer may still return for an order, with the eligibility verdict. */
  async getReturnable(orderId: string, customerAccountId: string): Promise<ReturnableResponse> {
    const ctx = await this.deps.orderContext.getReturnContext(orderId);
    if (!ctx || ctx.customerAccountId !== customerAccountId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
    }
    const consumed = await this.consumedQuantities(orderId);
    const lines = ctx.lines.map((l) => ({
      orderItemId: l.orderItemId,
      productId: l.productId,
      name: l.name,
      purchasedQty: l.purchasedQty,
      remainingReturnableQty: Math.max(0, l.purchasedQty - (consumed.get(l.orderItemId) ?? 0)),
      paidUnitAmount: l.paidUnitAmount,
      currency: ctx.currency,
    }));

    const freeReturnEligible = await this.isWithinFreeWindow(ctx.salesChannelId, ctx.completingStatusEnteredAt);
    if (ctx.completingStatusEnteredAt === null) {
      return { eligible: false, reason: 'order_not_completing', freeReturnEligible: false, lines };
    }
    if (lines.every((l) => l.remainingReturnableQty === 0)) {
      return { eligible: false, reason: 'fully_returned', freeReturnEligible, lines };
    }
    return { eligible: true, freeReturnEligible, lines };
  }

  /** Open a return/complaint case (FR-001/002/003/005). */
  async createCase(
    input: CreateReturnCaseRequest,
    customerAccountId: string,
  ): Promise<ReturnCaseDetail> {
    const ctx = await this.deps.orderContext.getReturnContext(input.orderId);
    if (!ctx || ctx.customerAccountId !== customerAccountId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
    }
    if (ctx.completingStatusEnteredAt === null) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'This order is not yet eligible for returns.',
        { code: 'order_not_completing' },
      );
    }

    const byOrderItem = new Map(ctx.lines.map((l) => [l.orderItemId, l]));
    const consumed = await this.consumedQuantities(input.orderId);
    const reasons = new Map(
      (await this.deps.emFactory().find(ReturnReason, { isActive: true })).map((r) => [r.id, r]),
    );

    for (const line of input.lines) {
      const ctxLine = byOrderItem.get(line.orderItemId);
      if (!ctxLine) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Unknown order line.', {
          code: 'unknown_line',
        });
      }
      const remaining = ctxLine.purchasedQty - (consumed.get(line.orderItemId) ?? 0);
      if (line.quantity > remaining) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          `Requested quantity (${line.quantity}) exceeds the returnable quantity (${remaining}).`,
          { code: 'qty_exceeds_returnable' },
        );
      }
      if (!reasons.has(line.reasonId)) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Unknown or inactive reason.', {
          code: 'unknown_reason',
        });
      }
    }

    const em = this.deps.emFactory();
    const graph = await this.deps.graphService.loadGraph();
    const now = this.now();
    const freeReturnEligible =
      input.kind === 'return'
        ? await this.isWithinFreeWindow(ctx.salesChannelId, ctx.completingStatusEnteredAt)
        : false;

    const rc = em.create(ReturnCase, {
      kind: input.kind,
      orderId: input.orderId,
      salesChannelId: ctx.salesChannelId,
      customerAccountId,
      organizationId: ctx.organizationId,
      statusCode: graph.initialCode(),
      currency: ctx.currency,
      freeReturnEligible,
      submittedAt: now,
    });
    em.persist(rc);

    for (const line of input.lines) {
      const ctxLine = byOrderItem.get(line.orderItemId)!;
      const defaultRefund = round2(ctxLine.paidUnitAmount * line.quantity);
      em.persist(
        em.create(ReturnCaseItem, {
          returnCaseId: rc.id,
          orderItemId: line.orderItemId,
          productId: ctxLine.productId,
          productName: ctxLine.name,
          quantity: line.quantity,
          reasonId: line.reasonId,
          description: line.description ?? null,
          defaultRefundAmount: defaultRefund.toFixed(2),
          approvedRefundAmount: defaultRefund.toFixed(2),
        }),
      );
    }

    for (const assetId of input.attachmentAssetIds ?? []) {
      em.persist(em.create(ReturnCaseAttachment, { returnCaseId: rc.id, assetId }));
    }
    if (input.comment) {
      em.persist(
        em.create(ReturnCaseComment, {
          returnCaseId: rc.id,
          authorCustomerAccountId: customerAccountId,
          body: input.comment,
          isCustomerVisible: true,
          notifyCustomer: false,
        }),
      );
    }

    await em.flush();
    return this.mapDetail(em, rc.id, { customerView: true });
  }

  async listForCustomer(customerAccountId: string): Promise<ReturnCaseSummary[]> {
    const em = this.deps.emFactory();
    const cases = await em.find(
      ReturnCase,
      { customerAccountId },
      { orderBy: { submittedAt: 'desc' } },
    );
    const graph = await this.deps.graphService.loadGraph();
    return cases.map((rc) => this.toSummary(rc, graph.get(rc.statusCode)?.defaultName ?? rc.statusCode));
  }

  async getForCustomer(id: string, customerAccountId: string): Promise<ReturnCaseDetail> {
    const em = this.deps.emFactory();
    const rc = await em.findOne(ReturnCase, { id, customerAccountId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    return this.mapDetail(em, rc.id, { customerView: true });
  }

  /** Detail for the admin surface (includes internal comments). */
  async getByIdForAdmin(id: string): Promise<ReturnCaseDetail> {
    const em = this.deps.emFactory();
    const rc = await em.findOne(ReturnCase, { id });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    return this.mapDetail(em, rc.id, { customerView: false });
  }

  // --- internals ----------------------------------------------------------

  private async consumedQuantities(orderId: string): Promise<Map<string, number>> {
    const em = this.deps.emFactory();
    const cases = await em.find(ReturnCase, { orderId });
    const liveCaseIds = cases.filter((c) => !VOID_STATUS_CODES.has(c.statusCode)).map((c) => c.id);
    const out = new Map<string, number>();
    if (liveCaseIds.length === 0) return out;
    const items = await em.find(ReturnCaseItem, { returnCaseId: { $in: liveCaseIds } });
    for (const it of items) {
      out.set(it.orderItemId, (out.get(it.orderItemId) ?? 0) + it.quantity);
    }
    return out;
  }

  private async isWithinFreeWindow(
    salesChannelId: string,
    completingAt: Date | null,
  ): Promise<boolean> {
    if (completingAt === null) return false;
    const days = await this.deps.resolveFreeReturnDays(salesChannelId);
    if (!Number.isFinite(days) || days <= 0) return false;
    const deadline = new Date(completingAt.getTime() + days * 24 * 60 * 60 * 1000);
    return this.now().getTime() <= deadline.getTime();
  }

  private toSummary(rc: ReturnCase, statusLabel: string): ReturnCaseSummary {
    return {
      id: rc.id,
      rmaNumber: rc.rmaNumber ?? null,
      kind: rc.kind,
      orderId: rc.orderId,
      statusCode: rc.statusCode,
      statusLabel,
      totalRefundAmount: Number(rc.totalRefundAmount),
      currency: rc.currency,
      submittedAt: rc.submittedAt.toISOString(),
    };
  }

  private async mapDetail(
    em: EntityManager,
    id: string,
    opts: { customerView: boolean },
  ): Promise<ReturnCaseDetail> {
    const rc = await em.findOneOrFail(ReturnCase, { id });
    const [items, comments, graph] = await Promise.all([
      em.find(ReturnCaseItem, { returnCaseId: id }),
      em.find(ReturnCaseComment, { returnCaseId: id }, { orderBy: { createdAt: 'asc' } }),
      this.deps.graphService.loadGraph(),
    ]);
    const visibleComments = comments.filter((c) => !opts.customerView || c.isCustomerVisible);
    return {
      ...this.toSummary(rc, graph.get(rc.statusCode)?.defaultName ?? rc.statusCode),
      salesChannelId: rc.salesChannelId,
      customerAccountId: rc.customerAccountId,
      organizationId: rc.organizationId ?? null,
      returnDeliveryMethodId: rc.returnDeliveryMethodId ?? null,
      appliedReturnCost: Number(rc.appliedReturnCost),
      returnCostBearer: rc.returnCostBearer,
      freeReturnEligible: rc.freeReturnEligible,
      resolutionType: rc.resolutionType ?? null,
      rejectionReason: rc.rejectionReason ?? null,
      items: items.map((it) => ({
        id: it.id,
        orderItemId: it.orderItemId,
        productId: it.productId,
        productName: it.productName,
        quantity: it.quantity,
        reasonId: it.reasonId ?? null,
        description: it.description ?? null,
        inspectionOutcome: it.inspectionOutcome ?? null,
        defaultRefundAmount: Number(it.defaultRefundAmount),
        approvedRefundAmount: Number(it.approvedRefundAmount),
      })),
      comments: visibleComments.map((c) => ({
        id: c.id,
        authorKind: c.authorAdminUserId ? ('admin' as const) : ('customer' as const),
        body: c.body,
        isCustomerVisible: c.isCustomerVisible,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
