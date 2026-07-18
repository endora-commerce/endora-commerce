import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type QuoteRequest as RfqDto,
  type QuoteRequestSummary,
  type CreateQuoteRequest,
  type PatchQuoteRequest,
  type ResubmitQuoteRequest,
  type RfqComparisonAgainstLastSeen,
} from '@b2b/contracts';
import type { EventBase, EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { QuoteRequest, type QuoteRequestStatus } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import {
  QuoteRequestEvent,
  type QuoteRequestEventType,
} from '../entities/quote-request-event.entity.js';
import type { QuoteRequestRevisionLine } from '../entities/quote-request-revision.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
import { Cart } from '../../carts/entities/cart.entity.js';
import { CartItem } from '../../carts/entities/cart-item.entity.js';
import type { RfqEventService } from './rfq-event-service.js';
import type { RfqRevisionService } from './rfq-revision-service.js';
import type { RfqNotificationService} from './rfq-notification-service.js';
import { type NotificationRecipient } from './rfq-notification-service.js';
import type { SalesRepAssignmentService } from '../../organizations/services/sales-rep-assignment-service.js';
import { AdminUser } from '../../admin_users/entities/admin-user.entity.js';
import type { QuoteRequestBusinessIdGenerator } from './quote-request-business-id-generator.js';

/**
 * Customer-facing Quote Requests service — feature 008 workflow.
 *
 * Lifecycle methods exposed (each maps to one HTTP route):
 *   - list / getById             (US1)
 *   - create + submit            (US1)
 *   - patchDraft                 (US1, customer-side edit before any internal-side action)
 *   - resubmit                   (US1, "Submit again")
 *   - acceptRevision / rejectRevision (US3 — also covers Created from admin per US4)
 *   - convertToOrder             (US5)
 *
 * The service writes through RfqEventService, RfqRevisionService, and
 * RfqNotificationService for every state change so audit + comparison
 * + notifications are consistent across all entry points.
 */

export interface RfqEvents extends Record<string, EventBase> {
  'rfq.created.v1': EventBase & { rfqId: string; organizationId: string };
  'rfq.approved.v1': EventBase & { rfqId: string };
  'rfq.canceled.v1': EventBase & { rfqId: string; reason: string | null };
  'rfq.modified.v1': EventBase & { rfqId: string; revisionNumber: number };
}
export type RfqEventBus = EventBus<RfqEvents>;

export interface CustomerContext {
  customerAccountId: string;
  organizationId: string;
  /** True when the customer account holds the org-admin role on the
   * current organization (FR-011 — broader visibility). */
  isOrgAdmin: boolean;
}

export interface RfqServiceDeps {
  emFactory: () => EntityManager;
  events: RfqEventBus;
  eventService: RfqEventService;
  revisionService: RfqRevisionService;
  notificationService: RfqNotificationService;
  salesRepAssignment: SalesRepAssignmentService;
  /**
   * Generates the customer-facing business Quote Request ID. Optional so
   * legacy/test compositions that don't wire it fall back to the entity's
   * placeholder default.
   */
  businessId?: QuoteRequestBusinessIdGenerator;
  /**
   * Resolves the VAT rate (fraction, e.g. `0.23`) applied to the quote's net
   * prices for the given Organization. Mirrors the Orders flow. Optional —
   * when omitted (legacy/test compositions), prices stay net (rate `0`).
   */
  resolveTaxRate?: (organizationId: string) => Promise<number>;
  /** Feature 054 — audits RFQ writes co-transactionally when provided. */
  auditLog?: AuditLogService;
}

export class RfqService {
  constructor(private readonly deps: RfqServiceDeps) {}

  /** Feature 054 — co-transactional RFQ audit on `em` (actor from context). */
  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, {
        action,
        objectType: 'quote_request',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  /**
   * Draws the next business Quote Request ID, or `undefined` when no generator
   * is wired (so the entity placeholder default applies). Shared with
   * RfqAdminService so admin-created RFQs are numbered identically.
   */
  async generateBusinessId(em: EntityManager): Promise<string | undefined> {
    return this.deps.businessId ? this.deps.businessId.generate(em) : undefined;
  }

  /**
   * Resolves the VAT rate applied to a quote's net prices for an
   * Organization. Returns `0` when no resolver is wired so net-only
   * compositions keep their current behaviour.
   */
  async taxRateForOrganization(organizationId: string): Promise<number> {
    return this.deps.resolveTaxRate ? this.deps.resolveTaxRate(organizationId) : 0;
  }

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  async listForCustomer(ctx: CustomerContext): Promise<QuoteRequestSummary[]> {
    const em = this.deps.emFactory();
    const where = ctx.isOrgAdmin
      ? { organizationId: ctx.organizationId }
      : { customerAccountId: ctx.customerAccountId };
    const rfqs = await em.find(QuoteRequest, where, { orderBy: { createdAt: 'desc' } });
    if (rfqs.length === 0) return [];

    const items = await em.find(QuoteRequestItem, {
      quoteRequestId: { $in: rfqs.map((r) => r.id) },
    });
    const itemsByRfq = groupBy(items, (i) => i.quoteRequestId);

    const requesterIds = [...new Set(rfqs.map((r) => r.customerAccountId))];
    const requesters = await em.find(CustomerAccount, { id: { $in: requesterIds } });
    const requesterById = new Map(requesters.map((r) => [r.id, r]));

    // Every RFQ in a customer listing belongs to the same Organization
    // (the caller's), so the VAT rate is resolved once for the page.
    const taxRate = await this.taxRateForOrganization(ctx.organizationId);

    return rfqs.map((rfq) => {
      const rfqItems = itemsByRfq.get(rfq.id) ?? [];
      const requester = requesterById.get(rfq.customerAccountId);
      return summarize(rfq, rfqItems, {
        requesterDisplayName: requester ? customerDisplayName(requester) : null,
        taxRate,
      });
    });
  }

  async getForCustomer(rfqId: string, ctx: CustomerContext): Promise<RfqDto> {
    // command-coverage-ignore: read-tracking side effect — advances
    // last_customer_seen_revision_number on view, not an audited domain mutation.
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForCustomer(em, rfqId, ctx);

    // Compute the response BEFORE bumping last_customer_seen_revision_number.
    // The comparison block must diff against the revision the customer last
    // saw, which is the value as-of-this-read; bumping first would always
    // produce an empty diff.
    const dto = await this.serializeFull(em, rfq, /* includeFullActorIdentity */ false);

    // Side-effect on read: advance last_customer_seen so the next visit
    // reflects what the customer has now seen (FR-035 + US3).
    if (rfq.lastCustomerSeenRevisionNumber < rfq.currentRevisionNumber) {
      rfq.lastCustomerSeenRevisionNumber = rfq.currentRevisionNumber;
      await em.flush();
    }

    return dto;
  }

  // -------------------------------------------------------------------------
  // Create + submit (US1)
  // -------------------------------------------------------------------------

  async createForCustomer(ctx: CustomerContext, input: CreateQuoteRequest): Promise<RfqDto> {
    if (input.items.length === 0) {
      throw new HttpError(400, ERROR_CODES.RFQ_EMPTY, 'Quote Request must have at least one line item.');
    }
    const em = this.deps.emFactory();
    const products = await em.find(Product, { id: { $in: input.items.map((it) => it.productId) } });
    const productById = new Map(products.map((p) => [p.id, p]));
    if (productById.size !== new Set(input.items.map((it) => it.productId)).size) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'One or more products do not exist.');
    }

    const businessId = await this.generateBusinessId(em);
    const rfq = em.create(QuoteRequest, {
      ...(businessId ? { businessId } : {}),
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
      status: 'Pending' satisfies QuoteRequestStatus,
      headerNote: input.headerNote ?? null,
      submittedAt: new Date(),
      currentRevisionNumber: 1,
      lastCustomerSeenRevisionNumber: 1,
    });
    await em.persistAndFlush(rfq);

    const items: QuoteRequestItem[] = [];
    for (const lineInput of input.items) {
      const product = productById.get(lineInput.productId)!;
      // Feature 043 — append the packaging-unit name to the snapshot name so
      // RFQ views show "<name> (Paleta)", and persist the structured snapshot.
      const baseName = anyLocaleValue(product.name);
      const productName = lineInput.packagingUnitName
        ? `${baseName} (${lineInput.packagingUnitName})`
        : baseName;
      const item = em.create(QuoteRequestItem, {
        quoteRequestId: rfq.id,
        productId: product.id,
        productName,
        productSlug: product.slug,
        variantId: lineInput.variantId ?? null,
        quantity: lineInput.quantity,
        ...(lineInput.packagingUnitName
          ? { packagingUnitName: lineInput.packagingUnitName }
          : {}),
        ...(lineInput.packagingUnitBaseQuantity != null
          ? { packagingUnitBaseQuantity: lineInput.packagingUnitBaseQuantity }
          : {}),
        desiredUnitPrice:
          lineInput.desiredUnitPrice !== undefined ? lineInput.desiredUnitPrice.toFixed(2) : null,
        lineNote: lineInput.lineNote ?? null,
        lineCurrency: 'PLN',
      });
      items.push(item);
    }
    this.#audit(em, 'quote_request.create', rfq.id, null, {
      status: rfq.status,
      itemCount: items.length,
    });
    await em.persistAndFlush(items);

    const revision = await this.deps.revisionService.record({
      rfq,
      items,
      actor: { customerAccountId: ctx.customerAccountId },
    });

    const created = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'created',
      actor: { customerAccountId: ctx.customerAccountId, roleLabel: 'Customer' },
      payload: { type: 'created' },
      revisionId: revision.id,
    });
    const submitted = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: 'submitted',
      actor: { customerAccountId: ctx.customerAccountId, roleLabel: 'Customer' },
      payload: {
        type: 'submitted',
        itemCount: items.length,
      },
      revisionId: revision.id,
    });

    await this.notifyInternalSide(rfq.organizationId, submitted.id, rfq.id);

    this.deps.events.emit('rfq.created.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      rfqId: rfq.id,
      organizationId: rfq.organizationId,
    });

    void created; // referenced for ordering side-effect
    return this.serializeFull(em, rfq, false);
  }

  // -------------------------------------------------------------------------
  // Customer-side patch on a Pending RFQ that no internal user has touched yet
  // -------------------------------------------------------------------------

  async patchDraft(
    rfqId: string,
    ctx: CustomerContext,
    body: PatchQuoteRequest,
    expectedVersion: number | null,
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForCustomer(em, rfqId, ctx);
    if (rfq.status !== 'Pending') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_DRAFT, 'Quote Request is not editable.');
    }

    // Reject if any modify event has been written by an admin user — the
    // customer must use accept-revision/reject-revision instead.
    const adminTouched = await em.findOne(QuoteRequestEvent, {
      quoteRequestId: rfq.id,
      eventType: 'modified',
    });
    if (adminTouched) {
      throw new HttpError(
        409,
        ERROR_CODES.RFQ_NOT_DRAFT,
        'Quote Request is in admin review; resubmit instead of editing.',
      );
    }

    if (expectedVersion !== null && rfq.version !== expectedVersion) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Quote Request was updated concurrently.');
    }

    if (body.headerNote !== undefined) rfq.headerNote = body.headerNote ?? null;

    if (body.items) {
      const products = await em.find(Product, { id: { $in: body.items.map((it) => it.productId) } });
      const productById = new Map(products.map((p) => [p.id, p]));
      if (productById.size !== new Set(body.items.map((it) => it.productId)).size) {
        throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'One or more products do not exist.');
      }
      const existingItems = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id });
      await em.removeAndFlush(existingItems);

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
            desiredUnitPrice:
              lineInput.desiredUnitPrice !== undefined
                ? lineInput.desiredUnitPrice.toFixed(2)
                : null,
            lineNote: lineInput.lineNote ?? null,
            lineCurrency: 'PLN',
          }),
        );
      }
      await em.persistAndFlush(items);
    }

    rfq.currentRevisionNumber += 1;
    rfq.lastCustomerSeenRevisionNumber = rfq.currentRevisionNumber;
    rfq.version += 1;
    this.#audit(em, 'quote_request.patch_draft', rfq.id, null, {
      currentRevisionNumber: rfq.currentRevisionNumber,
    });
    await em.flush();

    const items = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id });
    const previousRevision = await this.deps.revisionService.byNumber(
      rfq.id,
      rfq.currentRevisionNumber - 1,
    );
    const revision = await this.deps.revisionService.record({
      rfq,
      items,
      actor: { customerAccountId: ctx.customerAccountId },
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
      actor: { customerAccountId: ctx.customerAccountId, roleLabel: 'Customer' },
      payload: { type: 'modified', diff },
      revisionId: revision.id,
    });
    void evt;

    return this.serializeFull(em, rfq, false);
  }

  // -------------------------------------------------------------------------
  // Resubmit (US1) — clones the original at the customer's current price list
  // -------------------------------------------------------------------------

  async resubmit(
    rfqId: string,
    ctx: CustomerContext,
    body: ResubmitQuoteRequest,
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const sourceRfq = await this.findVisibleForCustomer(em, rfqId, ctx);

    const sourceItems = await em.find(QuoteRequestItem, { quoteRequestId: sourceRfq.id });
    if (sourceItems.length === 0) {
      throw new HttpError(400, ERROR_CODES.RFQ_EMPTY, 'Source RFQ has no items.');
    }

    const newRfq = em.create(QuoteRequest, {
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
      status: 'Pending' satisfies QuoteRequestStatus,
      headerNote: body.headerNote ?? null,
      submittedAt: new Date(),
      currentRevisionNumber: 1,
      lastCustomerSeenRevisionNumber: 1,
    });
    await em.persistAndFlush(newRfq);

    const newItems: QuoteRequestItem[] = sourceItems.map((src) =>
      em.create(QuoteRequestItem, {
        quoteRequestId: newRfq.id,
        productId: src.productId,
        productName: src.productName,
        productSlug: src.productSlug ?? null,
        variantId: src.variantId ?? null,
        quantity: src.quantity,
        desiredUnitPrice: null,
        lineNote: src.lineNote ?? null,
        lineCurrency: src.lineCurrency,
      }),
    );
    this.#audit(em, 'quote_request.resubmit', newRfq.id, null, {
      status: newRfq.status,
      itemCount: newItems.length,
    });
    await em.persistAndFlush(newItems);

    const revision = await this.deps.revisionService.record({
      rfq: newRfq,
      items: newItems,
      actor: { customerAccountId: ctx.customerAccountId },
    });

    await this.deps.eventService.append({
      quoteRequestId: newRfq.id,
      eventType: 'created',
      actor: { customerAccountId: ctx.customerAccountId, roleLabel: 'Customer' },
      payload: { type: 'created', sourceRfqId: sourceRfq.id },
      revisionId: revision.id,
    });
    const submittedEvt = await this.deps.eventService.append({
      quoteRequestId: newRfq.id,
      eventType: 're-submitted',
      actor: { customerAccountId: ctx.customerAccountId, roleLabel: 'Customer' },
      payload: { type: 're-submitted', sourceRfqId: sourceRfq.id, newRfqId: newRfq.id },
      revisionId: revision.id,
    });

    await this.notifyInternalSide(newRfq.organizationId, submittedEvt.id, newRfq.id);

    return this.serializeFull(em, newRfq, false);
  }

  // -------------------------------------------------------------------------
  // Accept / reject revision (US3 — also handles Created from admin per US4)
  // -------------------------------------------------------------------------

  async acceptRevision(
    rfqId: string,
    ctx: CustomerContext,
    expectedRevisionNumber: number,
  ): Promise<RfqDto> {
    return this.respondToRevision(rfqId, ctx, expectedRevisionNumber, 'accept');
  }

  async rejectRevision(
    rfqId: string,
    ctx: CustomerContext,
    expectedRevisionNumber: number,
    reason: string | undefined,
  ): Promise<RfqDto> {
    return this.respondToRevision(rfqId, ctx, expectedRevisionNumber, 'reject', reason);
  }

  private async respondToRevision(
    rfqId: string,
    ctx: CustomerContext,
    expectedRevisionNumber: number,
    decision: 'accept' | 'reject',
    reason?: string,
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForCustomer(em, rfqId, ctx);

    if (rfq.status !== 'Pending' && rfq.status !== 'Created from admin') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request is not awaiting your decision.');
    }
    if (rfq.currentRevisionNumber !== expectedRevisionNumber) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        'Quote Request was revised again — refresh and try again.',
      );
    }

    const now = new Date();
    if (decision === 'accept') {
      rfq.status = 'Approved';
      rfq.approvedAt = now;
    } else {
      rfq.status = 'Canceled';
      rfq.canceledAt = now;
      if (reason) rfq.cancellationReason = reason;
    }
    rfq.awaitingCustomerRevisionAcceptance = false;
    rfq.lastCustomerSeenRevisionNumber = rfq.currentRevisionNumber;
    rfq.version += 1;
    this.#audit(em, 'quote_request.respond_to_revision', rfq.id, null, {
      decision,
      status: rfq.status,
      revisionNumber: rfq.currentRevisionNumber,
    });
    await em.flush();

    const eventType: QuoteRequestEventType =
      decision === 'accept' ? 'customer-accepted-revision' : 'customer-rejected-revision';
    const eventPayload: Record<string, unknown> = {
      type: eventType,
      revisionNumber: rfq.currentRevisionNumber,
    };
    if (decision === 'reject' && reason) eventPayload['reason'] = reason;
    const revisionEvt = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType,
      actor: { customerAccountId: ctx.customerAccountId, roleLabel: 'Customer' },
      payload: eventPayload,
    });

    const terminalEventType: QuoteRequestEventType = decision === 'accept' ? 'approved' : 'canceled';
    const terminalPayload: Record<string, unknown> =
      decision === 'accept'
        ? { type: 'approved', approvedBy: 'customer' }
        : { type: 'canceled', canceledBy: 'customer', reason: reason ?? null };
    const terminalEvt = await this.deps.eventService.append({
      quoteRequestId: rfq.id,
      eventType: terminalEventType,
      actor: { customerAccountId: ctx.customerAccountId, roleLabel: 'Customer' },
      payload: terminalPayload,
    });
    void revisionEvt;

    await this.notifyInternalSide(rfq.organizationId, terminalEvt.id, rfq.id);

    if (decision === 'accept') {
      this.deps.events.emit('rfq.approved.v1', {
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        rfqId: rfq.id,
      });
    } else {
      this.deps.events.emit('rfq.canceled.v1', {
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        rfqId: rfq.id,
        reason: reason ?? null,
      });
    }

    return this.serializeFull(em, rfq, false);
  }

  // -------------------------------------------------------------------------
  // Convert to order (US5)
  // -------------------------------------------------------------------------

  async convertToOrder(
    rfqId: string,
    ctx: CustomerContext,
  ): Promise<{ cartId: string; checkoutUrl: string }> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForCustomer(em, rfqId, ctx);

    if (rfq.status !== 'Approved') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request is not approved.');
    }

    const items = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id });
    if (items.length === 0) {
      throw new HttpError(409, ERROR_CODES.RFQ_EMPTY, 'Quote Request has no items.');
    }

    // Validate every line's product is still resolvable. The spec edge
    // case "product archived between approve and convert" maps to a 409
    // here so the customer is forced to contact the rep.
    const productIds = items.map((it) => it.productId);
    const products = await em.find(Product, { id: { $in: productIds } });
    if (products.length !== new Set(productIds).size) {
      throw new HttpError(
        409,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        'One or more Quote Request line products are no longer available.',
      );
    }

    // Get-or-create the customer's active cart, clear it, and reseed at
    // the RFQ's agreed unit prices. The orders module copies
    // CartItem.unitPrice straight onto OrderItem.unitPrice (no
    // recomputation), so the negotiated price flows through unchanged.
    let cart = await em.findOne(Cart, {
      customerAccountId: ctx.customerAccountId,
      organizationId: ctx.organizationId,
      status: 'active',
    });
    if (!cart) {
      cart = em.create(Cart, {
        customerAccountId: ctx.customerAccountId,
        organizationId: ctx.organizationId,
      });
      await em.persistAndFlush(cart);
    } else {
      const existing = await em.find(CartItem, { cartId: cart.id });
      if (existing.length > 0) await em.removeAndFlush(existing);
    }

    const newCartItems: CartItem[] = items.map((it) =>
      em.create(CartItem, {
        cartId: cart!.id,
        productId: it.productId,
        ...(it.variantId ? { variantId: it.variantId } : {}),
        quantity: it.quantity,
        unitPrice: (it.agreedUnitPrice ?? '0').toString(),
        currency: it.lineCurrency,
      }),
    );
    this.#audit(em, 'quote_request.convert_to_order', rfq.id, null, {
      cartId: cart.id,
      itemCount: newCartItems.length,
    });
    await em.persistAndFlush(newCartItems);

    return {
      cartId: cart.id,
      checkoutUrl: `/checkout?cartId=${cart.id}&fromRfq=${rfq.id}`,
    };
  }

  // -------------------------------------------------------------------------
  // Lookup with visibility check
  // -------------------------------------------------------------------------

  private async findVisibleForCustomer(
    em: EntityManager,
    rfqId: string,
    ctx: CustomerContext,
  ): Promise<QuoteRequest> {
    const rfq = await em.findOne(QuoteRequest, { id: rfqId });
    if (!rfq) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Quote Request not found.');
    if (rfq.organizationId !== ctx.organizationId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Quote Request not found.');
    }
    if (!ctx.isOrgAdmin && rfq.customerAccountId !== ctx.customerAccountId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Quote Request not found.');
    }
    return rfq;
  }

  // -------------------------------------------------------------------------
  // Notification helpers
  // -------------------------------------------------------------------------

  private async notifyInternalSide(
    organizationId: string,
    sourceEventId: string,
    quoteRequestId: string,
  ): Promise<void> {
    const em = this.deps.emFactory();
    // Find every admin user assigned to the org. If the org is unassigned,
    // fan out to every active admin user holding the sales_representative
    // role plus every platform_admin (research §R4).
    const orgHasAssignment = await em
      .count(
        // Late import via the sibling service is awkward here; use a raw
        // EntityManager find on the assignment entity.
        (await import('../../organizations/entities/organization-sales-rep-assignment.entity.js'))
          .OrganizationSalesRepAssignment,
        { organizationId },
      )
      .catch(() => 0);

    const recipients: NotificationRecipient[] = [];
    if (orgHasAssignment > 0) {
      const assignments = await this.deps.salesRepAssignment.listForOrganization(organizationId);
      for (const a of assignments) recipients.push({ adminUserId: a.adminUserId });
    } else {
      const everyAdmin = await em.find(AdminUser, {});
      for (const a of everyAdmin) recipients.push({ adminUserId: a.id });
    }

    await this.deps.notificationService.enqueue({
      quoteRequestId,
      sourceEventId,
      recipients,
      channels: ['email', 'in_app'],
    });
  }

  // -------------------------------------------------------------------------
  // Serialisation
  // -------------------------------------------------------------------------

  /** Serialise to the customer-facing response shape. Hides internal admin
   * actor identity behind `actorRoleLabel` per FR-037 unless
   * `includeFullActorIdentity = true` (admin path). */
  async serializeFull(
    em: EntityManager,
    rfq: QuoteRequest,
    includeFullActorIdentity: boolean,
  ): Promise<RfqDto> {
    const items = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id });
    const taxRate = await this.taxRateForOrganization(rfq.organizationId);
    const events = await em.find(
      QuoteRequestEvent,
      { quoteRequestId: rfq.id },
      { orderBy: { createdAt: 'asc' } },
    );

    let comparison: RfqComparisonAgainstLastSeen | null = null;
    if (rfq.awaitingCustomerRevisionAcceptance) {
      const last = await this.deps.revisionService.byNumber(
        rfq.id,
        rfq.lastCustomerSeenRevisionNumber,
      );
      const current = await this.deps.revisionService.byNumber(
        rfq.id,
        rfq.currentRevisionNumber,
      );
      if (current) {
        const beforeItems: QuoteRequestRevisionLine[] = last?.itemsSnapshot ?? [];
        const beforeHeaderNote = last?.headerNoteSnapshot ?? null;
        comparison = {
          diff: this.deps.revisionService.diffRevisions({
            beforeHeaderNote,
            afterHeaderNote: current.headerNoteSnapshot ?? null,
            beforeItems,
            afterItems: current.itemsSnapshot,
          }),
          lastSeenRevisionNumber: rfq.lastCustomerSeenRevisionNumber,
          currentRevisionNumber: rfq.currentRevisionNumber,
        };
      }
    }

    return {
      id: rfq.id,
      businessId: rfq.businessId,
      organizationId: rfq.organizationId,
      customerAccountId: rfq.customerAccountId,
      createdByAdminUserId: rfq.createdByAdminUserId ?? null,
      assignedAdminUserId: rfq.assignedAdminUserId ?? null,
      status: rfq.status,
      awaitingCustomerRevisionAcceptance: rfq.awaitingCustomerRevisionAcceptance,
      currentRevisionNumber: rfq.currentRevisionNumber,
      lastCustomerSeenRevisionNumber: rfq.lastCustomerSeenRevisionNumber,
      headerNote: rfq.headerNote ?? null,
      cancellationReason: rfq.cancellationReason ?? null,
      items: items.map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        productSlug: it.productSlug ?? null,
        variantId: it.variantId ?? null,
        variantLabel: it.variantLabel ?? null,
        quantity: it.quantity,
        desiredUnitPrice: it.desiredUnitPrice != null ? Number(it.desiredUnitPrice) : null,
        agreedUnitPrice: it.agreedUnitPrice != null ? Number(it.agreedUnitPrice) : null,
        lineNote: it.lineNote ?? null,
        lineCurrency: it.lineCurrency,
        discountPercent: it.discountPercent != null ? Number(it.discountPercent) : null,
        taxRate,
      })),
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actorAdminUserId: includeFullActorIdentity ? e.actorAdminUserId ?? null : null,
        actorCustomerAccountId: e.actorCustomerAccountId ?? null,
        actorRoleLabel: e.actorRoleLabel ?? null,
        payload: e.payload,
        revisionId: e.revisionId ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
      comparisonAgainstLastSeen: comparison,
      submittedAt: rfq.submittedAt?.toISOString() ?? null,
      approvedAt: rfq.approvedAt?.toISOString() ?? null,
      canceledAt: rfq.canceledAt?.toISOString() ?? null,
      completedAt: rfq.completedAt?.toISOString() ?? null,
      expiredAt: rfq.expiredAt?.toISOString() ?? null,
      expiresAt: rfq.expiresAt?.toISOString() ?? null,
      convertedOrderId: rfq.convertedOrderId ?? null,
      taxRate,
      createdAt: rfq.createdAt.toISOString(),
      updatedAt: rfq.updatedAt.toISOString(),
      version: rfq.version,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function anyLocaleValue(blob: Record<string, string>): string {
  const k = Object.keys(blob)[0];
  return k ? (blob[k] ?? '') : '';
}

function customerDisplayName(c: CustomerAccount): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email;
}

function summarize(
  rfq: QuoteRequest,
  items: QuoteRequestItem[],
  extras: { requesterDisplayName?: string | null; taxRate?: number },
): QuoteRequestSummary {
  const totalAtCustomerPrice = items.reduce((sum, it) => {
    const desired = it.desiredUnitPrice != null ? Number(it.desiredUnitPrice) : null;
    return desired != null ? sum + desired * it.quantity : sum;
  }, 0);
  const totalAtAgreedPrice = items.every((it) => it.agreedUnitPrice != null)
    ? items.reduce((sum, it) => sum + Number(it.agreedUnitPrice ?? 0) * it.quantity, 0)
    : null;
  const currency = items[0]?.lineCurrency ?? 'PLN';
  return {
    id: rfq.id,
    businessId: rfq.businessId,
    organizationId: rfq.organizationId,
    customerAccountId: rfq.customerAccountId,
    status: rfq.status,
    awaitingCustomerRevisionAcceptance: rfq.awaitingCustomerRevisionAcceptance,
    lineCount: items.length,
    totalAtCustomerPrice: items.length > 0 ? totalAtCustomerPrice : null,
    totalAtAgreedPrice,
    taxRate: extras.taxRate ?? 0,
    currency,
    submittedAt: rfq.submittedAt?.toISOString() ?? null,
    expiresAt: rfq.expiresAt?.toISOString() ?? null,
    createdAt: rfq.createdAt.toISOString(),
    updatedAt: rfq.updatedAt.toISOString(),
    version: rfq.version,
    originalRequester: {
      customerAccountId: rfq.customerAccountId,
      displayName: extras.requesterDisplayName ?? null,
    },
  };
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
