import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  type CustomFieldValuePort,
  ERROR_CODES,
  isProductVisibleTo,
  pickLocalized,
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
  type CatalogPackagingUnitRecord,
  type CatalogProductRecord,
  type CreateQuoteRequestLine,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type SalesRepAssignmentPort,
  type BuyerLinePricePort,
  type CreateForCustomerOptions,
  type OrderMinimumLine,
} from '@endora-commerce/contracts';
import type { EventBase, EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort, PlatformLogger } from '@endora-commerce/platform/kernel';
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
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { productIdsInRequestChannel } from '@endora-commerce/platform/kernel';
import { raisedOnChannelId } from './raised-on-channel.js';
import { hasUnpricedLine, quoteIncompleteError, unitPriceText } from './agreed-price.js';
import { underRowLock } from './transition-lock.js';
import { summarize } from './summarize.js';
import {
  assertValidSuppliedReferences,
  referenceColumns,
  resolveReferencePrices,
  storedReferenceColumns,
  type ReferenceColumns,
} from './reference-price.js';
import { carriedProposal, pairLines } from './line-carry-over.js';
import { LINE_STORAGE_ORDER, loadArrangedQuoteLines, nonEmptyGroups, toLineGroup } from './line-order.js';
import { planLineGrouping, type PlannedLineGroup } from './line-grouping.js';
import type { NegotiationPolicyService } from './negotiation-policy-service.js';
import {
  CUSTOMER_EVENT_KEYS,
  CUSTOMER_ITEM_KEYS,
  customerEventPayload,
  customerEventsOf,
  pickKeys,
} from './customer-projection.js';
import { assertDraftOpenForCustomer, submissionRecordProposals } from './draft-guard.js';
import {
  carriesPackagingReference,
  packagingMismatchError,
  resolveLinePackaging,
  type ResolvedPackaging,
} from './packaging-resolution.js';
import {
  assertQuoteMeetsMinimums,
  draftEditExemptions,
  quoteMinimumLines,
  quoteMinimumWarnings,
  resubmitMinimumLines,
  type QuoteLineMinimumWarning,
} from './quote-minimums.js';

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
   * Narrows a quote's custom-field values to the ones a customer may read
   * (`custom_fields`' `projectForCustomer`). Absent — the port is not wired —
   * means the customer-facing reply carries none of them.
   */
  customFieldValues?: Pick<CustomFieldValuePort, 'projectForCustomer'>;
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
   * Feature 146 — `price_lists`' answer to "what would this buyer pay for these
   * lines on this channel, now", asked at every customer write for the
   * request's owner and stored as each line's reference (FR-001). A binding
   * `dependencies` entry of this manifest; a failure other than the owner being
   * off is tolerated in `reference-price.ts` (research R2).
   */
  buyerLinePrices: BuyerLinePricePort;
  /**
   * Feature 146, US4 — the price-negotiation lock of the request's **owner**
   * (FR-022, FR-037; research R11). Asked on create and draft edit only; a body
   * with no proposal reads nothing.
   */
  negotiationPolicy: Pick<NegotiationPolicyService, 'assertProposalsAllowed' | 'precheckProposalsAllowed'>;
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
  /**
   * Feature 155 (threat F6) — where the server-side cause of an `unknown_unit`
   * refusal goes; the buyer's answer never carries it. Absent: not logged.
   */
  log?: PlatformLogger;
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

  /**
   * Feature 155 (FR-026, R13.1) — resolves each line's packaging against the
   * catalogue, or refuses the whole write with `422 PACKAGING_UNIT_MISMATCH`.
   *
   * Runs after the product 404, so every product here passed
   * `#acquirableProductsById`, and the units are read only for those vetted ids
   * — and only for the lines that name a unit at all (threat F12). Which of an
   * unknown, a deleted or another product's unit an `unknown_unit` was goes to
   * the log, never to the buyer (threat F6).
   */
  async #resolvePackaging(
    lines: readonly CreateQuoteRequestLine[],
    productById: ReadonlyMap<string, CatalogProductRecord>,
    language: string | undefined,
  ): Promise<{ packaging: ResolvedPackaging[]; units: CatalogPackagingUnitRecord[] }> {
    const vettedIds = Array.from(
      new Set(lines.filter(carriesPackagingReference).map((line) => line.productId)),
    ).filter((id) => productById.has(id));
    const units =
      vettedIds.length > 0 ? await this.deps.catalogProducts.listPackagingUnitsByProductIds(vettedIds) : [];
    const { lines: packaging, mismatches } = resolveLinePackaging(lines, units);
    if (mismatches.length > 0) {
      const causes = mismatches.filter((m) => m.cause !== undefined);
      if (causes.length > 0) {
        this.deps.log?.info(
          { lines: causes.map((m) => ({ index: m.index, productId: m.productId, cause: m.cause })) },
          'quote_requests: a packaging unit id did not resolve on a buyer write',
        );
      }
      throw packagingMismatchError(mismatches, productNames(productById.values(), language));
    }
    return { packaging, units };
  }

  /**
   * Feature 155 (FR-012, FR-029) — the minimum check of a buyer's write, after
   * the packaging resolution and before any reference price is resolved or
   * anything is written. `'warn'` is set only by an in-process caller acting
   * for a representative (`CreateForCustomerOptions.minimums`).
   */
  #assertMinimums(
    lines: readonly OrderMinimumLine[],
    products: Iterable<CatalogProductRecord>,
    packagingUnits: readonly CatalogPackagingUnitRecord[],
    mode: 'enforce' | 'warn',
    language: string | undefined,
  ): void {
    const records = Array.from(products);
    assertQuoteMeetsMinimums(lines, { products: records, packagingUnits }, productNames(records, language), mode);
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

  async createForCustomer(
    ctx: CustomerContext,
    input: CreateQuoteRequest,
    options: CreateForCustomerOptions = {},
  ): Promise<RfqDto> {
    if (input.items.length === 0) {
      throw new HttpError(400, ERROR_CODES.RFQ_EMPTY, 'Quote Request must have at least one line item.');
    }
    // Threat model T6 — an in-process caller's references are checked before
    // anything is read or written, so a malformed one writes nothing.
    if (options.lineReferencePrices) {
      assertValidSuppliedReferences(options.lineReferencePrices, input.items.length);
    }
    const em = this.deps.emFactory();
    // FR-022 / FR-037 — the acting customer is the owner of what they create.
    // After the body is validated and before anything is priced, numbered or
    // persisted, so a refusal writes nothing and draws no business id (T4).
    await this.deps.negotiationPolicy.assertProposalsAllowed(ctx.customerAccountId, input.items, em);
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

    // Feature 155 (FR-026, FR-012, FR-029) — packaging, then minimums, after
    // the 404 above and before anything is priced, numbered or written.
    const { packaging, units } = await this.#resolvePackaging(input.items, productById, options.language);
    const resolvedLines = input.items.map((line, index) => withResolvedPackaging(line, packaging[index]!));
    this.#assertMinimums(
      quoteMinimumLines(resolvedLines),
      productById.values(),
      units,
      options.minimums ?? 'enforce',
      options.language,
    );

    // FR-001 / FR-008 — each line's reference, for the request's owner on the
    // channel it is raised on; a cart conversion supplies its own snapshot.
    // Resolved before any write: a pricing failure leaves no reference and
    // never blocks the request (research R2).
    const salesChannelId = raisedOnChannelId();
    const references = await resolveReferencePrices(this.deps.buyerLinePrices, {
      owner: { customerAccountId: ctx.customerAccountId, organizationId: ctx.organizationId },
      salesChannelId,
      lines: input.items,
      ...(options.lineReferencePrices ? { supplied: options.lineReferencePrices } : {}),
    });
    const capturedAt = new Date();

    const businessId = await this.generateBusinessId(em);
    const rfq = em.create(QuoteRequest, {
      ...(businessId ? { businessId } : {}),
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
      salesChannelId,
      status: 'Pending' satisfies QuoteRequestStatus,
      headerNote: input.headerNote ?? null,
      submittedAt: new Date(),
      currentRevisionNumber: 1,
      lastCustomerSeenRevisionNumber: 1,
    });
    await em.persistAndFlush(rfq);

    const items: QuoteRequestItem[] = [];
    for (const [index, lineInput] of input.items.entries()) {
      const product = productById.get(lineInput.productId)!;
      const unit = packaging[index]!;
      // Feature 043 — append the packaging-unit name to the snapshot name so
      // RFQ views show "<name> (Paleta)", and persist the structured snapshot.
      // Feature 155 (FR-026) — the name and base quantity are the catalogue
      // unit's, beside its id; a line naming no unit stores plain pieces.
      const baseName = anyLocaleValue(product.name);
      const productName = unit.packagingUnitName ? `${baseName} (${unit.packagingUnitName})` : baseName;
      const item = em.create(QuoteRequestItem, {
        quoteRequestId: rfq.id,
        productId: product.id,
        productName,
        productSlug: product.slug,
        variantId: lineInput.variantId ?? null,
        quantity: lineInput.quantity,
        packagingUnitId: unit.packagingUnitId,
        packagingUnitName: unit.packagingUnitName,
        packagingUnitBaseQuantity: unit.packagingUnitBaseQuantity,
        desiredUnitPrice:
          lineInput.desiredUnitPrice !== undefined ? unitPriceText(lineInput.desiredUnitPrice) : null,
        lineNote: lineInput.lineNote ?? null,
        lineCurrency: 'PLN',
        ...referenceColumns(references[index] ?? null, capturedAt),
        // Feature 159 — the request's order, stored (ungrouped: one section).
        position: index,
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
    /** The language a refusal names a product in (feature 155, D3/D4). */
    options: { language?: string | undefined } = {},
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForCustomer(em, rfqId, ctx);
    if (rfq.status !== 'Pending') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_DRAFT, 'Quote Request is not editable.');
    }

    // FR-038 / research R15 — a cheap refusal before anything else is read;
    // repeated inside the row lock below, which is the check that counts.
    await assertDraftOpenForCustomer(em, rfq.id, rfq.awaitingCustomerRevisionAcceptance);

    if (expectedVersion !== null && rfq.version !== expectedVersion) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Quote Request was updated concurrently.');
    }

    // FR-022 — a cheap refusal before the line rewrite is priced, so a refused
    // edit costs no call into `price_lists`. A display-style read in the
    // caller's scope, so it writes no escape-hatch row; repeated, authoritative
    // and audited, inside the row lock below, which is the check that counts.
    await this.deps.negotiationPolicy.precheckProposalsAllowed(rfq.customerAccountId, body.items, em);

    // Everything the line rewrite needs is read and priced before the row is
    // taken: the reference is a call into `price_lists`, and the lock is held
    // for the row's own write only. What was read here is what is rewritten —
    // every write to a request bumps its `version`, and `underRowLock` refuses
    // the change if the version it locks is not the one read here.
    let rewrite: { existing: QuoteRequestItem[]; lines: QuoteRequestItemDraft[] } | null = null;
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
      // Feature 159 — in display order (the order the buyer saw), with the
      // stored groups a paired line keeps (R-13).
      const { lines: existing, groups: storedGroups } = await loadArrangedQuoteLines(em, rfq.id);
      // Feature 155 (FR-026) — packaging resolved against the catalogue
      // before the pairing, which reads the **resolved** name: a line naming
      // its unit by id alone pairs with the stored row of that unit.
      const { packaging, units } = await this.#resolvePackaging(body.items, productById, options.language);
      const resolvedLines = body.items.map((line, index) => withResolvedPackaging(line, packaging[index]!));

      // Research R5.3 — pair by product, variant, packaging name, position.
      const { paired } = pairLines(existing, resolvedLines, 'customer');

      // A paired line whose product, variant, quantity and packaging unit are
      // unchanged keeps its stored reference; every other line is priced
      // afresh — for the request's **owner**, on the channel it was raised on,
      // never for the acting user (an organization administrator editing a
      // colleague's draft prices it as the colleague would pay).
      //
      // Feature 155 (FR-031 (b)) — the same predicate exempts the line from the
      // minimums: an unchanged line is not refused, and still counts toward its
      // product's total. Judged before pricing (FR-029).
      const keeps = draftEditExemptions(paired, resolvedLines);
      this.#assertMinimums(
        quoteMinimumLines(resolvedLines, keeps),
        productById.values(),
        units,
        'enforce',
        options.language,
      );
      const toResolve = resolvedLines.filter((_, index) => !keeps[index]);
      const resolved = await resolveReferencePrices(this.deps.buyerLinePrices, {
        owner: { customerAccountId: rfq.customerAccountId, organizationId: rfq.organizationId },
        salesChannelId: rfq.salesChannelId ?? null,
        lines: toResolve,
      });
      const capturedAt = new Date();
      let next = 0;
      const references: ReferenceColumns[] = body.items.map((_, index) =>
        keeps[index]
          ? storedReferenceColumns(paired[index]!)
          : referenceColumns(resolved[next++] ?? null, capturedAt),
      );

      // Feature 159 (R-13, FR-025) — a customer body carries no grouping: a
      // paired line keeps its group, a new line is ungrouped, no group changes;
      // positions follow the body order within each section.
      const grouping = planLineGrouping({ storedGroups, body: { items: body.items.map(() => ({})) }, pairedRows: paired });
      const lines = body.items.map((lineInput, index): QuoteRequestItemDraft => {
        const product = productById.get(lineInput.productId)!;
        const row = paired[index] ?? null;
        const unit = packaging[index]!;
        // FR-035 — packaging stored with the name suffix `createForCustomer`
        // writes; feature 155 (FR-026) — the catalogue unit's, beside its id.
        const baseName = anyLocaleValue(product.name);
        return {
          quoteRequestId: rfq.id,
          productId: product.id,
          productName: unit.packagingUnitName ? `${baseName} (${unit.packagingUnitName})` : baseName,
          productSlug: product.slug,
          variantId: lineInput.variantId ?? null,
          variantLabel:
            row !== null && (row.variantId ?? null) === (lineInput.variantId ?? null)
              ? (row.variantLabel ?? null)
              : null,
          quantity: lineInput.quantity,
          packagingUnitId: unit.packagingUnitId,
          packagingUnitName: unit.packagingUnitName,
          packagingUnitBaseQuantity: unit.packagingUnitBaseQuantity,
          // Threat model T5 — an omitted proposal on a paired line is kept.
          desiredUnitPrice: carriedProposal(lineInput.desiredUnitPrice, row),
          lineNote: lineInput.lineNote ?? null,
          lineCurrency: 'PLN',
          ...references[index]!,
          groupId: plannedGroupId(grouping.lines[index]!.group),
          position: grouping.lines[index]!.position,
        };
      });
      rewrite = { existing, lines };
    }

    await underRowLock(em, rfq, async () => {
      // Threat model T3 — the version check passed, so this is the row that was
      // read; but an admin `modify` commits its revision and lines before it
      // appends its event, so the guard is asked again, of what is committed
      // now, while the row is held.
      const [current] = await em.execute<Array<{ awaiting: boolean }>>(
        `select "awaiting_customer_revision_acceptance" as "awaiting" from "quote_requests" where "id" = ?`,
        [rfq.id],
      );
      await assertDraftOpenForCustomer(em, rfq.id, current?.awaiting === true);

      // FR-022 / FR-037 — the lock of the request's **owner**, not of whoever
      // is editing (an organization administrator editing a colleague's draft
      // is held to the colleague's value). Asked of the body as sent: the
      // rewrite's lines also carry the stored proposals an edit omits (T5),
      // which are not a proposal being made. Inside the row lock, after the
      // version and guard checks and before any line is written (T4).
      await this.deps.negotiationPolicy.assertProposalsAllowed(rfq.customerAccountId, body.items, em);

      if (body.headerNote !== undefined) rfq.headerNote = body.headerNote ?? null;

      if (rewrite) {
        await em.removeAndFlush(rewrite.existing);
        const items = rewrite.lines.map((line) => em.create(QuoteRequestItem, line));
        await em.persistAndFlush(items);
      }

      rfq.currentRevisionNumber += 1;
      rfq.lastCustomerSeenRevisionNumber = rfq.currentRevisionNumber;
      rfq.version += 1;
      this.#audit(em, 'quote_request.patch_draft', rfq.id, null, {
        currentRevisionNumber: rfq.currentRevisionNumber,
      });
      await em.flush();
    });

    // Feature 159 — the revision records the lines in display order.
    const items = (await loadArrangedQuoteLines(em, rfq.id)).lines;
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
    /** The language a refusal names a product in (feature 155, D3/D4). */
    options: { language?: string | undefined } = {},
  ): Promise<RfqDto> {
    const em = this.deps.emFactory();
    const sourceRfq = await this.findVisibleForCustomer(em, rfqId, ctx);

    // Feature 159 — copied in the order the buyer saw them; no group is copied (FR-026).
    const sourceItems = (await loadArrangedQuoteLines(em, sourceRfq.id)).lines;
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

    // Feature 155 (FR-031 (c), FR-029) — judged as a new submission, before
    // pricing: pieces only (no packaging is copied below), no exemption. The
    // records are those of the buyer's own request's products; a product with
    // no record is the unknown-product 404 (FR-037).
    const sourceProducts = await this.deps.catalogProducts.findByIds(
      Array.from(new Set(sourceItems.map((it) => it.productId))),
    );
    this.#assertMinimums(resubmitMinimumLines(sourceItems), sourceProducts, [], 'enforce', options.language);

    // The resubmit is its own request, so it is raised on the channel *this*
    // request resolved to — not the one the source RFQ carries. A buyer who
    // asks again from a different storefront asked from there. Its references
    // are resolved afresh on that channel, for the caller, who is its owner
    // (FR-001; spec Assumptions).
    const salesChannelId = raisedOnChannelId();
    const references = await resolveReferencePrices(this.deps.buyerLinePrices, {
      owner: { customerAccountId: ctx.customerAccountId, organizationId: ctx.organizationId },
      salesChannelId,
      lines: sourceItems,
    });
    const capturedAt = new Date();

    const newRfq = em.create(QuoteRequest, {
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
      salesChannelId,
      status: 'Pending' satisfies QuoteRequestStatus,
      headerNote: body.headerNote ?? null,
      submittedAt: new Date(),
      currentRevisionNumber: 1,
      lastCustomerSeenRevisionNumber: 1,
    });
    await em.persistAndFlush(newRfq);

    const newItems: QuoteRequestItem[] = sourceItems.map((src, index) =>
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
        ...referenceColumns(references[index] ?? null, capturedAt),
        // Feature 159 — the order the buyer was shown, ungrouped (FR-026).
        position: index,
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
    // Accepting is the buyer's answer to an offer, so there has to be one.
    // A request the buyer raised sits in `Pending` from the moment it is
    // submitted, and the status alone does not say whether the seller has
    // answered it — see `sellerHasOffered`.
    //
    // **Only the accept half**, for the reason the deadline below gives:
    // declining commits nobody to a price, and it is how a buyer withdraws a
    // request nobody has answered yet.
    if (decision === 'accept' && !sellerHasOffered(rfq)) {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request is not awaiting your decision.');
    }
    // The offer the operator dated stops being acceptable on the date both
    // parties were shown — restored 2026-08-29, see `validityHasLapsed`.
    //
    // **Only the accept half.** Declining a lapsed offer consumes no price the
    // seller committed to, and refusing it would leave the buyer no way to
    // clear a row they have already been told is dead. Their other way forward,
    // `resubmit`, raises a new request at current prices and copies no
    // deadline; neither is reached by this rule.
    //
    // Ahead of the revision-number CAS deliberately: once the deadline has
    // passed, answering `VERSION_CONFLICT` — "refresh and try again" — would
    // send the buyer round a loop that has no way out.
    if (decision === 'accept' && validityHasLapsed(rfq, Date.now())) {
      throw new HttpError(
        410,
        ERROR_CODES.RFQ_EXPIRED,
        'This quote is no longer valid — its validity period has ended.',
      );
    }
    if (rfq.currentRevisionNumber !== expectedRevisionNumber) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        'Quote Request was revised again — refresh and try again.',
      );
    }
    // An offer is acceptable once it is a price for every line. An operator's
    // revision does not have to carry one — `modify` accepts a note alone, and
    // a line with `agreedUnitPrice: null` — and accepting it would approve a
    // request nobody can order from. After the revision pin, so the buyer is
    // judged on the revision they are looking at.
    if (decision === 'accept') {
      const lines = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id }, { orderBy: LINE_STORAGE_ORDER });
      if (hasUnpricedLine(lines)) throw quoteIncompleteError();
    }

    const now = new Date();
    await underRowLock(em, rfq, async () => {
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
    });

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

  /**
   * Seed the customer's basket on `salesChannelId` — the channel of the
   * caller's request — with the approved quote's agreed lines. A customer holds
   * one basket per channel (`specs/154-sales-channel-access/`), so the basket
   * seeded is the one of the store the buyer converts on and goes to checkout
   * from.
   */
  async convertToOrder(
    rfqId: string,
    ctx: CustomerContext,
    salesChannelId: string,
  ): Promise<{ cartId: string; checkoutUrl: string }> {
    const em = this.deps.emFactory();
    const rfq = await this.findVisibleForCustomer(em, rfqId, ctx);
    const seeded = await this.seedBasketFromApproved(em, rfq, {
      customerAccountId: ctx.customerAccountId,
      organizationId: ctx.organizationId,
      salesChannelId,
    });
    const cartId = seeded.cartId;
    this.#audit(em, 'quote_request.convert_to_order', rfq.id, null, {
      cartId,
      itemCount: seeded.itemCount,
    });
    await em.flush();

    return {
      cartId,
      checkoutUrl: `/checkout?cartId=${cartId}&fromRfq=${rfq.id}`,
    };
  }

  /**
   * Seed `owner`'s basket on `owner.salesChannelId` with an approved request's
   * lines at the agreed unit prices — the rules a conversion is held to, in one
   * place. The customer's own conversion calls it for the caller on the
   * channel they convert on; the admin's `prepareCustomerBasket` (issue #170)
   * for the customer who owns the request, on the channel it was raised on.
   * Records nothing itself: each caller audits its own action.
   */
  async seedBasketFromApproved(
    em: EntityManager,
    rfq: QuoteRequest,
    owner: { customerAccountId: string; organizationId: string; salesChannelId: string },
  ): Promise<{ cartId: string; itemCount: number }> {
    if (rfq.status !== 'Approved') {
      throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request is not approved.');
    }
    // The seller's price commitment is *consumed* here, not at acceptance:
    // this is the call that seeds a cart at `agreedUnitPrice`, which `orders`
    // then copies onto the order line without recomputing. So the deadline
    // binds here too, and this is the site that made "expires <date>" a
    // sentence with no consequence — an accepted quote is `Approved`, and the
    // expiry worker sweeps only `Pending` / `Created from admin`, so nothing
    // in the platform ever reached this row again.
    //
    // `QUOTE_VALIDITY_ENDED` rather than `RFQ_EXPIRED`: the buyer here already
    // made their decision inside the window and it is the *quote* that has run
    // out, which is a different sentence and a different remedy from an offer
    // that lapsed undecided. The split is
    // `specs/001-b2b-platform-foundation/contracts/quote_requests.contract.md`'s
    // own — `410 RFQ_EXPIRED` on accept, `410 QUOTE_VALIDITY_ENDED` on
    // convert — restored rather than invented.
    if (validityHasLapsed(rfq, Date.now())) {
      throw new HttpError(
        410,
        ERROR_CODES.QUOTE_VALIDITY_ENDED,
        'The accepted quote is no longer valid — its validity period has ended.',
      );
    }

    // Feature 159 — the basket is seeded in the quote's display order.
    const items = (await loadArrangedQuoteLines(em, rfq.id)).lines;
    if (items.length === 0) {
      throw new HttpError(409, ERROR_CODES.RFQ_EMPTY, 'Quote Request has no items.');
    }

    // The basket is seeded at the agreed unit price and at nothing else. A
    // line the seller never priced has no price to seed, so the conversion is
    // refused rather than given one: `orders` copies the basket's unit price
    // onto the order line without recomputing it, which makes this the last
    // place the question can be asked.
    //
    // Both routes into `Approved` already refuse an unpriced line. This is
    // the same rule held where the price is consumed, so it also covers a row
    // approved before they did and any route added after them.
    const lines = items.map((it) => {
      if (it.agreedUnitPrice == null) throw quoteIncompleteError();
      return {
        productId: it.productId,
        ...(it.variantId ? { variantId: it.variantId } : {}),
        quantity: it.quantity,
        unitPrice: it.agreedUnitPrice.toString(),
        currency: it.lineCurrency,
      };
    });

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
      owner,
      lines,
      // The basket remembers which request these prices were agreed on, and
      // `orders` copies that onto the order it places from it — after reading
      // this request again through `quoteRequestReadPort`. Without it the order
      // named no source, `order-completion-reactor.ts` never fired, and an
      // accepted quote stayed `Approved` and convertible for ever
      // (`specs/143-crm-sales-opportunities/`, FR-100).
      { sourceQuoteRequestId: rfq.id },
    );
    return { cartId: seeded.cart.id, itemCount: seeded.items.length };
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
   * `includeFullActorIdentity = true` (admin path).
   *
   * The same flag decides the custom-field values: the admin path answers
   * every stored value, the customer path only those whose definition has the
   * `customer` audience — an `internal` field's value, and one whose definition
   * is gone, are not answered to a customer. This is the one place the quote
   * surface applies that rule. */
  private customFieldValuesFor(
    rfq: QuoteRequest,
    forAdmin: boolean,
  ): Promise<Record<string, unknown>> {
    return quoteCustomFieldValuesFor(this.deps.customFieldValues, rfq.customFieldValues ?? {}, forAdmin);
  }

  /**
   * Feature 155 (FR-030, research R13.5) — each stored line's warning against
   * today's minimums: no exemption, product totals across the request. One
   * batched catalogue read of the products (no audience or channel filter —
   * this is the operator's view), and of the units only when a line names one.
   */
  async #minimumWarnings(
    items: readonly QuoteRequestItem[],
  ): Promise<Array<QuoteLineMinimumWarning | null>> {
    if (items.length === 0) return [];
    const productIds = Array.from(new Set(items.map((it) => it.productId)));
    const unitProductIds = Array.from(
      new Set(items.filter((it) => it.packagingUnitId != null).map((it) => it.productId)),
    );
    const [products, packagingUnits] = await Promise.all([
      this.deps.catalogProducts.findByIds(productIds),
      unitProductIds.length > 0
        ? this.deps.catalogProducts.listPackagingUnitsByProductIds(unitProductIds)
        : Promise.resolve([]),
    ]);
    return quoteMinimumWarnings(
      quoteMinimumLines(
        items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          packagingUnitId: it.packagingUnitId ?? null,
          packagingUnitBaseQuantity: it.packagingUnitBaseQuantity ?? null,
        })),
      ),
      { products, packagingUnits },
    );
  }

  async serializeFull(
    em: EntityManager,
    rfq: QuoteRequest,
    includeFullActorIdentity: boolean,
  ): Promise<RfqDto> {
    // Feature 159 (FR-011) — the lines in display order; this read had no
    // order at all before (research R-1).
    const arranged = await loadArrangedQuoteLines(em, rfq.id);
    const items = arranged.lines;
    const taxRate = await this.taxRateForOrganization(rfq.organizationId);
    const events = await em.find(
      QuoteRequestEvent,
      { quoteRequestId: rfq.id },
      { orderBy: { createdAt: 'asc' } },
    );
    const forAdmin = includeFullActorIdentity;
    const submittedProposals = forAdmin
      ? await submissionRecordProposals(em, items, events)
      : new Map<string, number | null>();
    // Feature 155 (FR-030) — computed for the admin reply only; the customer
    // path never reads the catalogue for it (threat S7).
    const minimumWarnings = forAdmin ? await this.#minimumWarnings(items) : [];

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
      // Administrator identifiers are the admin surface's to answer. A customer
      // reply carries none of them — not as `null` either: the key is absent.
      // Feature 146: so is the channel, which only the admin screen's
      // current-price probe reads.
      ...(includeFullActorIdentity
        ? {
            salesChannelId: rfq.salesChannelId ?? null,
            createdByAdminUserId: rfq.createdByAdminUserId ?? null,
            assignedAdminUserId: rfq.assignedAdminUserId ?? null,
          }
        : {}),
      status: rfq.status,
      awaitingCustomerRevisionAcceptance: rfq.awaitingCustomerRevisionAcceptance,
      currentRevisionNumber: rfq.currentRevisionNumber,
      lastCustomerSeenRevisionNumber: rfq.lastCustomerSeenRevisionNumber,
      headerNote: rfq.headerNote ?? null,
      cancellationReason: rfq.cancellationReason ?? null,
      customFieldValues: await this.customFieldValuesFor(rfq, includeFullActorIdentity),
      // Feature 159 — the admin editor needs every group, empty ones included;
      // a customer is shown only the groups holding a line (D2, FR-034).
      itemGroups: forAdmin ? arranged.groups.map(toLineGroup) : nonEmptyGroups(arranged),
      // Feature 146 (threat model T7): the customer reply is built from an
      // explicit allow-list of item, event and payload keys — a key added to
      // the admin projection, or one that reaches a stored payload, never
      // reaches the customer by default.
      items: items.map((it, index) => {
        const item = {
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
          packagingUnitName: it.packagingUnitName ?? null,
          packagingUnitBaseQuantity: it.packagingUnitBaseQuantity ?? null,
          // Feature 155 — the resolved catalogue unit; both replies (analyze F14).
          packagingUnitId: it.packagingUnitId ?? null,
          // Feature 159 — the line's group and its order within its section.
          groupId: it.groupId ?? null,
          position: it.position,
        };
        if (!forAdmin) return pickKeys(item, CUSTOMER_ITEM_KEYS);
        return {
          ...item,
          referencePrice:
            it.referenceUnitPrice != null && it.referenceCurrency != null && it.referenceCapturedAt != null
              ? {
                  amount: Number(it.referenceUnitPrice),
                  currency: it.referenceCurrency,
                  capturedAt: it.referenceCapturedAt.toISOString(),
                }
              : null,
          customerProposedUnitPrice:
            item.desiredUnitPrice ?? submittedProposals.get(it.id) ?? null,
          minimumWarning: minimumWarnings[index] ?? null,
        };
      }),
      events: (forAdmin ? events : customerEventsOf(events)).map((e) => {
        const event = {
          id: e.id,
          eventType: e.eventType,
          actorCustomerAccountId: e.actorCustomerAccountId ?? null,
          actorRoleLabel: e.actorRoleLabel ?? null,
          payload: e.payload,
          revisionId: e.revisionId ?? null,
          createdAt: e.createdAt.toISOString(),
        };
        if (forAdmin) return { ...event, actorAdminUserId: e.actorAdminUserId ?? null };
        return {
          ...pickKeys(event, CUSTOMER_EVENT_KEYS),
          payload: customerEventPayload(e.payload),
        };
      }),
      comparisonAgainstLastSeen: comparison,
      submittedAt: rfq.submittedAt?.toISOString() ?? null,
      approvedAt: rfq.approvedAt?.toISOString() ?? null,
      canceledAt: rfq.canceledAt?.toISOString() ?? null,
      completedAt: rfq.completedAt?.toISOString() ?? null,
      expiredAt: rfq.expiredAt?.toISOString() ?? null,
      expiresAt: rfq.expiresAt?.toISOString() ?? null,
      convertedOrderId: rfq.convertedOrderId ?? null,
      taxRate,
      // Feature 153 (owner answer Q2) — the remembered PDF template, admin
      // replies only; the customer reply carries no key.
      ...(includeFullActorIdentity ? { documentTemplateId: rfq.documentTemplateId ?? null } : {}),
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

/**
 * Feature 155 (D3/D4) — the names a refusal gives its products: in `language`,
 * the language the envelope translates the refusal's sentence into.
 */
function productNames(products: Iterable<CatalogProductRecord>, language: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const product of products) out.set(product.id, pickLocalized(product.name, language));
  return out;
}

/** A body line with its packaging replaced by the catalogue's resolution. */
function withResolvedPackaging(
  line: CreateQuoteRequestLine,
  packaging: ResolvedPackaging,
): {
  productId: string;
  variantId: string | null;
  quantity: number;
  packagingUnitId: string | null;
  packagingUnitName: string | null;
  packagingUnitBaseQuantity: number | null;
} {
  return {
    productId: line.productId,
    variantId: line.variantId ?? null,
    quantity: line.quantity,
    ...packaging,
  };
}

/**
 * Has the validity deadline an operator set on *this* request passed?
 *
 * `expiresAt` is written by `RfqAdminService.modify` / `createOnBehalf` from
 * the operator's `expiresInDays`, is serialised into the admin's `RfqDetail`
 * and into the storefront's types, and both parties are shown
 * `expires <date>`. Between the feature-008 workflow rewrite (`4f24dc948`,
 * which dropped the live check `accept()` carried) and its restoration on
 * 2026-08-29 it was read by no rule at all.
 *
 * **This is not the expiry worker's concept.** `RfqExpiryWorker` sweeps
 * `updatedAt` against a settings-wide `expiryDays` and flips `Pending` /
 * `Created from admin` rows to `Expired`; it never reads `expiresAt` and
 * never reaches `Approved`. The original comment called this the check that
 * "covers the window before the expiry worker runs" — for an approved quote
 * that window never closes, because no sweep reaches it.
 *
 * Absent means the operator set no deadline and answers `false`: the rule
 * binds a date somebody chose, never a default of this module's choosing.
 */
function validityHasLapsed(rfq: QuoteRequest, nowMs: number): boolean {
  return rfq.expiresAt != null && rfq.expiresAt.getTime() <= nowMs;
}

/**
 * Is there an operator's offer on this request for the buyer to answer?
 *
 * `awaitingCustomerRevisionAcceptance` is the marker, and it has exactly two
 * writers that set it: `RfqAdminService.modify` (the seller revises a request)
 * and `RfqAdminService.createOnBehalf` (the seller drafts one). Everything
 * that clears it — approve, cancel, the buyer's own answer — also moves the
 * request out of the two statuses this is asked in. A request the buyer raised
 * or edited themselves never has it set.
 *
 * `Created from admin` is named as well although `createOnBehalf` always sets
 * the flag: that status *is* the seller's offer by construction, and a row
 * written before the flag was set at creation
 * (`20260617T095510_quote_requests_backfill_admin_created_awaiting`) is still
 * one.
 *
 * It says an offer exists, not that it is complete — whether every line of it
 * is priced is `hasUnpricedLine`'s question.
 */
function sellerHasOffered(rfq: QuoteRequest): boolean {
  return rfq.awaitingCustomerRevisionAcceptance || rfq.status === 'Created from admin';
}

function customerDisplayName(c: CustomerAccountRecord): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email;
}

/** The columns of a quote line a rewrite creates. */
type QuoteRequestItemDraft = Pick<
  QuoteRequestItem,
  | 'quoteRequestId'
  | 'productId'
  | 'productName'
  | 'productSlug'
  | 'variantId'
  | 'variantLabel'
  | 'quantity'
  | 'packagingUnitId'
  | 'packagingUnitName'
  | 'packagingUnitBaseQuantity'
  | 'desiredUnitPrice'
  | 'lineNote'
  | 'lineCurrency'
  | 'groupId'
  | 'position'
> &
  ReferenceColumns;

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

/**
 * A quote's custom-field values as one reader may see them: all of them for an
 * administrator, only the customer-visible ones for anyone else — and none at
 * all when the `custom_fields` port is not wired, because then nothing can say
 * which of them are internal.
 */
export async function quoteCustomFieldValuesFor(
  port: Pick<CustomFieldValuePort, 'projectForCustomer'> | undefined,
  bag: Record<string, unknown>,
  forAdmin: boolean,
): Promise<Record<string, unknown>> {
  if (forAdmin) return bag;
  return port ? port.projectForCustomer('quote_request', bag) : {};
}

/** A customer rewrite only ever keeps stored groups (it creates none). */
function plannedGroupId(group: PlannedLineGroup): string | null {
  return group?.kind === 'existing' ? group.id : null;
}
