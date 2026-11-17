import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { ERROR_CODES, RETURN_CASE_CREATED_EVENT, isUuidShape, returnCaseOrderLockKey } from '@endora-commerce/contracts';
import type {
  AdminUserReadPort,
  CatalogProductAvailabilityPort,
  CreateGuestComplaintRequest,
  CreateOffPlatformComplaintRequest,
  GuestCaseFiled,
  CreateOrderReturnCaseRequest,
  CreateReturnCaseRequest,
  ProductAudience,
  ReturnAttachmentType,
  ReturnCaseCreatedEventV1,
  ShownClause,
  OrderReadPort,
  OrderReturnContext,
  OrderReturnContextPort,
  OrganizationDetailsPort,
  ReturnableResponse,
  ReturnCaseDetail,
  ReturnCaseSummary,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseItem } from '../entities/return-case-item.entity.js';
import { ReturnCaseComment } from '../entities/return-case-comment.entity.js';
import { ReturnCaseAttachment } from '../entities/return-case-attachment.entity.js';
import { caseLinesOf, dayIn } from './case-lines.js';
import { ReturnReason } from '../entities/return-reason.entity.js';
import { Refund } from '../entities/refund.entity.js';
import { RETURN_STATUS_CANCELLED, resolveReturnStatusName, type ReturnStatusGraph } from '../domain/return-status-graph.js';
import { isWithinFreeWindow } from '../domain/free-return-window.js';
import { caseReference } from '../domain/case-reference.js';
import { resolveAuthorizers } from './authorizer-names.js';
import { withdrawalPeriod, withdrawalPeriodAnchor } from '../domain/withdrawal-period.js';
import { classifyConsumerWithdrawal } from '../domain/consumer-withdrawal.js';
import { approvedAmount } from '../domain/refund-math.js';
import { isWithinWithdrawalWindow } from '../domain/charge-refunds.js';
import { caseCharges, caseDefaults, liveItems, loadOrderCases, type OrderCaseItem } from './default-refund-service.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import type { ReturnTransitionService } from './return-transition-service.js';
import type { ReturnCaseScope, ReturnCustomerContext } from './return-case-scope.js';
import { trackingLinkValidUntil, type GuestCaseAccess } from './guest/guest-case-access.js';
import { GUEST_RETENTION_DEFAULT_DAYS, guestDataErasureDueAt } from './guest/guest-erasure.js';
import type { GuestLinks } from './guest/guest-tracking-link.js';
import { isHoneypotHit } from './guest/honeypot.js';
import {
  checkRequestedQuantities,
  isLineReturnable,
  nonReturnableRequestedLines,
  returnableVerdict,
} from './return-eligibility.js';

/**
 * `specs/177-tax-id-scope/` FR-040 — whether the order's organization was a
 * consumer when the order was placed: personal now, or personal until a
 * conversion to a company that came after the order. The withdrawal right
 * follows the order, not the organization's current kind.
 */
export function organizationWasConsumerAt(
  organization: { isPersonal: boolean; convertedToCompanyAt?: Date | null } | null | undefined,
  placedAt: Date,
): boolean {
  if (!organization) return false;
  if (organization.isPersonal) return true;
  const convertedAt = organization.convertedToCompanyAt;
  return convertedAt != null && placedAt.getTime() < new Date(convertedAt).getTime();
}

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
   * Whether the order's Organization is personal (B2C), through
   * `organizations`' port (issue #876): a consumer's withdrawal refunds the
   * delivery and the payment surcharge. Absent: no Organization is.
   */
  isPersonalOrganization?: (organizationId: string | null, placedAt?: Date) => Promise<boolean>;
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
  /** `admin_users`' reader: who authorized the case (180 FR-A41). Absent: no name is resolved. */
  adminUsers?: Pick<AdminUserReadPort, 'findByIds'>;
  /** The Command Bus filing runs through (180 research R-11, Principle XIII). */
  commandBus: Pick<CommandBus, 'run'>;
  /** The channel's no-order toggles (180 FR-B01, FR-B21). */
  offPlatformFlags: {
    enabled(salesChannelId: string): Promise<boolean>;
    proofOfPurchaseRequired(salesChannelId: string): Promise<boolean>;
  };
  /** `catalog`'s availability and texts: a no-order line's product (180 research R-17). */
  catalog: Pick<CatalogProductAvailabilityPort, 'filterAvailable' | 'effectiveTexts'>;
  /** Claims the caller's pending uploads in the filing's transaction (180 research R-12). */
  attachments?: CaseAttachmentClaims;
  /** Judges the clauses a submission accepted and answers what to store (180 research R-14). */
  clauses?: CaseClauseCheck;
  /**
   * `specs/181-guest-complaints/` — the guest's pending uploads (read through
   * `GuestCaseAccess`, research R-1) and the tracking link a filing answers. Absent: a
   * guest filing is refused as no session.
   */
  guest?: {
    readonly access: Pick<GuestCaseAccess, 'pendingUploadsOf'>;
    readonly links: Pick<GuestLinks, 'trackingToken'>;
  };
  /**
   * `specs/181-guest-complaints/` (admin-api.md A2, research R-9) — the clamped guest data
   * retention, for the detail's *erasure due* date. Absent: the setting's default.
   */
  guestRetentionDays?: () => Promise<number>;
}

/** The live guest session a guest filing comes from (`specs/181-guest-complaints/` research R-4). */
export interface GuestFilingSession {
  /** The verification row's id: the case's `guest_session_id`. */
  readonly id: string;
  /** The verified address: the case's contact e-mail (FR-031). */
  readonly email: string;
  readonly verifiedAt: Date;
}

/** Per-identity limits of guest filing (181 research R-8). */
export const GUEST_CASES_PER_SESSION = 5;
export const GUEST_CASES_PER_ADDRESS_PER_DAY = 10;

/** Who files a complaint without a platform order: a customer, or a guest (181). */
type OffPlatformFiler =
  | { readonly kind: 'customer'; readonly customer: ReturnCustomerContext; readonly organizationId: string }
  | { readonly kind: 'guest'; readonly session: GuestFilingSession };

/** What a filing knows of its request (Principle XII: never a body field). */
export interface FilingContext {
  readonly channel: { readonly id: string; readonly defaultCurrency: string };
  /** The request language (`en`, `pl`): the stored clause copy's and the name snapshot's. */
  readonly language: string;
  readonly audience: ProductAudience;
}

/** A pending upload a filing claims, and the line of the new case it shows (`null`: the whole case). */
export interface ClaimedUpload {
  readonly uploadId: string;
  readonly returnCaseItemId: string | null;
}

/** `return-attachment-service.ts`'s part in a filing (180 FR-B21, FR-B24). */
export interface CaseAttachmentClaims {
  claim(
    em: EntityManager,
    input: { uploads: readonly ClaimedUpload[]; customerAccountId: string; organizationId: string; returnCaseId: string },
  ): Promise<{ count: number; types: ReturnAttachmentType[] }>;
  /** A guest session's pending uploads (`specs/181-guest-complaints/` research R-4). */
  claimForGuest?(
    em: EntityManager,
    access: Pick<GuestCaseAccess, 'pendingUploadsOf'>,
    input: { uploads: readonly ClaimedUpload[]; guestSessionId: string; returnCaseId: string },
  ): Promise<{ count: number; types: ReturnAttachmentType[] }>;
}

/** `return-clause-service.ts`'s part in a filing (180 FR-B30, FR-B31). */
export interface CaseClauseCheck {
  verify(input: {
    salesChannelId: string;
    kind: 'return' | 'complaint';
    consumerWithdrawal: boolean;
    shown: ReadonlyArray<{ id: string; revision: number }> | undefined;
    accepted: ReadonlyArray<{ id: string; revision: number }> | undefined;
    language: string;
  }): Promise<ShownClause[]>;
}

/** What `createCase` answers: the case, and whether this call filed it (180 research R-18). */
export interface FiledCase {
  readonly detail: ReturnCaseDetail;
  readonly created: boolean;
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

  /**
   * Whether a submission of `kind` against `orderId` would be a consumer's withdrawal —
   * the classification filing makes, for the form's clauses (180 D-1, research R-21). No
   * order: never. An order the caller cannot read is 404.
   */
  async consumerWithdrawalFor(
    kind: 'return' | 'complaint',
    orderId: string | undefined,
    customer: ReturnCustomerContext,
  ): Promise<boolean> {
    if (!orderId) return false;
    if (!isUuidShape(orderId)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
    await this.assertOrderReadable(orderId, customer);
    const ctx = await this.deps.orderContext.getReturnContext(orderId);
    if (!ctx) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
    return this.isConsumerWithdrawal(kind, ctx, this.now());
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
   *
   * `specs/180-off-platform-complaints/`: a case is filed by Command
   * `return_case.create` (research R-11), on either branch — against an order, or a
   * complaint without one (`orderId: null`, research R-9). The Command claims the
   * caller's pending uploads and stores the clauses shown, in its transaction, and
   * emits `return_case.created.v1` after it commits, which enqueues the notifications.
   * A repeated `submissionKey` answers the case already filed (research R-18).
   */
  async createCase(
    input: CreateReturnCaseRequest,
    customer: ReturnCustomerContext,
    filing: FilingContext,
  ): Promise<FiledCase> {
    const repeated = await this.filedWithKey(customer.customerAccountId, input.submissionKey, filing.language);
    if (repeated) return { detail: repeated, created: false };
    assertAttachmentLines(input);
    try {
      const caseId =
        input.orderId === null
          ? await this.createOffPlatformCase(input, customer, filing)
          : await this.createOrderCase(input, customer, filing);
      return {
        detail: await this.mapDetail(this.deps.emFactory(), caseId, { customerView: true, language: filing.language }),
        created: true,
      };
    } catch (error) {
      // Two posts with one key raced: the second lost on the unique index.
      const raced = await this.filedWithKey(customer.customerAccountId, input.submissionKey, filing.language);
      if (raced) return { detail: raced, created: false };
      throw error;
    }
  }

  private async filedWithKey(
    customerAccountId: string,
    submissionKey: string | undefined,
    language: string,
  ): Promise<ReturnCaseDetail | null> {
    if (!submissionKey) return null;
    const em = this.deps.emFactory();
    const rc = await em.findOne(ReturnCase, { customerAccountId, submissionKey });
    return rc ? this.mapDetail(em, rc.id, { customerView: true, language }) : null;
  }

  /** A case against a platform order — the flow of features 046, 155 and #905. */
  private async createOrderCase(
    input: CreateOrderReturnCaseRequest,
    customer: ReturnCustomerContext,
    filing: FilingContext,
  ): Promise<string> {
    const customerAccountId = customer.customerAccountId;
    await this.assertOrderReadable(input.orderId, customer);
    const ctx = await this.deps.orderContext.getReturnContext(input.orderId);
    if (!ctx) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
    }
    if (ctx.completingStatusEnteredAt === null) {
      // One code, one reason: `details.code` would add nothing (issue #625).
      throw new HttpError(422, ERROR_CODES.RETURN_ORDER_NOT_ELIGIBLE, 'This order is not yet eligible for returns.', {
        orderId: input.orderId,
      });
    }

    const byOrderItem = new Map(ctx.lines.map((l) => [l.orderItemId, l]));
    const caseId = randomUUID();
    const organizationId = ctx.organizationId ?? customer.organizationId;
    return this.deps.commandBus.run<string>({
      action: 'return_case.create',
      objectType: 'return_case',
      objectId: caseId,
      run: async ({ em }) => {
        // One case at a time per order (issue #417, review of PR #423): the
        // quantity check and the cumulative refunds read the order's earlier
        // cases, so a concurrent case must wait for this one and then see it. A
        // transaction-scoped advisory lock keyed by the order, read once.
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
            ERROR_CODES.RETURN_QUANTITY_EXCEEDS_RETURNABLE,
            `Requested quantity (${quantityRefusal.requested}) exceeds the returnable quantity (${quantityRefusal.remaining}).`,
            {
              orderItemId: quantityRefusal.orderItemId,
              requested: quantityRefusal.requested,
              remaining: quantityRefusal.remaining,
            },
          );
        }
        for (const line of input.lines) {
          if (!reasons.has(line.reasonId)) {
            // A reason that exists but was switched off is configuration the
            // operator changed, so a refusal of its own; an id that names nothing
            // is a malformed request (issue #625).
            const inactive = isUuidShape(line.reasonId)
              ? await this.deps.emFactory().findOne(ReturnReason, { id: line.reasonId, isActive: false })
              : null;
            if (inactive) {
              throw new HttpError(422, ERROR_CODES.RETURN_REASON_INACTIVE, 'The chosen reason is no longer offered.', {
                reasonId: line.reasonId,
              });
            }
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

        // 180 FR-B30, FR-B31, D-1 — the clauses of the case's channel for its kind;
        // a consumer's withdrawal is never gated by one.
        const shownClauses = await this.verifyClauses(input, ctx.salesChannelId, consumerWithdrawal, filing.language);

        // Issue #876 — the order's delivery cost and payment surcharge, on the
        // provisional basis the goods are shown on: the case that completes a
        // consumer's withdrawal refunds both, by default within the window. The
        // settlement recomputes them from the cases settled by then.
        const current = input.lines.map((line) => ({ orderItemId: line.orderItemId, quantity: line.quantity }));
        const charges = caseCharges({
          context: ctx,
          history,
          basis: 'provisional',
          kind: input.kind,
          current,
          isPersonal: (await this.deps.isPersonalOrganization?.(ctx.organizationId, ctx.placedAt)) ?? false,
          withinWindow: isWithinWithdrawalWindow({
            freeReturnEligible,
            submittedAt: now,
            completingAt: withdrawalPeriodAnchor(ctx),
            timeZone: await this.deps.resolveTimeZone(ctx.salesChannelId),
          }),
        });

        const rc = em.create(ReturnCase, {
          id: caseId,
          kind: input.kind,
          orderId: input.orderId,
          salesChannelId: ctx.salesChannelId,
          customerAccountId,
          organizationId: ctx.organizationId,
          statusCode: graph.initialCode(),
          currency: ctx.currency,
          freeReturnEligible,
          submittedAt: now,
          defaultDeliveryRefund: charges.delivery.default,
          approvedDeliveryRefund: charges.delivery.default,
          defaultSurchargeRefund: charges.surcharge.default,
          approvedSurchargeRefund: charges.surcharge.default,
          consumerWithdrawal,
          // The trader received the statement when the case was filed (design D2).
          withdrawalReceivedAt: consumerWithdrawal ? now : null,
          acceptedClauses: shownClauses,
          clausesAcceptedAt: shownClauses.length > 0 ? now : null,
          submissionKey: input.submissionKey ?? null,
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
          current,
        });
        // In request order: an attachment's `line` indexes into it.
        const itemIds: string[] = [];
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
          const item = em.create(ReturnCaseItem, {
            returnCaseId: rc.id,
            orderItemId: line.orderItemId,
            productId: ctxLine.productId,
            productName: ctxLine.name,
            quantity: line.quantity,
            reasonId: line.reasonId,
            description: line.description ?? null,
            // 180 FR-B12 — a serial number belongs to a complaint line.
            serialNumber: input.kind === 'complaint' ? (line.serialNumber || null) : null,
            defaultRefundAmount: approvedAmount(defaultRefund),
            defaultDiscountAmount: approvedAmount(defaultDiscount),
            approvedRefundAmount: approvedAmount(approvedRefund),
          });
          em.persist(item);
          itemIds.push(item.id);
        }

        const claimed = await this.claimAttachments(em, input, customer, organizationId, rc.id, itemIds);
        this.addFirstComment(em, rc.id, customerAccountId, input.comment);
        await em.flush();
        return {
          result: rc.id,
          before: null,
          after: filingAudit(rc, input.lines.length, claimed.count, shownClauses.length),
        };
      },
      event: (id) => this.createdEvent(id, organizationId, ctx.salesChannelId, input.kind, false),
    });
  }

  /**
   * A complaint without a platform order (`specs/180-off-platform-complaints/` FR-B10 –
   * FR-B17, research R-9, R-10, R-17). Its tenant is the caller's organization and its
   * channel the request's — never a body field (Principles XI, XII); its currency is
   * the channel's and every amount is 0 (FR-B15). Contact data and the address are
   * stored as sent and change nothing in the account (FR-B16).
   */
  private async createOffPlatformCase(
    input: CreateOffPlatformComplaintRequest,
    customer: ReturnCustomerContext,
    filing: FilingContext,
  ): Promise<string> {
    const organizationId = customer.organizationId;
    // Principle XI: there is no filing without an Organization.
    if (!organizationId) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');
    return this.fileOffPlatform(input, { kind: 'customer', customer, organizationId }, filing);
  }

  /**
   * A complaint without a platform order, from a customer or a guest. 180's rules hold
   * for both (purchase date, product, reason, proof, clauses); what differs is who the
   * case belongs to, which the caller stamps — never the body (Principles XI, XII):
   *
   * - a customer's case carries their account and organization;
   * - a guest's case carries neither (`specs/181-guest-complaints/` research R-1, R-2),
   *   but the session that filed it, the verified address as its contact e-mail, the
   *   moment it was verified and tracking version 1.
   */
  private async fileOffPlatform(
    input: CreateOffPlatformComplaintRequest,
    filer: OffPlatformFiler,
    filing: FilingContext,
  ): Promise<string> {
    const guest = filer.kind === 'guest' ? filer.session : null;
    const customerAccountId = filer.kind === 'customer' ? filer.customer.customerAccountId : null;
    const organizationId = filer.kind === 'customer' ? filer.organizationId : null;
    const channelId = filing.channel.id;
    if (!(await this.deps.offPlatformFlags.enabled(channelId))) {
      throw new HttpError(
        403,
        ERROR_CODES.RETURN_OFF_PLATFORM_DISABLED,
        'Complaints about goods not bought on this platform are not accepted here.',
      );
    }
    const now = this.now();
    if (input.purchase.date > dayIn(now, await this.deps.resolveTimeZone(channelId))) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The purchase date cannot be in the future.', {
        code: 'purchase_date_in_future',
      });
    }

    // R-17 — a product the caller cannot see on this channel is unknown, one answer.
    const productIds = [...new Set(input.lines.map((l) => l.productId).filter((id): id is string => Boolean(id)))];
    const names = new Map<string, string>();
    if (productIds.length > 0) {
      const available = await this.deps.catalog.filterAvailable(productIds, {
        channelId,
        languageCode: null,
        audience: filing.audience,
      });
      if (productIds.some((id) => !available.has(id))) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Unknown product.', { code: 'unknown_product' });
      }
      const texts = await this.deps.catalog.effectiveTexts(productIds, { channelId, languageCode: null });
      for (const id of productIds) names.set(id, texts.get(id)?.name ?? '');
    }

    const reasons = new Map(
      (await this.deps.emFactory().find(ReturnReason, { isActive: true, appliesTo: { $in: ['complaint', 'both'] } })).map(
        (r) => [r.id, r],
      ),
    );
    for (const line of input.lines) {
      if (reasons.has(line.reasonId)) continue;
      // Issue #625, as for an order's case: a complaint reason the operator
      // switched off is a refusal of its own; an id that names nothing is a
      // malformed request.
      const inactive = isUuidShape(line.reasonId)
        ? await this.deps.emFactory().findOne(ReturnReason, {
            id: line.reasonId,
            isActive: false,
            appliesTo: { $in: ['complaint', 'both'] },
          })
        : null;
      if (inactive) {
        throw new HttpError(422, ERROR_CODES.RETURN_REASON_INACTIVE, 'The chosen reason is no longer offered.', {
          reasonId: line.reasonId,
        });
      }
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Unknown or inactive reason.', { code: 'unknown_reason' });
    }

    const caseId = randomUUID();
    const proofRequired = await this.deps.offPlatformFlags.proofOfPurchaseRequired(channelId);
    return this.deps.commandBus.run<string>({
      action: 'return_case.create',
      objectType: 'return_case',
      objectId: caseId,
      run: async ({ em }) => {
        const graph = await this.deps.graphService.loadGraph();
        const shownClauses = await this.verifyClauses(input, channelId, false, filing.language);
        const rc = em.create(ReturnCase, {
          id: caseId,
          kind: 'complaint',
          orderId: null,
          salesChannelId: channelId,
          customerAccountId,
          organizationId,
          statusCode: graph.initialCode(),
          currency: filing.channel.defaultCurrency,
          freeReturnEligible: false,
          submittedAt: now,
          consumerWithdrawal: false,
          purchaseProofNumber: input.purchase.proofNumber || null,
          purchaseDate: input.purchase.date,
          contact: { name: input.contact.name, email: input.contact.email, phone: input.contact.phone || null },
          returnAddress: input.returnAddress,
          acceptedClauses: shownClauses,
          clausesAcceptedAt: shownClauses.length > 0 ? now : null,
          submissionKey: input.submissionKey ?? null,
          // 181 data-model §1 — set on a guest's case only.
          guestSessionId: guest?.id ?? null,
          contactVerifiedAt: guest?.verifiedAt ?? null,
          trackingVersion: guest ? 1 : null,
        });
        em.persist(rc);
        // In request order: an attachment's `line` indexes into it.
        const itemIds: string[] = [];
        for (const line of input.lines) {
          const item = em.create(ReturnCaseItem, {
            returnCaseId: rc.id,
            orderItemId: null,
            productId: line.productId ?? null,
            // FR-B14 — the catalog name at submission, or the model as typed.
            productName: line.productId ? names.get(line.productId) || line.productId : line.modelName!,
            quantity: line.quantity,
            reasonId: line.reasonId,
            description: line.description,
            serialNumber: line.serialNumber || null,
            defaultRefundAmount: '0.00',
            defaultDiscountAmount: '0.00',
            approvedRefundAmount: '0.00',
          });
          em.persist(item);
          itemIds.push(item.id);
        }
        const claimed =
          filer.kind === 'customer'
            ? await this.claimAttachments(em, input, filer.customer, filer.organizationId, rc.id, itemIds)
            : await this.claimGuestAttachments(em, input, filer.session.id, rc.id, itemIds);
        // FR-B21 — judged on what this filing attaches.
        if (proofRequired && !claimed.types.includes('proof_of_purchase')) {
          throw new HttpError(
            422,
            ERROR_CODES.RETURN_PROOF_OF_PURCHASE_REQUIRED,
            'Attach a proof of purchase: a receipt or an invoice.',
          );
        }
        this.addFirstComment(em, rc.id, customerAccountId, input.comment);
        await em.flush();
        const audit = filingAudit(rc, input.lines.length, claimed.count, shownClauses.length);
        return {
          result: rc.id,
          before: null,
          // 181 research R-6 — the Command runs in the anonymous system context, so the
          // entry says who filed it: a guest, and which session (an opaque id).
          after: guest ? { ...audit, by: 'guest', guestSessionId: guest.id } : audit,
        };
      },
      event: (id) => this.createdEvent(id, organizationId, channelId, 'complaint', true, guest !== null),
    });
  }

  /**
   * File a complaint as a guest (`specs/181-guest-complaints/` G7; FR-030 – FR-036). The
   * route has checked the module, the setting and the session; the case is stamped from
   * the session alone — no account, no organization, the verified address (FR-033).
   *
   * - A honeypot hit is answered as a success and creates nothing (research R-8).
   * - A repeated `submissionKey` from the same session answers the case already filed;
   *   from another session it is a new case (R-4).
   * - 5 cases per session and 10 per verified address in 24 hours (R-8).
   */
  async createGuestCase(
    input: CreateGuestComplaintRequest,
    session: GuestFilingSession,
    filing: FilingContext,
  ): Promise<{ filed: GuestCaseFiled; created: boolean }> {
    const guest = this.deps.guest;
    if (!guest) throw new HttpError(401, ERROR_CODES.RETURN_GUEST_SESSION_REQUIRED, 'Confirm your e-mail address again to continue.');
    if (isHoneypotHit(input)) {
      const decoy = randomUUID();
      return {
        filed: { reference: caseReference({ id: decoy, rmaNumber: null }), trackingToken: guest.links.trackingToken(decoy, 1), email: session.email },
        created: true,
      };
    }
    const repeated = await this.filedByGuestWithKey(session.id, input.submissionKey);
    if (repeated) return { filed: this.guestFiled(repeated, session.email), created: false };
    await this.assertGuestRoom(session);
    assertAttachmentLines(input);
    const { hp: _hp, ...rest } = input;
    const complaint: CreateOffPlatformComplaintRequest = {
      ...rest,
      orderId: null,
      contact: { name: rest.contact.name, email: session.email, ...(rest.contact.phone ? { phone: rest.contact.phone } : {}) },
    };
    try {
      const caseId = await this.fileOffPlatform(complaint, { kind: 'guest', session }, filing);
      const rc = await this.deps.emFactory().findOneOrFail(ReturnCase, { id: caseId, customerAccountId: null });
      return { filed: this.guestFiled(rc, session.email), created: true };
    } catch (error) {
      // Two posts with one key raced: the second lost on the unique index.
      const raced = await this.filedByGuestWithKey(session.id, input.submissionKey);
      if (raced) return { filed: this.guestFiled(raced, session.email), created: false };
      throw error;
    }
  }

  private guestFiled(rc: ReturnCase, email: string): GuestCaseFiled {
    return {
      reference: caseReference(rc),
      trackingToken: this.deps.guest!.links.trackingToken(rc.id, rc.trackingVersion ?? 1),
      email,
    };
  }

  private async filedByGuestWithKey(guestSessionId: string, submissionKey: string | undefined): Promise<ReturnCase | null> {
    if (!submissionKey) return null;
    return this.deps.emFactory().findOne(ReturnCase, { guestSessionId, submissionKey, customerAccountId: null });
  }

  /** 181 research R-8 — the per-session and per-address limits; `429` names which. */
  private async assertGuestRoom(session: GuestFilingSession): Promise<void> {
    const em = this.deps.emFactory();
    const inSession = await em.count(ReturnCase, { guestSessionId: session.id, customerAccountId: null });
    if (inSession >= GUEST_CASES_PER_SESSION) throw guestLimit('cases_per_session');
    const since = new Date(this.now().getTime() - 24 * 3_600_000);
    const rows = (await em.execute(
      `select count(*)::int as "n" from "return_cases"
        where "customer_account_id" is null and "contact" is not null
          and lower("contact"->>'email') = lower(?) and "submitted_at" > ?`,
      [session.email.trim(), since],
    )) as Array<{ n: number }>;
    if (Number(rows[0]?.n ?? 0) >= GUEST_CASES_PER_ADDRESS_PER_DAY) throw guestLimit('cases_per_address');
  }

  private async claimGuestAttachments(
    em: EntityManager,
    input: CreateReturnCaseRequest,
    guestSessionId: string,
    returnCaseId: string,
    itemIds: readonly string[],
  ): Promise<{ count: number; types: ReturnAttachmentType[] }> {
    const uploads = (input.attachments ?? []).map((a) => ({
      uploadId: a.uploadId,
      returnCaseItemId: a.line === undefined ? null : itemIds[a.line]!,
    }));
    if (uploads.length === 0) return { count: 0, types: [] };
    if (!this.deps.attachments?.claimForGuest || !this.deps.guest) {
      throw new HttpError(422, ERROR_CODES.RETURN_ATTACHMENT_REJECTED, 'This upload cannot be attached.', {
        reason: 'unknown_upload',
        uploadId: uploads[0]!.uploadId,
      });
    }
    return this.deps.attachments.claimForGuest(em, this.deps.guest.access, { uploads, guestSessionId, returnCaseId });
  }

  private async verifyClauses(
    input: CreateReturnCaseRequest,
    salesChannelId: string,
    consumerWithdrawal: boolean,
    language: string,
  ): Promise<ShownClause[]> {
    if (!this.deps.clauses) return [];
    return this.deps.clauses.verify({
      salesChannelId,
      kind: input.kind,
      consumerWithdrawal,
      shown: input.shownClauses,
      accepted: input.acceptedClauses,
      language,
    });
  }

  private async claimAttachments(
    em: EntityManager,
    input: CreateReturnCaseRequest,
    customer: ReturnCustomerContext,
    organizationId: string | null,
    returnCaseId: string,
    itemIds: readonly string[],
  ): Promise<{ count: number; types: ReturnAttachmentType[] }> {
    // `assertAttachmentLines` has judged every `line` before the Command ran.
    const uploads = (input.attachments ?? []).map((a) => ({
      uploadId: a.uploadId,
      returnCaseItemId: a.line === undefined ? null : itemIds[a.line]!,
    }));
    if (uploads.length === 0 || !this.deps.attachments || !organizationId) {
      if (uploads.length > 0) {
        throw new HttpError(422, ERROR_CODES.RETURN_ATTACHMENT_REJECTED, 'This upload cannot be attached.', {
          reason: 'unknown_upload',
          uploadId: uploads[0]!.uploadId,
        });
      }
      return { count: 0, types: [] };
    }
    return this.deps.attachments.claim(em, {
      uploads,
      customerAccountId: customer.customerAccountId,
      organizationId,
      returnCaseId,
    });
  }

  /** The filing's own comment: the customer's, or — with no account — the guest's (181). */
  private addFirstComment(em: EntityManager, returnCaseId: string, customerAccountId: string | null, comment: string | undefined): void {
    if (!comment) return;
    em.persist(
      em.create(ReturnCaseComment, {
        returnCaseId,
        authorCustomerAccountId: customerAccountId,
        authorGuest: customerAccountId === null,
        body: comment,
        isCustomerVisible: true,
        notifyCustomer: false,
      }),
    );
  }

  /** `return_case.created.v1` — ids only, dispatched by the bus after the commit. */
  private createdEvent(
    returnCaseId: string,
    organizationId: string | null,
    salesChannelId: string,
    kind: 'return' | 'complaint',
    offPlatform: boolean,
    guest = false,
  ): { eventName: string; payload: ReturnCaseCreatedEventV1 } | undefined {
    // A customer's case without an organization is never filed (Principle XI); a guest's
    // never has one (181 research R-1).
    if (!organizationId && !guest) return undefined;
    return {
      eventName: RETURN_CASE_CREATED_EVENT,
      payload: {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        returnCaseId,
        organizationId: organizationId ?? null,
        salesChannelId,
        kind,
        offPlatform,
        guest,
      },
    };
  }

  /**
   * The buyer's case list: the cases they filed, or every case of their
   * Organization with `returns.view_organization` (`ReturnCaseScope`, FR-053).
   * `statusLabel` is in `language`, the request's (`resolveReturnStatusName`); without one it is
   * the status's `defaultName`.
   */
  async listForCustomer(customer: ReturnCustomerContext, language?: string): Promise<ReturnCaseSummary[]> {
    const em = this.deps.emFactory();
    const cases = await em.find(
      ReturnCase,
      await this.deps.scope.where(customer),
      { orderBy: { submittedAt: 'desc' } },
    );
    const graph = await this.deps.graphService.loadGraph();
    const lines = await caseLinesOf(em, cases.map((rc) => rc.id));
    return cases.map((rc) => this.toSummary(rc, labelOf(graph, rc.statusCode, language), lines.get(rc.id)));
  }

  /** One case, within the same scope as {@link listForCustomer}; out of it is `404`. */
  async getForCustomer(id: string, customer: ReturnCustomerContext, language?: string): Promise<ReturnCaseDetail> {
    // A malformed id names no case; PostgreSQL would answer it with a 500 (issue #753).
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const em = this.deps.emFactory();
    const rc = await em.findOne(ReturnCase, await this.deps.scope.where(customer, { id }));
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    return this.mapDetail(em, rc.id, { customerView: true, ...(language ? { language } : {}) });
  }

  /**
   * Customer withdraws their own case (if the workflow permits the transition).
   * The filer's only, whatever the caller's permissions: seeing a colleague's
   * case does not open its actions (`specs/170-organization-roles/` Q-R2 = A).
   */
  async cancelByCustomer(id: string, customerAccountId: string, language?: string): Promise<ReturnCaseDetail> {
    const em = this.deps.emFactory();
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const rc = await em.findOne(ReturnCase, { id, customerAccountId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    await this.deps.transitions.apply(id, RETURN_STATUS_CANCELLED, { kind: 'customer', customerAccountId });
    return this.mapDetail(this.deps.emFactory(), id, { customerView: true, ...(language ? { language } : {}) });
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
   * withdrawal (issue #905, design §2): a `return`, an Organization that was a
   * consumer when the order was placed (`organizationWasConsumerAt`), and the
   * withdrawal function still available for the order.
   */
  private async isConsumerWithdrawal(
    kind: CreateReturnCaseRequest['kind'],
    ctx: OrderReturnContext,
    at: Date,
  ): Promise<boolean> {
    if (kind !== 'return' || !ctx.organizationId) return false;
    const organization = await this.deps.organizationDetails.findById(ctx.organizationId);
    // A consumer when the order was placed — also after a later conversion (FR-040).
    if (!organizationWasConsumerAt(organization, ctx.placedAt)) return false;
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

  private toSummary(
    rc: ReturnCase,
    statusLabel: string,
    lines: { productLabel: string; lineCount: number } | undefined,
  ): ReturnCaseSummary {
    return {
      id: rc.id,
      rmaNumber: rc.rmaNumber ?? null,
      kind: rc.kind,
      orderId: rc.orderId ?? null,
      statusCode: rc.statusCode,
      statusLabel,
      totalRefundAmount: Number(rc.totalRefundAmount),
      currency: rc.currency,
      submittedAt: rc.submittedAt.toISOString(),
      // The filer (`specs/170-organization-roles/` FR-053): a holder of
      // `returns.view_organization` lists colleagues' cases too.
      customerAccountId: rc.customerAccountId ?? null,
      reference: caseReference(rc),
      ...summaryExtras(rc, lines),
    };
  }

  private async mapDetail(
    em: EntityManager,
    id: string,
    /** `language`: the buyer's request language, for `statusLabel`; absent = `defaultName`. */
    opts: { customerView: boolean; language?: string },
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
    // 180 FR-A41 — who authorized it, for the operator. The buyer's view names no
    // operator: it carries the time and leaves the authorizer out.
    const authorizedBy =
      opts.customerView || !this.deps.adminUsers
        ? null
        : ((await resolveAuthorizers(this.deps.adminUsers, [rc])).get(rc.id) ?? null);
    // Feature 155 (owner ruling R1) — each line's returnable-at-purchase record,
    // read through the port that already carries it, so the admin case view can
    // mark a complaint line that was not returnable when bought. A case without a
    // platform order reads no order (180 research R-10).
    const orderContext = rc.orderId == null ? null : await this.deps.orderContext.getReturnContext(rc.orderId);
    const returnableAtPurchase = new Map(
      (orderContext?.lines ?? []).map((l) => [l.orderItemId, l.returnableAtPurchase] as const),
    );
    const attachments = await em.find(
      ReturnCaseAttachment,
      { returnCaseId: id, storageLocator: { $ne: null } },
      { orderBy: { createdAt: 'asc' } },
    );
    return {
      ...this.toSummary(rc, labelOf(graph, rc.statusCode, opts.language), {
        productLabel: items[0]?.productName ?? '',
        lineCount: items.length,
      }),
      salesChannelId: rc.salesChannelId,
      customerAccountId: rc.customerAccountId ?? null,
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
        returnableAtPurchase: it.orderItemId ? (returnableAtPurchase.get(it.orderItemId) ?? null) : null,
        serialNumber: it.serialNumber ?? null,
      })),
      comments: visibleComments.map((c) => ({
        id: c.id,
        authorKind: c.authorGuest
          ? ('guest' as const)
          : c.authorAdminUserId
            ? ('admin' as const)
            : ('customer' as const),
        body: c.body,
        isCustomerVisible: c.isCustomerVisible,
        // "E-mail requested" (180 FR-A20) is the operator's; the buyer's view leaves it out.
        ...(opts.customerView ? {} : { notifyCustomer: c.notifyCustomer }),
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
      // Issue #876 — what the case refunds of the order's delivery and surcharge.
      chargeRefunds: {
        delivery: Number(rc.approvedDeliveryRefund),
        surcharge: Number(rc.approvedSurchargeRefund),
      },
      consumerWithdrawal: rc.consumerWithdrawal ?? null,
      alternativeResolutionConsent: alternativeResolutionConsentOf(rc, opts),
      authorizedAt: rc.authorizedAt ? rc.authorizedAt.toISOString() : null,
      authorizedBy,
      // 180 phase B (contracts/admin-api.md §B2, customer-api.md §C6).
      purchase: rc.purchaseDate ? { proofNumber: rc.purchaseProofNumber ?? null, date: rc.purchaseDate } : null,
      contact: rc.contact ?? null,
      returnAddress: rc.returnAddress ?? null,
      attachments: attachments.map(attachmentDtoOf),
      acceptedClauses: rc.acceptedClauses ?? [],
      clausesAcceptedAt: rc.clausesAcceptedAt ? rc.clausesAcceptedAt.toISOString() : null,
      resolutionNote: opts.customerView ? null : (rc.resolutionNote ?? null),
      personalDataErasedAt: opts.customerView || !rc.personalDataErasedAt ? null : rc.personalDataErasedAt.toISOString(),
      // `specs/181-guest-complaints/` (admin-api.md A2, FR-063) — `null` on every customer
      // case. Both dates are computed, never stored: the link works until 90 days after
      // closing, and the data falls due at closing + the clamped retention (research R-9).
      // Both are `null` while the case is open and once its data is erased.
      contactVerifiedAt: rc.contactVerifiedAt ? rc.contactVerifiedAt.toISOString() : null,
      ...(await this.guestDates(rc, opts.customerView)),
    };
  }

  private async guestDates(
    rc: ReturnCase,
    customerView: boolean,
  ): Promise<Pick<ReturnCaseDetail, 'trackingLinkValidUntil' | 'guestDataErasureDueAt'>> {
    if (customerView || rc.customerAccountId != null || rc.personalDataErasedAt || !rc.closedAt) {
      return { trackingLinkValidUntil: null, guestDataErasureDueAt: null };
    }
    const retention = this.deps.guestRetentionDays ? await this.deps.guestRetentionDays() : GUEST_RETENTION_DEFAULT_DAYS;
    return {
      trackingLinkValidUntil: trackingLinkValidUntil(rc)?.toISOString() ?? null,
      guestDataErasureDueAt: guestDataErasureDueAt(rc, retention)?.toISOString() ?? null,
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

/** The summary fields a list derives (180 FR-B34, D-3). */
export function summaryExtras(
  rc: ReturnCase,
  lines: { productLabel: string; lineCount: number } | undefined,
): Pick<ReturnCaseSummary, 'offPlatform' | 'productLabel' | 'lineCount' | 'purchaseDate' | 'guest'> {
  return {
    offPlatform: rc.orderId == null,
    // `specs/181-guest-complaints/` — derived: no account filed it. Never stored.
    guest: rc.customerAccountId == null,
    productLabel: lines?.productLabel ?? '',
    lineCount: lines?.lineCount ?? 0,
    purchaseDate: rc.orderId == null ? (rc.purchaseDate ?? null) : null,
  };
}

/** A stored, served attachment as the detail lists it (180 FR-B23). */
export function attachmentDtoOf(a: ReturnCaseAttachment): ReturnCaseDetail['attachments'][number] {
  return {
    id: a.id,
    returnCaseId: a.returnCaseId!,
    returnCaseItemId: a.returnCaseItemId ?? null,
    type: a.type,
    filename: a.filename ?? '',
    mimeType: a.mimeType ?? 'application/octet-stream',
    sizeBytes: a.sizeBytes ?? 0,
    createdAt: a.createdAt.toISOString(),
    uploadedByGuest: a.uploadedByGuest,
  };
}

/** A status's label: in `language` when the reader has one, else its `defaultName` (admin). */
function labelOf(graph: ReturnStatusGraph, code: string, language: string | undefined): string {
  const def = graph.get(code);
  if (!def) return code;
  return language ? resolveReturnStatusName(def, language) : def.defaultName;
}

/** `429 RETURN_GUEST_LIMIT_REACHED`, naming the limit (181 research R-8). */
function guestLimit(limit: 'cases_per_session' | 'cases_per_address'): HttpError {
  return new HttpError(429, ERROR_CODES.RETURN_GUEST_LIMIT_REACHED, 'You have reached the limit for now. Try again later.', {
    limit,
  });
}

/**
 * A file the create request ties to a line names one of the request's own lines — its
 * index in `lines` (owner request on 180: each product has its own defect photos).
 * Judged before the Command runs, so a refused filing writes nothing.
 */
function assertAttachmentLines(input: Pick<CreateReturnCaseRequest, 'attachments' | 'lines'>): void {
  for (const attachment of input.attachments ?? []) {
    if (attachment.line !== undefined && attachment.line >= input.lines.length) {
      throw new HttpError(422, ERROR_CODES.RETURN_ATTACHMENT_REJECTED, 'This file names a line the case does not have.', {
        reason: 'unknown_line',
        uploadId: attachment.uploadId,
        line: attachment.line,
      });
    }
  }
}

/**
 * What the `return_case.create` entry records (contracts/settings-emails-events.md §5):
 * names and counts — never a contact, an address, a description or a clause text.
 */
function filingAudit(rc: ReturnCase, lineCount: number, attachmentCount: number, clauseCount: number): Record<string, unknown> {
  return {
    kind: rc.kind,
    orderId: rc.orderId ?? null,
    offPlatform: rc.orderId == null,
    statusCode: rc.statusCode,
    lineCount,
    attachmentCount,
    clauseCount,
    consumerWithdrawal: rc.consumerWithdrawal ?? false,
  };
}

/** Quantities already named per order item, by the order's live cases. */
function consumedFrom(items: readonly OrderCaseItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) out.set(it.orderItemId, (out.get(it.orderItemId) ?? 0) + it.quantity);
  return out;
}
