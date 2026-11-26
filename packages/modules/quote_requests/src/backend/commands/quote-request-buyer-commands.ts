import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  QUOTE_REQUEST_HOOKABLE_ACTIONS,
  type HookableActionRef,
  type QuoteRequestAssignInWrite,
  type QuoteRequestCreateHookData,
  type QuoteRequestCreateOutbox,
  type QuoteRequestResubmitHookData,
  type QuoteRequestResubmitOutbox,
} from '@endora-commerce/contracts';
import {
  currentCommandHookOrigin,
  type Command,
  type CommandContext,
  type CommandEvent,
} from '@endora-commerce/platform/commands';
import type { EventBase } from '@endora-commerce/platform/events';
import { QuoteRequest, type QuoteRequestStatus } from '../entities/quote-request.entity.js';
import { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import type { QuoteRequestEventType } from '../entities/quote-request-event.entity.js';

/** A history entry's payload, as `RfqEventService.append` takes it. */
type QuoteRequestEventPayload = Record<string, unknown>;
import { assertAssigneeEligible, type AssigneeEligibility } from '../services/assignee-eligibility.js';
import type { RfqEventService } from '../services/rfq-event-service.js';
import type { RfqNotificationService } from '../services/rfq-notification-service.js';
import type { RfqRevisionService } from '../services/rfq-revision-service.js';

/**
 * Issue #1906 — the buyer's create-and-submit as a Command (Principle XIII),
 * declared hookable as `QUOTE_REQUEST_HOOKABLE_ACTIONS.create`
 * (`specs/176-command-hooks-outbox/`).
 *
 * The create **is** the submission: one write raises the request `Pending`,
 * with its lines, revision 1, the `created` and `submitted` history entries and
 * the "new quote request" notification records — all on the Command's `em`,
 * committing together (`specs/179-rfq-and-customer-notifications/` FR-001).
 * `rfq.created.v1` is the Command's event, dispatched once on commit; the
 * delivery kick is the caller's, after `CommandBus.run` returned.
 *
 * `RfqService.createForCustomer` decides everything that may refuse the buyer
 * before it builds this Command — products, packaging, minimums, the
 * negotiation lock — and resolves the names, the currency and the reference
 * prices, so the Command only writes.
 *
 * The audit entry is the one the hand audit recorded — `quote_request.create`,
 * `stateAfter: { status, itemCount, salesChannelId }` — with the actor from the
 * ambient tenant context, as before (a customer for itself, or the administrator
 * impersonating them).
 *
 * *Submit again* is the same write over an earlier request's lines,
 * `quote_request.resubmit`, declared hookable with the same `assign`. The
 * buyer's other writes (`.patch_draft`, `.respond_to_revision`,
 * `.convert_to_order`) keep their hand audit in `rfq-service.ts`.
 */

/** A line as the buyer's create writes it: everything but the request it belongs to. */
export type QuoteRequestBuyerLine = Pick<
  QuoteRequestItem,
  'productId' | 'productName' | 'quantity' | 'lineCurrency' | 'position'
> &
  Partial<
    Pick<
      QuoteRequestItem,
      | 'productSlug'
      | 'variantId'
      | 'packagingUnitId'
      | 'packagingUnitName'
      | 'packagingUnitBaseQuantity'
      | 'desiredUnitPrice'
      | 'lineNote'
      | 'referenceUnitPrice'
      | 'referenceCurrency'
      | 'referenceCapturedAt'
    >
  >;

export interface QuoteRequestBuyerCreateInput {
  /** The account raising the request and its Organization — the request's owner. */
  readonly customer: { readonly customerAccountId: string; readonly organizationId: string };
  /** The channel it is raised on (`raisedOnChannelId()`), `null` outside a request scope. */
  readonly salesChannelId: string | null;
  readonly headerNote: string | null;
  /** In the request's order: `position` is the index. */
  readonly lines: readonly QuoteRequestBuyerLine[];
}

/** What the buyer's create asks of the world besides its own `em`. */
export interface QuoteRequestBuyerCommandDeps {
  /** The next business Quote Request ID, or `undefined` (the entity's placeholder applies). */
  readonly generateBusinessId: (em: EntityManager) => Promise<string | undefined>;
  readonly revisionService: Pick<RfqRevisionService, 'record'>;
  readonly eventService: Pick<RfqEventService, 'append'>;
  readonly notificationService: Pick<RfqNotificationService, 'record' | 'rerecordOperatorSide'>;
  /** Who a command hook may make the assignee (`assignee-eligibility.ts`). */
  readonly assigneeEligibility: AssigneeEligibility;
}

const CREATE = QUOTE_REQUEST_HOOKABLE_ACTIONS.create;
const RESUBMIT = QUOTE_REQUEST_HOOKABLE_ACTIONS.resubmit;

/** The `afterCommit` row, and the ids of the hook data: list 1 only. */
function createdIds(rfq: QuoteRequest, itemCount: number): QuoteRequestCreateOutbox {
  return {
    quoteRequestId: rfq.id,
    organizationId: rfq.organizationId,
    customerAccountId: rfq.customerAccountId,
    salesChannelId: rfq.salesChannelId ?? null,
    assignedAdminUserId: rfq.assignedAdminUserId ?? null,
    itemCount,
  };
}

/**
 * `quote_request.create` — the buyer raises and submits a quote request.
 *
 * Its `beforeCommit` hooks get {@link QuoteRequestCreateHookData}: the ids, and
 * `assign`, through which a hook makes an administrator the request's assignee
 * inside this write — the owner's own `quote_request.assign` as a child
 * Command, then the operators' side of the `submitted` notifications recorded
 * again, for the assignee. No hook, no change: the write is the one it was.
 */
export function makeBuyerCreateQuoteRequestCommand(
  deps: QuoteRequestBuyerCommandDeps,
  input: QuoteRequestBuyerCreateInput,
): Command<QuoteRequest> {
  return makeBuyerSubmissionCommand<QuoteRequestCreateHookData, QuoteRequestCreateOutbox>(deps, input, {
    ref: CREATE,
    ids: createdIds,
    createdPayload: { type: 'created' },
    submitted: (_rfq, itemCount) => ({ eventType: 'submitted', payload: { type: 'submitted', itemCount } }),
    change: 'submitted',
    event: (rfq) => ({
      eventName: 'rfq.created.v1',
      payload: {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        rfqId: rfq.id,
        organizationId: rfq.organizationId,
      } as EventBase,
    }),
  });
}

/**
 * `quote_request.resubmit` — the buyer's *Submit again*: a **new** request,
 * from the lines of `sourceQuoteRequestId` (copied by `RfqService.resubmit`,
 * which refuses before building this), with the `created` entry naming its
 * source, the `re-submitted` entry and the `resubmitted` notification records.
 * It announces no domain event — it never has. Hookable as
 * `QUOTE_REQUEST_HOOKABLE_ACTIONS.resubmit`, with the same `assign` as the
 * create; the source request is not written.
 */
export function makeBuyerResubmitQuoteRequestCommand(
  deps: QuoteRequestBuyerCommandDeps,
  input: QuoteRequestBuyerCreateInput & { readonly sourceQuoteRequestId: string },
): Command<QuoteRequest> {
  const source = input.sourceQuoteRequestId;
  return makeBuyerSubmissionCommand<QuoteRequestResubmitHookData, QuoteRequestResubmitOutbox>(deps, input, {
    ref: RESUBMIT,
    ids: (rfq, itemCount) => ({ ...createdIds(rfq, itemCount), sourceQuoteRequestId: source }),
    createdPayload: { type: 'created', sourceRfqId: source },
    submitted: (rfq) => ({
      eventType: 're-submitted',
      payload: { type: 're-submitted', sourceRfqId: source, newRfqId: rfq.id },
    }),
    change: 'resubmitted',
    event: null,
  });
}

/** What tells the buyer's two submissions apart. */
interface BuyerSubmission<TData, TOutbox extends QuoteRequestCreateOutbox> {
  readonly ref: HookableActionRef<TData, TOutbox>;
  /** The outbox row, and the ids of the hook data. */
  readonly ids: (rfq: QuoteRequest, itemCount: number) => TOutbox;
  readonly createdPayload: QuoteRequestEventPayload;
  /** The history entry the notifications announce. */
  readonly submitted: (
    rfq: QuoteRequest,
    itemCount: number,
  ) => { eventType: QuoteRequestEventType; payload: QuoteRequestEventPayload };
  readonly change: 'submitted' | 'resubmitted';
  readonly event: ((rfq: QuoteRequest) => CommandEvent) | null;
}

/**
 * One buyer submission: the new request, its lines, revision 1, the `created`
 * entry and the entry the notifications announce, the records — and, for a
 * `beforeCommit` hook on `submission.ref`, `assign`.
 */
function makeBuyerSubmissionCommand<TData extends TOutbox & QuoteRequestAssignInWrite, TOutbox extends QuoteRequestCreateOutbox>(
  deps: QuoteRequestBuyerCommandDeps,
  input: QuoteRequestBuyerCreateInput,
  submission: BuyerSubmission<TData, TOutbox>,
): Command<QuoteRequest> {
  const { customer } = input;
  const action = submission.ref.action;
  // The new request's id, drawn here so the Command names its object up front.
  const quoteRequestId = randomUUID();
  const itemCount = input.lines.length;
  // Set by `run`: what `assign` writes through, once the request exists.
  let assign: ((adminUserId: string) => Promise<void>) | null = null;

  return {
    action,
    objectType: submission.ref.objectType,
    objectId: quoteRequestId,
    ...(submission.event ? { event: submission.event } : {}),
    hookData: (rfq): TData => {
      const ids = submission.ids(rfq, itemCount);
      return {
        ...ids,
        // Read when asked: a hook ordered after one that assigned sees its choice.
        get assignedAdminUserId() {
          return rfq.assignedAdminUserId ?? null;
        },
        assign: (adminUserId: string) => {
          if (!assign) throw new Error(`[quote_requests] ${action} has not written the request yet.`);
          return assign(adminUserId);
        },
      } as TData;
    },
    // Called after the hooks, so it names the assignee they chose.
    outboxData: (rfq) => submission.ids(rfq, itemCount),
    run: async (ctx) => {
      const { em } = ctx;
      const businessId = await deps.generateBusinessId(em);
      const rfq = em.create(QuoteRequest, {
        id: quoteRequestId,
        ...(businessId ? { businessId } : {}),
        organizationId: customer.organizationId,
        customerAccountId: customer.customerAccountId,
        salesChannelId: input.salesChannelId,
        status: 'Pending' satisfies QuoteRequestStatus,
        headerNote: input.headerNote,
        submittedAt: new Date(),
        currentRevisionNumber: 1,
        lastCustomerSeenRevisionNumber: 1,
      });
      await em.persist(rfq).flush();

      const items = input.lines.map((line) => em.create(QuoteRequestItem, { ...line, quoteRequestId: rfq.id }));
      await em.persist(items).flush();

      const revision = await deps.revisionService.record(
        { rfq, items, actor: { customerAccountId: customer.customerAccountId } },
        em,
      );
      const actor = { customerAccountId: customer.customerAccountId, roleLabel: 'Customer' };
      await deps.eventService.append(
        { quoteRequestId: rfq.id, eventType: 'created', actor, payload: submission.createdPayload, revisionId: revision.id },
        em,
      );
      const announced = submission.submitted(rfq, itemCount);
      const submitted = await deps.eventService.append(
        { quoteRequestId: rfq.id, ...announced, actor, revisionId: revision.id },
        em,
      );
      const notified = {
        change: submission.change,
        sourceEvent: submitted,
        rfq,
        actor: { customerAccountId: customer.customerAccountId },
      };
      await deps.notificationService.record(em, notified);

      assign = async (adminUserId) => {
        const origin = currentCommandHookOrigin();
        if (origin?.action !== action) {
          throw new Error(
            `[quote_requests] assign is callable only from a beforeCommit hook on '${action}', while it runs: ` +
              'the write it sets the assignee in is committed or not open.',
          );
        }
        await assertAssigneeEligible(deps.assigneeEligibility, adminUserId, rfq.organizationId, 'submission');
        if ((rfq.assignedAdminUserId ?? null) === adminUserId) return;
        await runChild(ctx, makeAssignWithinCreateCommand(rfq, adminUserId, origin.moduleId));
        // The operator side is the assignee and the representatives (research
        // R-5): fixed when the change is saved, which is now.
        await deps.notificationService.rerecordOperatorSide(em, notified);
      };

      return {
        result: rfq,
        before: null,
        after: { status: rfq.status, itemCount, salesChannelId: rfq.salesChannelId ?? null },
      };
    },
  };
}

/** A child Command on the write's transaction; the bus always supplies `run` (never skipped). */
function runChild<T>(ctx: CommandContext, child: Command<T>): Promise<T> {
  if (!ctx.run) throw new Error('[quote_requests] quote_request.create runs on the Command Bus, which supplies ctx.run.');
  return ctx.run(child);
}

/**
 * `quote_request.assign`, inside the buyer's create — the same action and the
 * same state as the operator's assign (`quote-request-admin-commands.ts`), its
 * own audit entry, with `source` the hook's module id, as a port caller's code
 * is recorded. The request is the one this write created, on its `em`: there
 * is no other reader to refuse it to, no version to compare, and its version
 * stays the creation's.
 */
function makeAssignWithinCreateCommand(rfq: QuoteRequest, adminUserId: string, source: string): Command<QuoteRequest> {
  return {
    action: 'quote_request.assign',
    objectType: 'quote_request',
    objectId: rfq.id,
    run: async ({ em }) => {
      const previous = rfq.assignedAdminUserId ?? null;
      rfq.assignedAdminUserId = adminUserId;
      await em.flush();
      return {
        result: rfq,
        before: { assignedAdminUserId: previous },
        after: { assignedAdminUserId: adminUserId, source },
      };
    },
  };
}
