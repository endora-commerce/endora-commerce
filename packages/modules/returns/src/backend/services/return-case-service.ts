import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type {
  CreateReturnCaseRequest,
  OrderReturnContextPort,
  ReturnableResponse,
  ReturnCaseDetail,
  ReturnCaseSummary,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseItem } from '../entities/return-case-item.entity.js';
import { ReturnCaseComment } from '../entities/return-case-comment.entity.js';
import { ReturnCaseAttachment } from '../entities/return-case-attachment.entity.js';
import { ReturnReason } from '../entities/return-reason.entity.js';
import { Refund } from '../entities/refund.entity.js';
import { RETURN_STATUS_CANCELLED } from '../domain/return-status-graph.js';
import { isWithinFreeWindow } from '../domain/free-return-window.js';
import { approvedAmount, caseDefaultRefunds } from '../domain/refund-math.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import type { ReturnTransitionService } from './return-transition-service.js';
import {
  checkRequestedQuantities,
  isLineReturnable,
  nonReturnableRequestedLines,
  returnableVerdict,
} from './return-eligibility.js';

/** Statuses whose cases do NOT consume returnable quantity (FR-003). */
const VOID_STATUS_CODES = new Set(['rejected', 'cancelled']);

export interface ReturnCaseServiceDeps {
  emFactory: () => EntityManager;
  graphService: ReturnStatusGraphService;
  transitions: ReturnTransitionService;
  orderContext: OrderReturnContextPort;
  /** Free-return window in days for a sales channel (0 = no free-return option). */
  resolveFreeReturnDays: (salesChannelId: string) => Promise<number>;
  /** Injected for deterministic tests; defaults to `new Date()`. */
  now?: () => Date;
  /** Feature 054 — audits case creation co-transactionally when provided. */
  auditLog?: AuditPort;
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
    const lines = ctx.lines.map((l) => {
      // Feature 155 (FR-017, FR-025) — the stamp recorded at placement governs;
      // `null` (placed before the feature) is returnable.
      const returnable = isLineReturnable(l.returnableAtPurchase);
      return {
        orderItemId: l.orderItemId,
        productId: l.productId,
        name: l.name,
        purchasedQty: l.purchasedQty,
        remainingReturnableQty: Math.max(0, l.purchasedQty - (consumed.get(l.orderItemId) ?? 0)),
        paidUnitAmount: l.paidUnitAmount,
        currency: ctx.currency,
        returnable,
        ...(returnable ? {} : { notReturnableReason: 'product_not_returnable' as const }),
      };
    });

    const verdict = returnableVerdict(ctx.completingStatusEnteredAt !== null, lines);
    if (verdict.eligible === false && verdict.reason === 'order_not_completing') {
      return { eligible: false, reason: 'order_not_completing', freeReturnEligible: false, lines };
    }
    const freeReturnEligible = await this.isWithinFreeWindow(ctx.salesChannelId, ctx.completingStatusEnteredAt);
    if (verdict.eligible === false) {
      return { eligible: false, reason: verdict.reason, freeReturnEligible, lines };
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

    // Feature 155 (FR-033, SC-006) — judged on the per-line sum, for both
    // kinds, so a request cannot exceed a line's remaining quantity by naming
    // it more than once. The entries are still stored as sent.
    const quantityRefusal = checkRequestedQuantities(input.lines, ctx.lines, consumed);
    if (quantityRefusal?.code === 'unknown_line') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Unknown order line.', {
        code: 'unknown_line',
      });
    }
    if (quantityRefusal?.code === 'qty_exceeds_returnable') {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        `Requested quantity (${quantityRefusal.requested}) exceeds the returnable quantity (${quantityRefusal.remaining}).`,
        { code: 'qty_exceeds_returnable' },
      );
    }
    for (const line of input.lines) {
      if (!reasons.has(line.reasonId)) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Unknown or inactive reason.', {
          code: 'unknown_reason',
        });
      }
    }

    // Feature 155 (FR-019, FR-020) — a `return` case may not include a line
    // recorded as not returnable; a complaint is never checked. Existing
    // cases are never re-evaluated (FR-022).
    const notReturnable = nonReturnableRequestedLines(input.kind, input.lines, ctx.lines);
    const firstNotReturnable = notReturnable[0];
    if (firstNotReturnable) {
      throw new HttpError(
        422,
        ERROR_CODES.RETURN_LINE_NOT_RETURNABLE,
        `"${firstNotReturnable.productName}" cannot be returned. You can still file a complaint.`,
        {
          productName: firstNotReturnable.productName,
          orderItemIds: notReturnable.map((l) => l.orderItemId),
          lines: notReturnable,
        },
      );
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

    // What each returned line refunds by default — cumulatively over the
    // order's live cases (issue #417, review of PR #423): no sequence of
    // returns refunds more than the order charged, and a complete return
    // refunds exactly that. Read from what the order stored, never recomputed.
    const defaults = caseDefaultRefunds({
      vatMethod: ctx.vatMethod,
      productsPaidTotal: ctx.productsPaidTotal,
      orderLines: ctx.lines.map((l) => ({
        orderItemId: l.orderItemId,
        unitNetPrice: l.unitNetPrice,
        taxRate: l.taxRate,
        purchasedQty: l.purchasedQty,
        paidLineAmount: approvedAmount(l.paidLineAmount),
        returnable: isLineReturnable(l.returnableAtPurchase),
      })),
      earlier: (await this.liveCaseItems(input.orderId)).map((it) => ({
        orderItemId: it.orderItemId,
        quantity: it.quantity,
        defaultRefundAmount: it.defaultRefundAmount,
      })),
      current: input.lines.map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity })),
    });
    for (const [index, line] of input.lines.entries()) {
      const ctxLine = byOrderItem.get(line.orderItemId)!;
      const defaultRefund = defaults[index]!;
      // Owner ruling R1 (feature 155, FR-020) — a complaint may name a line that
      // was not returnable at purchase, but nothing refunds it by default: its
      // approved amount starts at 0 for the operator to set. The default refund
      // stays the amount paid, because it is the cap settlement lets the
      // operator approve up to (`exceedsCap`).
      const approvedRefund = isLineReturnable(ctxLine.returnableAtPurchase) ? defaultRefund : '0.00';
      em.persist(
        em.create(ReturnCaseItem, {
          returnCaseId: rc.id,
          orderItemId: line.orderItemId,
          productId: ctxLine.productId,
          productName: ctxLine.name,
          quantity: line.quantity,
          reasonId: line.reasonId,
          description: line.description ?? null,
          defaultRefundAmount: approvedAmount(defaultRefund),
          approvedRefundAmount: approvedAmount(approvedRefund),
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

    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, {
        action: 'return_case.create',
        objectType: 'return_case',
        objectId: rc.id,
        stateBefore: null,
        stateAfter: {
          kind: rc.kind,
          orderId: rc.orderId,
          statusCode: rc.statusCode,
          lineCount: input.lines.length,
        },
      });
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

  /** Customer withdraws their own case (if the workflow permits the transition). */
  async cancelByCustomer(id: string, customerAccountId: string): Promise<ReturnCaseDetail> {
    const em = this.deps.emFactory();
    const rc = await em.findOne(ReturnCase, { id, customerAccountId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    await this.deps.transitions.apply(id, RETURN_STATUS_CANCELLED, { kind: 'customer', customerAccountId });
    return this.mapDetail(this.deps.emFactory(), id, { customerView: true });
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
    const out = new Map<string, number>();
    for (const it of await this.liveCaseItems(orderId)) {
      out.set(it.orderItemId, (out.get(it.orderItemId) ?? 0) + it.quantity);
    }
    return out;
  }

  /** The lines of the order's live (non-void) cases — what was already returned and refunded. */
  private async liveCaseItems(orderId: string): Promise<ReturnCaseItem[]> {
    const em = this.deps.emFactory();
    const cases = await em.find(ReturnCase, { orderId });
    const liveCaseIds = cases.filter((c) => !VOID_STATUS_CODES.has(c.statusCode)).map((c) => c.id);
    if (liveCaseIds.length === 0) return [];
    return em.find(ReturnCaseItem, { returnCaseId: { $in: liveCaseIds } });
  }

  private async isWithinFreeWindow(
    salesChannelId: string,
    completingAt: Date | null,
  ): Promise<boolean> {
    const days = await this.deps.resolveFreeReturnDays(salesChannelId);
    return isWithinFreeWindow(this.now(), completingAt, days);
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
    const [items, comments, graph, refund] = await Promise.all([
      em.find(ReturnCaseItem, { returnCaseId: id }),
      em.find(ReturnCaseComment, { returnCaseId: id }, { orderBy: { createdAt: 'asc' } }),
      this.deps.graphService.loadGraph(),
      // D-92 — the settled case's corrective-invoice answer, which used to live
      // only in the settlement response and the audit entry. A reloaded screen
      // reads it here.
      em.findOne(Refund, { returnCaseId: id }),
    ]);
    const visibleComments = comments.filter((c) => !opts.customerView || c.isCustomerVisible);
    // Feature 155 (owner ruling R1) — each line's returnable-at-purchase record,
    // read through the port that already carries it, so the admin case view can
    // mark a complaint line that was not returnable when bought.
    const orderContext = await this.deps.orderContext.getReturnContext(rc.orderId);
    const returnableAtPurchase = new Map(
      (orderContext?.lines ?? []).map((l) => [l.orderItemId, l.returnableAtPurchase] as const),
    );
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
        returnableAtPurchase: returnableAtPurchase.get(it.orderItemId) ?? null,
      })),
      comments: visibleComments.map((c) => ({
        id: c.id,
        authorKind: c.authorAdminUserId ? ('admin' as const) : ('customer' as const),
        body: c.body,
        isCustomerVisible: c.isCustomerVisible,
        createdAt: c.createdAt.toISOString(),
      })),
      // Null while the case has no refund row: never settled, or settled as a
      // replacement or repair, which corrects no document at all.
      correctiveInvoice: refund
        ? {
            outcome: refund.correctiveInvoiceOutcome,
            invoiceId: refund.correctiveInvoiceId ?? null,
          }
        : null,
    };
  }
}
