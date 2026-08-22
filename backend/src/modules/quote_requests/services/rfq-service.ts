import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  isProductVisibleTo,
  type ProductAudience,
  type QuoteRequest as RfqDto,
  type QuoteRequestSummary,
  type CreateQuoteRequest,
  type PatchQuoteRequest,
  type ResubmitQuoteRequest,
  type RfqComparisonAgainstLastSeen,
  type AdminUserReadPort,
  type CartWritePort,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type SalesRepAssignmentPort,
} from '@b2b/contracts';
import type { EventBase, EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import { QuoteRequest, type QuoteRequestStatus } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import {
  QuoteRequestEvent,
  type QuoteRequestEventType,
} from '../entities/quote-request-event.entity.js';
import type { QuoteRequestRevisionLine } from '../entities/quote-request-revision.entity.js';
import type { RfqEventService } from './rfq-event-service.js';
import type { RfqRevisionService } from './rfq-revision-service.js';
import type { RfqNotificationService} from './rfq-notification-service.js';
import { type NotificationRecipient } from './rfq-notification-service.js';
import type { QuoteRequestBusinessIdGenerator } from './quote-request-business-id-generator.js';
import type { SalesChannelMembershipPort } from '../../../kernel/ports/sales-channel.js';
import { productIdsInRequestChannel } from '../../../kernel/sales-channels/request-channel-assortment.js';
import { raisedOnChannelId } from './raised-on-channel.js';

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
  salesRepAssignment: SalesRepAssignmentPort;
  /**
   * Feature 075, Phase C — the four rows this service reads and none of which
   * it owns, plus the one it writes.
   *
   * Every one of them was an `em.find` / `em.create` against another module's
   * table, which is the shape Principle XVII cannot gate: deactivation drops no
   * tables, so a quote kept resolving product names, requester identities and
   * admin recipients — and kept seeding a cart — out of modules an operator had
   * switched off. All four owners are binding `dependencies` of this manifest
   * and every read fails closed; a quote priced against a catalogue the
   * platform is not serving is worse than a refused quote.
   *
   * `carts` is the write, and it is the one that mattered most:
   * `convertToOrder` created a `Cart` and hand-built `CartItem` rows, with the
   * clear-then-seed rule spelled out here and `lastActivityAt` maintained
   * nowhere. `replaceItemsForCustomer` is the port `carts` published for
   * exactly this — its own doc comment names this call site — so the operation
   * is owned end to end by the module that owns the tables (D-78 rule 1).
   */
  catalogProducts: CatalogProductReadPort;
  /**
   * The sanctioned bridge accessor (Constitution XII), for the assortment gate
   * a quote line owes (issue #259). A kernel registration rather than a
   * module's, so it is not one of the four edges the block above declares.
   */
  channelMembership: SalesChannelMembershipPort;
  customerAccounts: CustomerAccountReadPort;
  adminUsers: AdminUserReadPort;
  carts: CartWritePort;
  /**
   * Generates the customer-facing business Quote Request ID. Optional so
   * legacy/test compositions that don't wire it fall back to the entity's
   * placeholder default.
   */
  businessId?: QuoteRequestBusinessIdGenerator;
  /**
   * Resolves the VAT rate (fraction, e.g. `0.23`) applied to the quote's net
   * prices for the given Organization. Mirrors the Orders flow.
   *
   * Required since issue #124 — see `QuoteRequestsModuleOptions.resolveTaxRate`.
   */
  resolveTaxRate: (organizationId: string) => Promise<number>;
  /** Feature 054 — audits RFQ writes co-transactionally when provided. */
  auditLog?: AuditPort;
}

export class RfqService {
  constructor(private readonly deps: RfqServiceDeps) {}

  /**
   * The products a quote line may name, keyed by id — the two scoping axes a
   * buyer-facing product read owes, applied together.
   *
   * `isProductVisibleTo` is issue #227's: may this buyer see the row at all.
   * The channel narrowing is issue #259's, and the predicate says in writing
   * that it is *not* that answer — the channel belongs to the request, so it is
   * read off the request scope (the same slot `raisedOnChannelId` stamps on the
   * quote) and never re-resolved here. `null` from the narrowing means there is
   * no request at all — a worker, a CLI script, a fixture calling this service
   * directly — and then there is no channel for a line to be outside of.
   *
   * The admin's own create path is `RfqAdminService.createOnBehalf` and does
   * not come through here. It applies neither axis, deliberately and as issue
   * #227 left it: the operator is naming both the organisation and the lines,
   * and the `quote_requests:write` permission is the enforcement.
   *
   * Both callers compare `size` against the requested set and answer one 404
   * for any shortfall, so a line that is restricted, a line sold on another
   * channel and a line naming a product that never existed are one response.
   */
  async #acquirableProductsById(
    productIds: readonly string[],
    ctx: CustomerContext,
  ): Promise<Map<string, CatalogProductRecord>> {
    const visible = (await this.deps.catalogProducts.findByIds(productIds)).filter((p) =>
      isProductVisibleTo(p, rfqAudience(ctx)),
    );
    const publishedHere = await productIdsInRequestChannel(
      this.deps.channelMembership,
      visible.map((p) => p.id),
    );
    const acquirable = publishedHere ? visible.filter((p) => publishedHere.has(p.id)) : visible;
    return new Map(acquirable.map((p) => [p.id, p]));
  }

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
   * Resolves the VAT rate applied to a quote's net prices for an Organization.
   *
   * No unwired branch (issue #124): the resolver is required, and an absent
   * `taxes` module surfaces through it as `MODULE_DISABLED` rather than as a
   * quote silently priced at 0% VAT.
   */
  async taxRateForOrganization(organizationId: string): Promise<number> {
    return this.deps.resolveTaxRate(organizationId);
  }

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  async listForCustomer(ctx: CustomerContext): Promise<QuoteRequestSummary[]> {
    const em = this.deps.emFactory();
    // Feature 056 (T032) — an Organization Admin sees "their org(s)"; the org
    // predicate is enforced by the always-on tenant filter (single-org, or the
    // SUBTREE for a roll-up-enabled head-office login), so we do not pin
    // `ctx.organizationId` here. A regular user still sees only their own RFQs.
    const where = ctx.isOrgAdmin ? {} : { customerAccountId: ctx.customerAccountId };
    const rfqs = await em.find(QuoteRequest, where, { orderBy: { createdAt: 'desc' } });
    if (rfqs.length === 0) return [];

    const items = await em.find(QuoteRequestItem, {
      quoteRequestId: { $in: rfqs.map((r) => r.id) },
    });
    const itemsByRfq = groupBy(items, (i) => i.quoteRequestId);

    const requesterIds = [...new Set(rfqs.map((r) => r.customerAccountId))];
    const requesters = await this.deps.customerAccounts.findByIds(requesterIds);
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
    const productById = await this.#acquirableProductsById(
      input.items.map((it) => it.productId),
      ctx,
    );
    if (productById.size !== new Set(input.items.map((it) => it.productId)).size) {
      // Issues #227 and #259 — a line the buyer may not see, and a line the
      // request's channel does not publish, are both refused the same way a
      // line naming a product that does not exist is. One message for all
      // three, so the response cannot be used to tell them apart.
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'One or more products do not exist.');
    }

    const businessId = await this.generateBusinessId(em);
    const rfq = em.create(QuoteRequest, {
      ...(businessId ? { businessId } : {}),
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
      salesChannelId: raisedOnChannelId(),
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
      salesChannelId: rfq.salesChannelId ?? null,
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
      const productById = await this.#acquirableProductsById(
        body.items.map((it) => it.productId),
        ctx,
      );
      if (productById.size !== new Set(body.items.map((it) => it.productId)).size) {
        // Issues #227 and #259 — see `createForCustomer`. A revision may not
        // add a line the original submission could not have carried, on either
        // axis.
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

    // Issue #259 — a resubmit is raised on *this* request's channel, not the
    // source RFQ's (see `salesChannelId` below), so without this it is the
    // one-hop bypass of every other seam on this list: raise a quote on the
    // channel that publishes the product, resubmit it with another channel's
    // header, and the line arrives in a pipeline that does not sell it. Copying
    // the lines is what makes it invisible — nothing here names a product id
    // the caller supplied.
    //
    // Whole-request 404, the same answer `createForCustomer` gives, because a
    // resubmit *is* a create over lines the buyer already chose.
    const publishedHere = await productIdsInRequestChannel(
      this.deps.channelMembership,
      sourceItems.map((it) => it.productId),
    );
    if (publishedHere && sourceItems.some((it) => !publishedHere.has(it.productId))) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'One or more products do not exist.');
    }

    const newRfq = em.create(QuoteRequest, {
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
      // The resubmit is its own request, so it is raised on the channel *this*
      // request resolved to — not the one the source RFQ carries. A buyer who
      // asks again from a different storefront asked from there.
      salesChannelId: raisedOnChannelId(),
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
      salesChannelId: newRfq.salesChannelId ?? null,
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
    //
    // **No sales-channel filter here, by an owner ruling of 2026-08-21**
    // (issue #259) — a decision, not the seam that was missed. The other three
    // write paths in this service grew one in that issue and this one did not,
    // for two reasons:
    //
    //  1. A conversion names **no product the caller supplied**. It re-acquires
    //     the lines of a quote an operator *approved*, at the unit prices they
    //     agreed — a commitment the seller has already made. `createForCustomer`
    //     and `patchDraft` filter because they take ids from the buyer;
    //     `resubmit` filters because it raises a **new** quote on the current
    //     request's channel. This raises nothing: it hands the agreed lines to
    //     `carts.replaceItemsForCustomer`.
    //  2. Refusing would strand the buyer. An approved quote they cannot act on
    //     is worse than one converted on a storefront that does not list the
    //     line, and the only channel this operation could honestly be judged
    //     against is the one the quote was raised on (`rfq.salesChannelId`),
    //     which the buyer has no way to switch back to from here.
    //
    // The sibling ruling covers `orders`' reorder, which re-acquires a placed
    // order's lines through the same port; its comment carries the second-order
    // consequence that makes the obvious fix wrong there.
    const productIds = items.map((it) => it.productId);
    const products = await this.deps.catalogProducts.findByIds(productIds);
    if (products.length !== new Set(productIds).size) {
      throw new HttpError(
        409,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        'One or more Quote Request line products are no longer available.',
      );
    }

    // Get-or-create the customer's active cart, clear it, and reseed at the
    // RFQ's agreed unit prices. The orders module copies `CartItem.unitPrice`
    // straight onto `OrderItem.unitPrice` (no recomputation), so the negotiated
    // price flows through unchanged.
    //
    // Feature 075, Phase C — one port call where this module used to create a
    // `Cart` and hand-build `CartItem` rows in `carts`' tables. The
    // clear-then-seed rule and the `lastActivityAt` bookkeeping now live once,
    // inside the module that owns them; `carts` published
    // `replaceItemsForCustomer` naming this call site.
    const seeded = await this.deps.carts.replaceItemsForCustomer(
      {
        customerAccountId: ctx.customerAccountId,
        organizationId: ctx.organizationId,
      },
      items.map((it) => ({
        productId: it.productId,
        ...(it.variantId ? { variantId: it.variantId } : {}),
        quantity: it.quantity,
        unitPrice: (it.agreedUnitPrice ?? '0').toString(),
        currency: it.lineCurrency,
      })),
    );
    const cartId = seeded.cart.id;
    this.#audit(em, 'quote_request.convert_to_order', rfq.id, null, {
      cartId,
      itemCount: seeded.items.length,
    });
    await em.flush();

    return {
      cartId,
      checkoutUrl: `/checkout?cartId=${cartId}&fromRfq=${rfq.id}`,
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
    // Find every admin user assigned to the org. If the org is unassigned,
    // fan out to every active admin user holding the sales_representative
    // role plus every platform_admin (research §R4).
    //
    // Feature 075, Phase C — this asked the question twice: an `em.count` on
    // `organizations`' assignment entity, reached through a dynamic `import()`
    // with a comment apologising for it, and then the port. The count was a
    // duplicate of `listForOrganization(…).length`, and its `.catch(() => 0)`
    // silently answered "unassigned" — a fan-out to every admin — for any
    // failure at all, `MODULE_DISABLED` included. One port call, no catch, and
    // an absent `organizations` now stops the notification instead of
    // broadcasting it.
    const assignments = await this.deps.salesRepAssignment.listForOrganization(organizationId);

    const recipients: NotificationRecipient[] = [];
    if (assignments.length > 0) {
      for (const a of assignments) recipients.push({ adminUserId: a.adminUserId });
    } else {
      const everyAdmin = await this.deps.adminUsers.listAll();
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
      customFieldValues: rfq.customFieldValues ?? {},
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

function customerDisplayName(c: CustomerAccountRecord): string {
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

/**
 * The {@link ProductAudience} an RFQ line speaks for (issue #227).
 *
 * A quote request is always a signed-in buyer's, and its `organizationId` is
 * the one the RFQ is filed under — so it is also the one the product's
 * allow-list has to name.
 */
function rfqAudience(ctx: CustomerContext): ProductAudience {
  return { organizationId: ctx.organizationId, authenticated: true };
}
