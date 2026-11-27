import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  RFQ_CREATED_BY_ADMIN_EVENT,
  isCustomFieldValidationFailure,
  isUuidShape,
  type AdminCreateQuoteRequest,
  type AdminPatchQuoteRequest,
  type CatalogProductReadPort,
  type CustomerAccountReadPort,
  type CustomFieldMerge,
  type CustomFieldValuePort,
  type RfqCreatedByAdminEventPayload,
  type SalesRepAssignmentPort,
} from '@endora-commerce/contracts';
import type { Command, CommandEvent } from '@endora-commerce/platform/commands';
import type { EventBase } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { QuoteRequest, type QuoteRequestStatus } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import { QuoteRequestItemGroup } from '../entities/quote-request-item-group.entity.js';
import { adminCanSeeOrganization, isPlatformWideScope } from '../services/admin-org-visibility.js';
import { assertAssigneeEligible, type AssigneeEligibility } from '../services/assignee-eligibility.js';
import { operatorLineProducts } from '../services/operator-line-products.js';
import { hasUnpricedLine, quoteIncompleteError, unitPriceText } from '../services/agreed-price.js';
import { AUTOMATIC_ADMIN_CREATION_NOTE } from '../services/history/constants.js';
import { channelCurrency, requestLineCurrency } from '../services/line-currency.js';
import { pairLines } from '../services/line-carry-over.js';
import { groupingShape, planLineGrouping, type GroupingShapeEntry, type LineGroupingPlan } from '../services/line-grouping.js';
import { LINE_STORAGE_ORDER, loadArrangedQuoteLines } from '../services/line-order.js';
import { cancelAuditState } from '../services/quote-request-audit-state.js';
import { raisedOnChannelId } from '../services/raised-on-channel.js';
import { storedReferenceColumns } from '../services/reference-price.js';
import type { RfqEventService } from '../services/rfq-event-service.js';
import type { RfqNotificationService } from '../services/rfq-notification-service.js';
import type { RfqRevisionService } from '../services/rfq-revision-service.js';
import type { RfqService } from '../services/rfq-service.js';
import { lockUnchangedRow } from '../services/transition-lock.js';
import { normaliseShareValidityDays, operatorQuoteStartsUnshared } from '../services/operator-quote-sharing.js';

/**
 * Issue #1824 (`specs/186-aggregate-ports/` US5) — the operator's writes on a
 * Quote Request as Commands (Principle XIII). The admin routes
 * (`routes.admin.ts`, through `RfqAdminService`) and `quoteRequestCommandPort`
 * build their Command from these factories and run it on the Command Bus, so
 * command hooks and the audit trail see one write path. They replace the
 * service's hand-written `#audit` calls; each Command records the state those
 * calls recorded, plus `source` when a port caller named one.
 *
 * **Everything the write announces commits with it** (`transition-lock.ts`,
 * `specs/179-rfq-and-customer-notifications/` FR-001): the history entries,
 * the revision and the notification records are written on the Command's
 * `em`; the domain event is the Command's `event`, dispatched once on commit.
 * What may not be inside is the delivery kick — the caller's, after
 * `CommandBus.run` returned.
 *
 * **The authority step is inside the Command**, as in
 * `negotiation-policy-commands.ts`: the request is read and refused as an
 * unknown id when the operator may not reach its Organization, before
 * anything else is asked or written. Then the route's own order of refusals:
 * status, the caller's expected version, and the row taken `for update` with
 * its version compared (`lockUnchangedRow`).
 *
 * The buyer's writes are not here. Their create-and-submit and submit-again,
 * `quote_request.create` and `.resubmit`, are Commands of their own since
 * issue #1906 (`quote-request-buyer-commands.ts`, declared hookable);
 * `.patch_draft`, `.respond_to_revision` and `.convert_to_order` keep their
 * hand audit in `rfq-service.ts` (T067).
 */

/**
 * Who the write is done as, in the history the buyer and the team read: the
 * administrator (`null` for the system — a worker calling the port under
 * `withSystemScope`) and the label the history shows beside the entry. The
 * audit entry's actor is the Command Bus's, from the ambient tenant context.
 */
export interface QuoteRequestOperator {
  readonly adminUserId: string | null;
  readonly roleLabel: string | null;
}

/** What every operator write takes besides its own input. */
export interface QuoteRequestWriteOptions {
  readonly operator: QuoteRequestOperator;
  /** The `version` the caller read (`If-Match`, `expectedVersion`); `null` = not compared. */
  readonly expectedVersion: number | null;
  /** The integration that called, recorded as `source` (`aggregateCommandSourceSchema`, already checked). */
  readonly source?: string | undefined;
  /** Extension input for the command hooks on the action, keyed by module id. */
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
}

/** What the Commands ask of the world besides their own `em`. */
export interface QuoteRequestAdminCommandDeps {
  readonly salesRepAssignment: Pick<SalesRepAssignmentPort, 'canSeeOrganization'>;
  readonly rfqService: Pick<RfqService, 'generateBusinessId' | 'lineNames'>;
  readonly eventService: Pick<RfqEventService, 'append'>;
  readonly revisionService: Pick<RfqRevisionService, 'record' | 'byNumber' | 'diffRevisions'>;
  readonly notificationService: Pick<RfqNotificationService, 'record'>;
  readonly catalogProducts: Pick<CatalogProductReadPort, 'findByIds'>;
  readonly channelMembership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'>;
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'findById'>;
  /**
   * Issue #1906 — who may be named the request's assignee
   * (`services/assignee-eligibility.ts`); `quote_request.assign` asks it of its target.
   */
  readonly assigneeEligibility: AssigneeEligibility;
  /** Feature 055 — validates and merges custom-field values; absent = values are not written. */
  readonly customFieldValues?: CustomFieldValuePort | undefined;
  /**
   * `specs/192-quote-request-draft-share/` (R-12) — the
   * `quote_requests.default_validity_days` setting; absent = `0`, no deadline.
   */
  readonly resolveDefaultValidityDays?: (() => Promise<number>) | undefined;
  /** Whether the ambient scope reaches every organization. Injectable for the unit test only. */
  readonly isPlatformAdmin?: () => boolean;
}

const notFound = (): HttpError => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Quote Request not found.');

/** The audit after-state with the caller's `source`, when it named one. */
function withSource(state: Record<string, unknown>, source: string | undefined): Record<string, unknown> {
  return source === undefined ? state : { ...state, source };
}

/** The extension input on the Command, when there is any. */
function extensionsOf(options: Pick<QuoteRequestWriteOptions, 'extensions'>): { extensions?: Readonly<Record<string, unknown>> } {
  return options.extensions ? { extensions: options.extensions } : {};
}

function event(eventName: string, payload: Record<string, unknown>): CommandEvent {
  return {
    eventName,
    payload: { eventId: randomUUID(), occurredAt: new Date().toISOString(), ...payload } as EventBase,
  };
}

/**
 * The request the operator may reach, on the Command's `em` (threat model C1,
 * Constitution XI): a request outside the operator's organizations answers
 * exactly as an unknown id does, so its existence does not leak.
 */
async function findVisible(
  em: EntityManager,
  deps: Pick<QuoteRequestAdminCommandDeps, 'salesRepAssignment' | 'isPlatformAdmin'>,
  operator: QuoteRequestOperator,
  quoteRequestId: string,
): Promise<QuoteRequest> {
  if (!isUuidShape(quoteRequestId)) throw notFound();
  const rfq = await em.findOne(QuoteRequest, { id: quoteRequestId });
  if (!rfq) throw notFound();
  const reach = await adminCanSeeOrganization(
    deps.salesRepAssignment,
    operator.adminUserId,
    rfq.organizationId,
    deps.isPlatformAdmin ?? isPlatformWideScope,
  );
  if (!reach) throw notFound();
  return rfq;
}

function assertVersion(rfq: QuoteRequest, expectedVersion: number | null): void {
  if (expectedVersion !== null && rfq.version !== expectedVersion) {
    throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Quote Request was updated concurrently.');
  }
}

/** The 422 every admin custom-field write answers, from `custom_fields`' validation failure. */
function customFieldRefusal(err: unknown): unknown {
  if (isCustomFieldValidationFailure(err)) {
    return new HttpError(
      422,
      ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID,
      'One or more custom fields are invalid.',
      err.errors.map((e) => ({ path: e.field, issue: e.message })),
    );
  }
  return err;
}

// ---------------------------------------------------------------------------
// quote_request.approve
// ---------------------------------------------------------------------------

/**
 * `quote_request.approve` — a `Pending` request whose every line is priced.
 * Approving is what lets the buyer order, at the agreed prices, so an unpriced
 * line is refused (`409 QUOTE_INCOMPLETE`): which price it would be sold at is
 * a commercial decision the operator makes by pricing the line (`modify`).
 */
export function makeApproveQuoteRequestCommand(
  deps: QuoteRequestAdminCommandDeps,
  input: QuoteRequestWriteOptions & { quoteRequestId: string; note?: string | undefined },
): Command<QuoteRequest> {
  return {
    action: 'quote_request.approve',
    objectType: 'quote_request',
    objectId: input.quoteRequestId,
    ...extensionsOf(input),
    event: (rfq) => event('rfq.approved.v1', { rfqId: rfq.id }),
    run: async ({ em }) => {
      const { operator } = input;
      const rfq = await findVisible(em, deps, operator, input.quoteRequestId);
      if (rfq.status !== 'Pending') {
        throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request is not pending approval.');
      }
      assertVersion(rfq, input.expectedVersion);
      const lines = await em.find(QuoteRequestItem, { quoteRequestId: rfq.id }, { orderBy: LINE_STORAGE_ORDER });
      if (hasUnpricedLine(lines)) throw quoteIncompleteError();
      await lockUnchangedRow(em, rfq);

      rfq.status = 'Approved';
      rfq.approvedAt = new Date();
      rfq.awaitingCustomerRevisionAcceptance = false;
      // The operator who approved handles it; the system keeps the assignee.
      rfq.assignedAdminUserId = operator.adminUserId ?? rfq.assignedAdminUserId ?? null;
      rfq.version += 1;
      await em.flush();

      const actor = { adminUserId: operator.adminUserId, roleLabel: operator.roleLabel };
      const note = input.note;
      if (note && note.trim().length > 0) {
        await deps.eventService.append(
          { quoteRequestId: rfq.id, eventType: 'note-added', actor, payload: { type: 'note-added', note } },
          em,
        );
      }
      const evt = await deps.eventService.append(
        { quoteRequestId: rfq.id, eventType: 'approved', actor, payload: { type: 'approved', approvedBy: 'admin' } },
        em,
      );
      await deps.notificationService.record(em, { change: 'approved', sourceEvent: evt, rfq, actor: null });

      return {
        result: rfq,
        before: { status: 'Pending' },
        after: withSource({ status: 'Approved' }, input.source),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// quote_request.cancel
// ---------------------------------------------------------------------------

/**
 * `quote_request.cancel` — a `Pending` or `Created from admin` request. The
 * reason is stored on the request and its `canceled` history entry; the audit
 * entry says only whether one was given (D-288).
 */
export function makeCancelQuoteRequestCommand(
  deps: QuoteRequestAdminCommandDeps,
  input: QuoteRequestWriteOptions & { quoteRequestId: string; reason?: string | undefined },
): Command<QuoteRequest> {
  const reason = input.reason;
  return {
    action: 'quote_request.cancel',
    objectType: 'quote_request',
    objectId: input.quoteRequestId,
    ...extensionsOf(input),
    event: (rfq) => event('rfq.canceled.v1', { rfqId: rfq.id, reason: reason ?? null }),
    run: async ({ em }) => {
      const { operator } = input;
      const rfq = await findVisible(em, deps, operator, input.quoteRequestId);
      if (rfq.status !== 'Pending' && rfq.status !== 'Created from admin') {
        throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request cannot be canceled in its current state.');
      }
      assertVersion(rfq, input.expectedVersion);
      await lockUnchangedRow(em, rfq);

      rfq.status = 'Canceled';
      rfq.canceledAt = new Date();
      rfq.awaitingCustomerRevisionAcceptance = false;
      if (reason) rfq.cancellationReason = reason;
      rfq.assignedAdminUserId = operator.adminUserId ?? rfq.assignedAdminUserId ?? null;
      rfq.version += 1;
      await em.flush();

      const evt = await deps.eventService.append(
        {
          quoteRequestId: rfq.id,
          eventType: 'canceled',
          actor: { adminUserId: operator.adminUserId, roleLabel: operator.roleLabel },
          payload: { type: 'canceled', canceledBy: 'admin', reason: reason ?? null },
        },
        em,
      );
      // `specs/192-quote-request-draft-share/` (FR-005, amendment R-A1) — a
      // quote the customer cannot see is cancelled without telling them. The
      // event is emitted for unshared quotes too — a customer-facing subscriber
      // must check `sharedWithCustomer`.
      if (rfq.sharedWithCustomer) {
        await deps.notificationService.record(em, { change: 'canceled', sourceEvent: evt, rfq, actor: null });
      }

      return { result: rfq, before: null, after: withSource(cancelAuditState(reason), input.source) };
    },
  };
}

// ---------------------------------------------------------------------------
// quote_request.assign
// ---------------------------------------------------------------------------

/**
 * `quote_request.assign` — the request's handling administrator; `null`
 * clears it (a port caller only: the route's body requires an id). An
 * internal-side claim, informational: who sees a request is decided per
 * Organization, never by this. Notifies nobody.
 *
 * Issue #1906 — a named target must pass the one assignee rule (active, holds
 * `rfqs:handle`, reaches the request's Organization), else
 * `422 RFQ_ASSIGNEE_NOT_ELIGIBLE` before the row is taken or anything written.
 * Clearing is always allowed.
 */
export function makeAssignQuoteRequestCommand(
  deps: QuoteRequestAdminCommandDeps,
  input: QuoteRequestWriteOptions & { quoteRequestId: string; adminUserId: string | null },
): Command<QuoteRequest> {
  return {
    action: 'quote_request.assign',
    objectType: 'quote_request',
    objectId: input.quoteRequestId,
    ...extensionsOf(input),
    run: async ({ em }) => {
      const rfq = await findVisible(em, deps, input.operator, input.quoteRequestId);
      assertVersion(rfq, input.expectedVersion);
      if (input.adminUserId !== null) {
        await assertAssigneeEligible(deps.assigneeEligibility, input.adminUserId, rfq.organizationId);
      }
      await lockUnchangedRow(em, rfq);
      const previousAssignee = rfq.assignedAdminUserId ?? null;
      rfq.assignedAdminUserId = input.adminUserId;
      rfq.version += 1;
      await em.flush();
      return {
        result: rfq,
        before: { assignedAdminUserId: previousAssignee },
        after: withSource({ assignedAdminUserId: input.adminUserId }, input.source),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// quote_request.custom_fields.update
// ---------------------------------------------------------------------------

/**
 * `quote_request.custom_fields.update` — the request's custom-field values
 * alone (`quoteRequestCommandPort.setCustomFieldValues`). The admin route
 * carries values on `quote_request.modify`, which also records a revision and
 * asks the buyer to accept it; a server-side caller setting a value does
 * neither, hence an action of its own.
 *
 * The caller's `merge` runs on a **copy** of the bag between this Command's
 * load and its write, under the row lock; the owner does not validate (the
 * caller calls `validateAndMerge` inside it). A throwing merge writes nothing.
 * A merge that changes nothing is not a write: no version bump, no entry.
 */
export function makeSetQuoteRequestCustomFieldValuesCommand(
  input: QuoteRequestWriteOptions &
    Pick<QuoteRequestAdminCommandDeps, 'salesRepAssignment' | 'isPlatformAdmin'> & {
      quoteRequestId: string;
      merge: CustomFieldMerge;
    },
): Command<QuoteRequest> {
  return {
    action: 'quote_request.custom_fields.update',
    objectType: 'quote_request',
    objectId: input.quoteRequestId,
    ...extensionsOf(input),
    run: async ({ em }) => {
      const rfq = await findVisible(em, input, input.operator, input.quoteRequestId);
      assertVersion(rfq, input.expectedVersion);
      await lockUnchangedRow(em, rfq);
      const current = { ...(rfq.customFieldValues ?? {}) };
      const next = await input.merge({ ...current });
      const changed = changedKeys(current, next);
      if (changed.length === 0) return { result: rfq, skipAudit: true };
      rfq.customFieldValues = next;
      rfq.version += 1;
      await em.flush();
      return { result: rfq, before: null, after: withSource({ changedCustomFields: changed }, input.source) };
    },
  };
}

/** The keys whose value differs between two bags (added, removed or changed), sorted. */
function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

// ---------------------------------------------------------------------------
// quote_request.modify (US3) — also edits a `Created from admin` request (US4)
// ---------------------------------------------------------------------------

/**
 * `quote_request.modify` — the operator's revision of a `Pending` or
 * `Created from admin` request: one new revision, which the buyer is asked to
 * accept, its `modified` history entry and the buyer's notification records.
 */
export function makeModifyQuoteRequestCommand(
  deps: QuoteRequestAdminCommandDeps,
  input: QuoteRequestWriteOptions & { quoteRequestId: string; body: AdminPatchQuoteRequest },
): Command<QuoteRequest> {
  const { body } = input;
  return {
    action: 'quote_request.modify',
    objectType: 'quote_request',
    objectId: input.quoteRequestId,
    ...extensionsOf(input),
    event: (rfq) => event('rfq.modified.v1', { rfqId: rfq.id, revisionNumber: rfq.currentRevisionNumber }),
    run: async ({ em }) => {
      const { operator } = input;
      const rfq = await findVisible(em, deps, operator, input.quoteRequestId);
      if (rfq.status !== 'Pending' && rfq.status !== 'Created from admin') {
        throw new HttpError(409, ERROR_CODES.RFQ_NOT_QUOTED, 'Quote Request is not editable.');
      }
      assertVersion(rfq, input.expectedVersion);
      await lockUnchangedRow(em, rfq);

      // Research R7 — a validity change is recorded on the event, since no
      // revision snapshot carries `expiresAt`.
      const recorded: {
        validity?: { before: string | null; after: string | null };
        validityDays?: { before: number | null; after: number | null };
      } = {};
      // Feature 159 — the grouping's shape before and after, for the audit entry
      // (FR-081); set only when the body rewrites the lines.
      let groupingAudit: { before: GroupingShapeEntry[]; after: GroupingShapeEntry[] } | null = null;

      if (body.headerNote !== undefined) rfq.headerNote = body.headerNote ?? null;

      // Feature 055 — validate + merge custom-field values (host owns the write).
      if (body.customFieldValues !== undefined && deps.customFieldValues) {
        try {
          rfq.customFieldValues = await deps.customFieldValues.validateAndMerge(
            'quote_request',
            rfq.customFieldValues ?? {},
            body.customFieldValues,
          );
        } catch (err) {
          throw customFieldRefusal(err);
        }
      }

      if (body.items) {
        // Feature 163, P-3 = A / P-3b = A — an archived product is refused,
        // and the operator is told why (`409 PRODUCT_ARCHIVED`).
        const productById = operatorLineProducts(
          await deps.catalogProducts.findByIds(body.items.map((it) => it.productId)),
          body.items.map((it) => it.productId),
        );
        // In display order — the order the operator saw, which the pairing's
        // last rule (by order) relies on — with the stored groups.
        const { lines: existing, groups: storedGroups } = await loadArrangedQuoteLines(em, rfq.id);
        // Feature 146, FR-034 (research R5.1, R5.2) — a body line is the stored
        // row its `id` names (same product only), else the row the R6 rule
        // pairs it with. A paired line keeps what the rep did not change:
        // packaging unit, product name snapshot, the customer's proposal and the
        // stored reference; variant and note too, unless the body carries the
        // key (`lineNote: null` clears). A new line has no packaging unit and no
        // reference — `modify` never prices a line.
        // Feature 159 (research N-32) — a line without an id pairs with a row
        // of the group it names (an existing group, by its id) and of its
        // quantity first: one product may sit on several lines.
        const storedIdOfKey = new Map((body.groups ?? []).flatMap((group) => (group.id ? [[group.key, group.id]] : [])));
        const { paired } = pairLines(
          existing,
          body.items.map((line) => ({
            id: line.id,
            productId: line.productId,
            variantId: line.variantId,
            quantity: line.quantity,
            groupId:
              body.groups === undefined
                ? undefined
                : line.groupKey == null
                  ? null
                  : storedIdOfKey.get(line.groupKey),
          })),
          'admin',
        );
        // Feature 159 (research R-8, R-14) — the grouping travels with the line
        // rewrite: planned before anything is written (a foreign group id is
        // refused here), then written under this lock and flush.
        const plan = planLineGrouping({
          storedGroups,
          body: { groups: body.groups, items: body.items },
          pairedRows: paired,
        });
        groupingAudit = { before: groupingShape(storedGroups, existing.map((row) => row.groupId)), after: plan.after };
        await em.remove(existing).flush();
        const groupIds = await writeLineGroups(em, rfq.id, storedGroups, plan);
        const items: QuoteRequestItem[] = [];
        // Issue #303 — every line, a new one too, keeps the request's currency.
        const lineCurrency = await requestLineCurrency(em, rfq, existing);
        // Feature 163 (FR-017 d, N2) — a line the operator adds is named at the
        // request channel's default language; a stored line keeps its snapshot.
        const lineNames = await deps.rfqService.lineNames([...productById.values()], rfq.salesChannelId ?? null, null);
        for (const [index, lineInput] of body.items.entries()) {
          const product = productById.get(lineInput.productId)!;
          // Feature 159 (research N-33) — a new line split off a stored line of
          // this quote takes what that line carries beyond the body (variant,
          // packaging unit, proposal, note, currency, reference); the stored
          // line itself stays paired with the line it still is.
          const row =
            paired[index] ??
            (lineInput.splitFromId !== undefined
              ? (existing.find((stored) => stored.id === lineInput.splitFromId && stored.productId === product.id) ?? null)
              : null);
          const variantId = lineInput.variantId !== undefined ? lineInput.variantId : (row?.variantId ?? null);
          items.push(
            em.create(QuoteRequestItem, {
              quoteRequestId: rfq.id,
              productId: product.id,
              productName: row?.productName ?? (lineNames.get(product.id) || product.name),
              productSlug: product.slug,
              variantId,
              variantLabel: row !== null && (row.variantId ?? null) === variantId ? (row.variantLabel ?? null) : null,
              quantity: lineInput.quantity,
              packagingUnitName: row?.packagingUnitName ?? null,
              packagingUnitBaseQuantity: row?.packagingUnitBaseQuantity ?? null,
              // Feature 155 (analyze F14) — the resolved unit travels with its
              // snapshot; an operator never sends one, a new line has none.
              packagingUnitId: row?.packagingUnitId ?? null,
              desiredUnitPrice: row?.desiredUnitPrice ?? null,
              agreedUnitPrice:
                lineInput.agreedUnitPrice !== undefined && lineInput.agreedUnitPrice !== null
                  ? unitPriceText(lineInput.agreedUnitPrice)
                  : null,
              lineNote: lineInput.lineNote !== undefined ? lineInput.lineNote : (row?.lineNote ?? null),
              lineCurrency,
              ...(row !== null
                ? storedReferenceColumns(row)
                : { referenceUnitPrice: null, referenceCurrency: null, referenceCapturedAt: null }),
              groupId: groupIds(plan.lines[index]!.group),
              position: plan.lines[index]!.position,
            }),
          );
        }
        await em.persist(items).flush();
      }

      rfq.currentRevisionNumber += 1;
      rfq.awaitingCustomerRevisionAcceptance = true;
      rfq.assignedAdminUserId = operator.adminUserId ?? rfq.assignedAdminUserId ?? null;
      if (body.expiresInDays !== undefined && !rfq.sharedWithCustomer) {
        // `specs/192-quote-request-draft-share/` (research R-10) — the days are
        // applied when the quote is shared; no date is written before that.
        const before = rfq.shareValidityDays ?? null;
        rfq.shareValidityDays = normaliseShareValidityDays(body.expiresInDays);
        if (before !== rfq.shareValidityDays) recorded.validityDays = { before, after: rfq.shareValidityDays };
      } else if (body.expiresInDays !== undefined) {
        // Owner decision of 2026-11-24 (`specs/192-quote-request-draft-share/`):
        // `0` or empty means no deadline on a shared quote too — never
        // "expires now". An operator closes an offer by cancelling it.
        const days = normaliseShareValidityDays(body.expiresInDays);
        const before = rfq.expiresAt?.toISOString() ?? null;
        rfq.expiresAt = days === null ? null : new Date(Date.now() + days * 86_400_000);
        const after = rfq.expiresAt?.toISOString() ?? null;
        if (before !== after) recorded.validity = { before, after };
      }
      rfq.version += 1;
      await em.flush();

      // FR-001 — the revision, the `modified` entry naming it and the records
      // naming that entry commit with the lines they describe.
      // Feature 159 — the revision records the lines in display order.
      const items = (await loadArrangedQuoteLines(em, rfq.id)).lines;
      const previousRevision = await deps.revisionService.byNumber(rfq.id, rfq.currentRevisionNumber - 1);
      const revision = await deps.revisionService.record(
        {
          rfq,
          items,
          actor: { adminUserId: operator.adminUserId },
          previousRevisionId: previousRevision?.id ?? null,
        },
        em,
      );
      const diff = previousRevision
        ? deps.revisionService.diffRevisions({
            beforeHeaderNote: previousRevision.headerNoteSnapshot ?? null,
            afterHeaderNote: rfq.headerNote ?? null,
            beforeItems: previousRevision.itemsSnapshot,
            afterItems: revision.itemsSnapshot,
          })
        : [];
      const evt = await deps.eventService.append(
        {
          quoteRequestId: rfq.id,
          eventType: 'modified',
          actor: { adminUserId: operator.adminUserId, roleLabel: operator.roleLabel },
          payload: { type: 'modified', diff, ...recorded },
          revisionId: revision.id,
        },
        em,
      );
      // `specs/192-quote-request-draft-share/` (FR-005, amendment R-A1) — an
      // edit of a quote the customer cannot see is the operators' alone. The
      // event is emitted for unshared quotes too — a customer-facing subscriber
      // must check `sharedWithCustomer`.
      if (rfq.sharedWithCustomer) {
        await deps.notificationService.record(em, { change: 'revised', sourceEvent: evt, rfq, actor: null });
      }

      return {
        result: rfq,
        before: groupingAudit ? { groups: groupingAudit.before } : null,
        after: withSource(
          {
            currentRevisionNumber: rfq.currentRevisionNumber,
            status: rfq.status,
            ...(groupingAudit ? { groups: groupingAudit.after } : {}),
          },
          input.source,
        ),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// quote_request.create_on_behalf (US4)
// ---------------------------------------------------------------------------

/**
 * Feature 163 (T155 §1.5c, owner decision 2026-10-29 "A") — the channel an
 * operator's on-behalf request is raised on: the one the body names, else the
 * one the admin request resolved (the resolver's step-4 system default, or
 * `X-Sales-Channel`); `null` outside a request scope. One answer for the check,
 * the stored row and the warnings, so they cannot speak about two channels.
 */
export function onBehalfChannelId(body: Pick<AdminCreateQuoteRequest, 'salesChannelId'>): string | null {
  return body.salesChannelId ?? raisedOnChannelId();
}

/**
 * `quote_request.create_on_behalf` — a request an operator prepares for a
 * customer of an Organization: status `Created from admin`, revision 1, its
 * `created` entry and the automatic note. It starts unshared
 * (`specs/192-quote-request-draft-share/`, FR-001): the buyer's `prepared`
 * notification belongs to the share, not here. Every refusal comes before anything is numbered or written.
 * Announces `rfq.created_by_admin.v1` — never `rfq.created.v1`, which is the
 * customer's own submission.
 */
export function makeCreateOnBehalfCommand(
  deps: QuoteRequestAdminCommandDeps,
  input: Omit<QuoteRequestWriteOptions, 'expectedVersion'> & { body: AdminCreateQuoteRequest },
): Command<QuoteRequest> {
  const { body, operator } = input;
  // The new request's id, drawn here so the Command names its object up front.
  const quoteRequestId = randomUUID();
  return {
    action: 'quote_request.create_on_behalf',
    objectType: 'quote_request',
    objectId: quoteRequestId,
    ...extensionsOf(input),
    event: (rfq) =>
      event(RFQ_CREATED_BY_ADMIN_EVENT, {
        rfqId: rfq.id,
        organizationId: rfq.organizationId,
        adminUserId: operator.adminUserId,
        // Handed on as it came: this module validates its shape and reads nothing in it.
        origin: body.origin ?? null,
      } satisfies RfqCreatedByAdminEventPayload),
    run: async ({ em }) => {
      // Visibility on the target organization: only a sales representative is
      // narrowed (issue #957).
      const reach = await adminCanSeeOrganization(
        deps.salesRepAssignment,
        operator.adminUserId,
        body.organizationId,
        deps.isPlatformAdmin ?? isPlatformWideScope,
      );
      if (!reach) throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Not authorized for this organization.');

      // The membership half of the old `findOne(CustomerAccount, { id,
      // organizationId })` is asserted here rather than in the query: the record
      // carries `organizationId`, so the port does not need a second lookup shape
      // and the two failures still answer with one message, as they did.
      const customer = await deps.customerAccounts.findById(body.customerAccountId);
      if (!customer || customer.organizationId !== body.organizationId) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer does not belong to the organization.');
      }

      // Feature 163 (T155 §1.5c, security review M1, owner decision 2026-10-29 "A")
      // — the request is raised on the channel the operator names, else on the one
      // the admin's own request resolved (the resolver's step-4 system default, or
      // `X-Sales-Channel`), and **either way** that channel must be one of the
      // Organization's active channels: the ones its members may shop on, and the
      // set the create screen offers. The server is the sole enforcer, so omitting
      // the id is not a way around the check. Exactly that channel — a stale,
      // foreign or inactive id is refused, never replaced by another. No channel at
      // all (no request scope: a worker calling the port) is refused as well:
      // there is no "no-channel" quote request (Constitution XII), and on the HTTP
      // route the resolver always answers one.
      const channelId = onBehalfChannelId(body);
      if (channelId === null) {
        throw new HttpError(
          422,
          ERROR_CODES.RFQ_SALES_CHANNEL_NOT_ALLOWED,
          'No sales channel to raise this quote request on: name salesChannelId.',
          { code: 'no_channel' },
        );
      }
      const channels = await deps.channelMembership.listChannelsForEntity('organization', body.organizationId);
      if (!channels.some((c) => c.id === channelId && c.active)) {
        throw new HttpError(
          422,
          ERROR_CODES.RFQ_SALES_CHANNEL_NOT_ALLOWED,
          "This sales channel is not one of the organization's active sales channels.",
        );
      }

      // **Neither scoping axis is applied to these lines, and that is the
      // decision rather than the gap.** `RfqService.createForCustomer` filters by
      // `isProductVisibleTo` (issue #227) and by the request's channel assortment
      // (issue #259); this path filters by neither. It is an operator surface:
      // the operator names the organisation, the customer and the lines, having
      // chosen them from an admin catalogue that shows the whole assortment, so
      // there is no buyer whose audience could answer. The caller's gate —
      // `quote_requests:write` on the route, the caller's own on the port — is
      // the enforcement, exactly as `quick_order`'s `'unrestricted'` import arm
      // says of itself. One exception, by owner decisions P-3 = A and P-3b = A
      // (feature 163): an archived product is refused, with `409 PRODUCT_ARCHIVED`.
      const productById = operatorLineProducts(
        await deps.catalogProducts.findByIds(body.items.map((it) => it.productId)),
        body.items.map((it) => it.productId),
      );

      // Feature 175 (FR-015, FR-019) — the request's custom-field values,
      // validated as a merge onto an empty bag before anything is numbered or
      // written: a refusal creates nothing, a `required` definition is refused
      // even when no value is sent, and the creation's audit entry names what
      // was stored.
      let customFieldValues: Record<string, unknown> = {};
      if (deps.customFieldValues) {
        try {
          customFieldValues = await deps.customFieldValues.validateAndMerge('quote_request', {}, body.customFieldValues ?? {});
        } catch (err) {
          throw customFieldRefusal(err);
        }
      }

      // `specs/192-quote-request-draft-share/` (FR-001, R-2) — the one place that
      // decides whether the new quote starts unshared. It does, always, today;
      // a line may then have no price yet (FR-013, R-19), since sharing is
      // refused until every line has one.
      const startsUnshared = operatorQuoteStartsUnshared();
      // FR-031, FR-033 — the default is snapshotted into the new quote, so a later
      // change of the setting moves no quote already created.
      const defaultValidityDays =
        body.expiresInDays === undefined ? ((await deps.resolveDefaultValidityDays?.()) ?? 0) : 0;

      const businessId = await deps.rfqService.generateBusinessId(em);
      const rfq = em.create(QuoteRequest, {
        id: quoteRequestId,
        ...(businessId ? { businessId } : {}),
        organizationId: body.organizationId,
        customerAccountId: body.customerAccountId,
        // The channel checked above — the honest answer for "where was this
        // raised", not a channel this module picked.
        salesChannelId: channelId,
        createdByAdminUserId: operator.adminUserId,
        assignedAdminUserId: operator.adminUserId,
        status: 'Created from admin' satisfies QuoteRequestStatus,
        headerNote: body.headerNote ?? null,
        currentRevisionNumber: 1,
        lastCustomerSeenRevisionNumber: 0,
        // The customer must accept or reject the quote the operator prepared, so
        // it surfaces the Accept/Reject controls on the storefront (the same flag
        // the operator's later revisions set).
        awaitingCustomerRevisionAcceptance: true,
        // `specs/192-quote-request-draft-share/` (R-10) — invisible to the
        // customer until shared; the validity is kept as days and becomes a
        // date at the share, so no date is written here.
        sharedWithCustomer: !startsUnshared,
        shareValidityDays: normaliseShareValidityDays(
          body.expiresInDays === undefined ? defaultValidityDays : body.expiresInDays,
        ),
        expiresAt: null,
        customFieldValues,
      });
      await em.persist(rfq).flush();

      // Feature 159 — the new quote's groups, written before its lines (FR-009).
      const plan = planLineGrouping({
        storedGroups: [],
        body: { groups: body.groups, items: body.items },
        pairedRows: body.items.map(() => null),
      });
      const groupIds = await writeLineGroups(em, rfq.id, [], plan);
      const items: QuoteRequestItem[] = [];
      // Issue #303 — decided here, once: the raised-on channel's currency.
      const lineCurrency = await channelCurrency(em, rfq.salesChannelId);
      // Feature 163 (FR-017 d, N2) — an operator's lines are named at the
      // request channel's default language.
      const lineNames = await deps.rfqService.lineNames([...productById.values()], rfq.salesChannelId ?? null, null);
      for (const [index, lineInput] of body.items.entries()) {
        const product = productById.get(lineInput.productId)!;
        items.push(
          em.create(QuoteRequestItem, {
            quoteRequestId: rfq.id,
            productId: product.id,
            productName: lineNames.get(product.id) || product.name,
            productSlug: product.slug,
            variantId: lineInput.variantId ?? null,
            quantity: lineInput.quantity,
            // FR-013 — a line the operator has not priced yet stays unpriced.
            agreedUnitPrice: lineInput.agreedUnitPrice == null ? null : unitPriceText(lineInput.agreedUnitPrice),
            lineNote: lineInput.lineNote ?? null,
            lineCurrency,
            groupId: groupIds(plan.lines[index]!.group),
            position: plan.lines[index]!.position,
          }),
        );
      }
      await em.persist(items).flush();

      // FR-001 — the request, its groups and lines, revision 1 and its history
      // entries commit together.
      const actor = { adminUserId: operator.adminUserId, roleLabel: operator.roleLabel };
      const revision = await deps.revisionService.record(
        {
          rfq,
          // Feature 159 — revision 1 records the lines in display order.
          items: (await loadArrangedQuoteLines(em, rfq.id)).lines,
          actor: { adminUserId: operator.adminUserId },
        },
        em,
      );
      await deps.eventService.append(
        { quoteRequestId: rfq.id, eventType: 'created', actor, payload: { type: 'created' }, revisionId: revision.id },
        em,
      );
      await deps.eventService.append(
        {
          quoteRequestId: rfq.id,
          eventType: 'note-added',
          actor,
          payload: { type: 'note-added', note: AUTOMATIC_ADMIN_CREATION_NOTE },
          revisionId: revision.id,
        },
        em,
      );
      // `specs/192-quote-request-draft-share/` (FR-005) — nothing is recorded for
      // the customer here: the quote is unshared, and `prepared` announces the
      // share (`contracts/notification-matrix-amendment.md`). The `created`
      // entry and the automatic note are the operators' history.

      return {
        result: rfq,
        before: null,
        after: withSource(
          {
            status: rfq.status,
            itemCount: items.length,
            salesChannelId: rfq.salesChannelId ?? null,
            groups: plan.after,
            // `specs/192-quote-request-draft-share/` (data-model §5).
            sharedWithCustomer: rfq.sharedWithCustomer,
            shareValidityDays: rfq.shareValidityDays ?? null,
            // Feature 175 (FR-021) — the keys stored, never their values
            // (`specs/conventions/audit-state.md`, D-288).
            ...(Object.keys(rfq.customFieldValues ?? {}).length > 0
              ? { changedCustomFields: Object.keys(rfq.customFieldValues ?? {}).sort() }
              : {}),
          },
          input.source,
        ),
      };
    },
  };
}

/**
 * Feature 159 — write a grouping plan's groups (deletes, renames, creates) and
 * flush, so a line inserted next can name a group created here; answers the id
 * each planned line group resolves to. The quote's old lines are already gone
 * when this runs, so a deleted group has no line left to set to null.
 */
async function writeLineGroups(
  em: EntityManager,
  quoteRequestId: string,
  storedGroups: readonly QuoteRequestItemGroup[],
  plan: LineGroupingPlan,
): Promise<(group: LineGroupingPlan['lines'][number]['group']) => string | null> {
  const storedById = new Map(storedGroups.map((group) => [group.id, group]));
  for (const id of plan.deleteGroupIds) {
    const row = storedById.get(id);
    if (row) em.remove(row);
  }
  const createdByKey = new Map<string, string>();
  for (const group of plan.groups) {
    if (group.kind === 'create') {
      const row = em.create(QuoteRequestItemGroup, { quoteRequestId, name: group.name, position: group.position });
      em.persist(row);
      createdByKey.set(group.key, row.id);
    } else {
      const row = storedById.get(group.id);
      if (row) {
        row.name = group.name;
        row.position = group.position;
      }
    }
  }
  await em.flush();
  return (group) => (group === null ? null : group.kind === 'existing' ? group.id : (createdByKey.get(group.key) ?? null));
}
