import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape, returnCaseOrderLockKey } from '@endora-commerce/contracts';
import type {
  CreateReturnCaseRequest,
  OrderReadPort,
  OrderReturnContext,
  OrderReturnContextPort,
  OrganizationDetailsPort,
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
import { withdrawalPeriod, withdrawalPeriodAnchor } from '../domain/withdrawal-period.js';
import { classifyConsumerWithdrawal } from '../domain/consumer-withdrawal.js';
import { approvedAmount } from '../domain/refund-math.js';
import { caseDefaults, liveItems, loadOrderCases } from './default-refund-service.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import type { ReturnTransitionService } from './return-transition-service.js';
import type { ReturnCaseScope, ReturnCustomerContext } from './return-case-scope.js';
import {
  checkRequestedQuantities,
  isLineReturnable,
  nonReturnableRequestedLines,
  returnableVerdict,
} from './return-eligibility.js';

export interface ReturnCaseServiceDeps {
  emFactory: () => EntityManager;
  graphService: ReturnStatusGraphService;
  transitions: ReturnTransitionService;
  orderContext: OrderReturnContextPort;
  /**
   * `orders`' customer-scoped order reader (`specs/170-organization-roles/`
   * FR-054, Q-R1 = A): whether the buyer may start a return from an order is
   * whether they may read it, decided by `orders` itself.
   */
  orderRead: Pick<OrderReadPort, 'findByIdForCustomer'>;
  /** The buyer's case scope — own cases, or the Organization's (FR-053). */
  scope: ReturnCaseScope;
  /**
   * `organizations`' record reader (issue #905, design §2): whether the case's
   * Organization is personal decides whether a return is a consumer withdrawal.
   */
  organizationDetails: Pick<OrganizationDetailsPort, 'findById'>;
  /** Free-return window in days for a sales channel (0 = no free-return option). */
  resolveFreeReturnDays: (salesChannelId: string) => Promise<number>;
  /**
   * `returns.time_zone` for a sales channel (issue #905): the IANA zone the
   * free-return window counts calendar days in. Always a zone the runtime
   * knows — the resolver falls back to the manifest default.
   */
  resolveTimeZone: (salesChannelId: string) => Promise<string>;
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

  /**
   * The order a buyer starts a return from, if they may read it
   * (`specs/170-organization-roles/` FR-054, Q-R1 = A): their own order, or a
   * colleague's when their role holds `orders.view_organization`. The rule is
   * `orders`' — `findByIdForCustomer` applies the one `GET /api/v1/orders/:id`
   * applies — so the two never disagree. Before feature 170 this compared the
   * order's placer with the caller, for every buyer, administrator included.
   * Out of reach is `404`, indistinguishable from an order that does not exist.
   */
  private async assertOrderReadable(orderId: string, customer: ReturnCustomerContext): Promise<void> {
    const order = customer.organizationId
      ? await this.deps.orderRead.findByIdForCustomer(orderId, {
          customerAccountId: customer.customerAccountId,
          organizationId: customer.organizationId,
        })
      : null;
    if (!order) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
  }

  /** Lines a customer may still return for an order, with the eligibility verdict. */
  async getReturnable(orderId: string, customer: ReturnCustomerContext): Promise<ReturnableResponse> {
    await this.assertOrderReadable(orderId, customer);
    const ctx = await this.deps.orderContext.getReturnContext(orderId);
    if (!ctx) {
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
    const freeReturnEligible = await this.isWithinFreeWindow(ctx.salesChannelId, withdrawalPeriodAnchor(ctx));
    if (verdict.eligible === false) {
      return { eligible: false, reason: verdict.reason, freeReturnEligible, lines };
    }
    return { eligible: true, freeReturnEligible, lines };
  }

  /**
   * Open a return/complaint case (FR-001/002/003/005). The route has already
   * judged `returns.create` (`specs/170-organization-roles/` FR-052); the case
   * is filed in the **starter's** name — `customerAccountId` means "who filed
   * it", so its e-mails go to the starter, whoever placed the order (FR-054).
   */
  async createCase(
    input: CreateReturnCaseRequest,
    customer: ReturnCustomerContext,
  ): Promise<ReturnCaseDetail> {
    const customerAccountId = customer.customerAccountId;
    await this.assertOrderReadable(input.orderId, customer);
    const ctx = await this.deps.orderContext.getReturnContext(input.orderId);
    if (!ctx) {
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
    // One case at a time per order (issue #417, review of PR #423): the
    // quantity check and the cumulative refunds read the order's earlier
    // cases, so a concurrent case must wait for this one and then see it. A
    // transaction-scoped advisory lock keyed by the order, read once.
    const caseId = await this.deps.emFactory().transactional(async (em) => {
      await em.execute('select pg_advisory_xact_lock(hashtext(?))', [returnCaseOrderLockKey(input.orderId)]);
      const history = await loadOrderCases(em, input.orderId);
      const consumed = consumedFrom(liveItems(history));
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

      const graph = await this.deps.graphService.loadGraph();
      const now = this.now();
      const freeReturnEligible =
        input.kind === 'return'
          ? await this.isWithinFreeWindow(ctx.salesChannelId, withdrawalPeriodAnchor(ctx))
          : false;
      // Issue #905 (design §2) — fixed now, when the law fixes it.
      const consumerWithdrawal = await this.isConsumerWithdrawal(input.kind, ctx, now);

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
        consumerWithdrawal,
        // The trader received the statement when the case was filed (design D2).
        withdrawalReceivedAt: consumerWithdrawal ? now : null,
      });
      em.persist(rc);

      // What each returned line refunds by default — cumulatively over the
      // order's cases (issue #417, review of PR #423): no sequence of returns
      // refunds more than the order charged, and a complete return refunds
      // exactly that. Read from what the order stored, never recomputed. On
      // the provisional basis (issue #875): the live returns not settled yet
      // count as if settled in the order they were opened, and a complaint is
      // outside the kept state (issue #874). The settlement recomputes it from
      // the cases settled by then, under the same lock.
      const defaults = caseDefaults({
        context: ctx,
        history,
        basis: 'provisional',
        kind: input.kind,
        current: input.lines.map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity })),
      });
      for (const [index, line] of input.lines.entries()) {
        const ctxLine = byOrderItem.get(line.orderItemId)!;
        const { refund: defaultRefund, discount: defaultDiscount, effective } = defaults[index]!;
        // Owner ruling R1 (feature 155, FR-020) — a complaint may name a line that
        // was not returnable at purchase, but nothing refunds it by default: its
        // approved amount starts at 0 for the operator to set. Otherwise the
        // figure shown is the effective default, bounded by the line ceiling
        // (architect's ruling on PR #937); the stored default stays the goods'
        // value, the next case's telescoping `earlier`.
        const approvedRefund = isLineReturnable(ctxLine.returnableAtPurchase) ? effective : '0.00';
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
            defaultDiscountAmount: approvedAmount(defaultDiscount),
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
            consumerWithdrawal,
          },
        });
      }
      await em.flush();
      return rc.id;
    });
    return this.mapDetail(this.deps.emFactory(), caseId, { customerView: true });
  }

  /**
   * The buyer's case list: the cases they filed, or every case of their
   * Organization with `returns.view_organization` (`ReturnCaseScope`, FR-053).
   */
  async listForCustomer(customer: ReturnCustomerContext): Promise<ReturnCaseSummary[]> {
    const em = this.deps.emFactory();
    const cases = await em.find(
      ReturnCase,
      await this.deps.scope.where(customer),
      { orderBy: { submittedAt: 'desc' } },
    );
    const graph = await this.deps.graphService.loadGraph();
    return cases.map((rc) => this.toSummary(rc, graph.get(rc.statusCode)?.defaultName ?? rc.statusCode));
  }

  /** One case, within the same scope as {@link listForCustomer}; out of it is `404`. */
  async getForCustomer(id: string, customer: ReturnCustomerContext): Promise<ReturnCaseDetail> {
    // A malformed id names no case; PostgreSQL would answer it with a 500 (issue #753).
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const em = this.deps.emFactory();
    const rc = await em.findOne(ReturnCase, await this.deps.scope.where(customer, { id }));
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    return this.mapDetail(em, rc.id, { customerView: true });
  }

  /**
   * Customer withdraws their own case (if the workflow permits the transition).
   * The filer's only, whatever the caller's permissions: seeing a colleague's
   * case does not open its actions (`specs/170-organization-roles/` Q-R2 = A).
   */
  async cancelByCustomer(id: string, customerAccountId: string): Promise<ReturnCaseDetail> {
    const em = this.deps.emFactory();
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const rc = await em.findOne(ReturnCase, { id, customerAccountId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    await this.deps.transitions.apply(id, RETURN_STATUS_CANCELLED, { kind: 'customer', customerAccountId });
    return this.mapDetail(this.deps.emFactory(), id, { customerView: true });
  }

  /** Detail for the admin surface (includes internal comments). */
  async getByIdForAdmin(id: string): Promise<ReturnCaseDetail> {
    const em = this.deps.emFactory();
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const rc = await em.findOne(ReturnCase, { id });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    return this.mapDetail(em, rc.id, { customerView: false });
  }

  // --- internals ----------------------------------------------------------

  private async consumedQuantities(orderId: string): Promise<Map<string, number>> {
    return consumedFrom(liveItems(await loadOrderCases(this.deps.emFactory(), orderId)));
  }

  private async isWithinFreeWindow(
    salesChannelId: string,
    completingAt: Date | null,
  ): Promise<boolean> {
    const [days, timeZone] = await Promise.all([
      this.deps.resolveFreeReturnDays(salesChannelId),
      this.deps.resolveTimeZone(salesChannelId),
    ]);
    return isWithinFreeWindow(this.now(), completingAt, days, timeZone);
  }

  /**
   * Whether a case of `kind` filed at `at` for this order is a consumer
   * withdrawal (issue #905, design §2): a `return`, a personal Organization,
   * and the withdrawal function still available for the order.
   */
  private async isConsumerWithdrawal(
    kind: CreateReturnCaseRequest['kind'],
    ctx: OrderReturnContext,
    at: Date,
  ): Promise<boolean> {
    if (kind !== 'return' || !ctx.organizationId) return false;
    const organization = await this.deps.organizationDetails.findById(ctx.organizationId);
    if (organization?.isPersonal !== true) return false;
    const [freeReturnDays, timeZone] = await Promise.all([
      this.deps.resolveFreeReturnDays(ctx.salesChannelId),
      this.deps.resolveTimeZone(ctx.salesChannelId),
    ]);
    return classifyConsumerWithdrawal({
      kind,
      organizationIsPersonal: true,
      period: withdrawalPeriod(withdrawalPeriodAnchor(ctx), { timeZone, freeReturnDays }),
      submittedAt: at,
    });
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
      // The filer (`specs/170-organization-roles/` FR-053): a holder of
      // `returns.view_organization` lists colleagues' cases too.
      customerAccountId: rc.customerAccountId,
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
      consumerWithdrawal: rc.consumerWithdrawal ?? null,
      alternativeResolutionConsent: alternativeResolutionConsentOf(rc, opts),
    };
  }
}

/**
 * The consent on record, as the case detail reports it (issue #905). The
 * evidence note and the operator who recorded it are the operator's: the
 * buyer's view leaves both out.
 */
export function alternativeResolutionConsentOf(
  rc: ReturnCase,
  opts: { customerView: boolean },
): ReturnCaseDetail['alternativeResolutionConsent'] {
  if (!rc.alternativeConsentResolution || !rc.alternativeConsentAt) return null;
  return {
    resolution: rc.alternativeConsentResolution,
    at: rc.alternativeConsentAt.toISOString(),
    source: rc.alternativeConsentSource ?? 'operator_recorded',
    ...(opts.customerView
      ? {}
      : {
          note: rc.alternativeConsentNote ?? '',
          byAdminUserId: rc.alternativeConsentByAdminUserId ?? null,
        }),
  };
}

/** Quantities already named per order item, by the order's live cases. */
function consumedFrom(items: readonly ReturnCaseItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) out.set(it.orderItemId, (out.get(it.orderItemId) ?? 0) + it.quantity);
  return out;
}
