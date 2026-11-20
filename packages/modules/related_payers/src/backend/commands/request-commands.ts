import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { LockMode } from '@mikro-orm/core';
import {
  RELATED_PAYERS_EVENTS,
  type RelatedPayerApprovalMode,
  type RelatedPayerRequestDirection,
  type RelatedPayerRequestEventV1,
  type RelatedPayerRequestOutbox,
  type RelatedPayerUnregisteredMode,
} from '@endora-commerce/contracts';
import type { Command, CommandEvent } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { RelatedPayerRequest } from '../entities/related-payer-request.entity.js';
import type { RoutingDecision } from '../services/request-routing.js';
import { assertRequestDecision } from '../services/request-state.js';
import { linkCreateCommand } from './link-commands.js';

/**
 * `specs/182-related-payers/` T079 (FR-040 – FR-045, FR-100, contracts/commands-audit.md) — the
 * request Commands. Their audit state is codes, ids, booleans and one length: never the tax ID,
 * the contact e-mail, the comment, the rejection reason or a name (SC-006).
 */
const OBJECT_TYPE = 'related_payer_request';

/** The after-commit outbox row's data (research R-8): ids and codes, the sender as the tenant. */
function requestOutbox(request: RelatedPayerRequest): RelatedPayerRequestOutbox {
  return {
    requestId: request.id,
    direction: request.direction,
    routing: request.routing,
    state: request.state,
    organizationId: request.organizationId,
  };
}

function requestEvent(eventName: string, request: RelatedPayerRequest, linkId?: string): CommandEvent {
  const payload: RelatedPayerRequestEventV1 = {
    requestId: request.id,
    direction: request.direction,
    senderOrganizationId: request.organizationId,
    counterpartyOrganizationId: request.counterpartyOrganizationId,
    routing: request.routing,
    state: request.state,
    salesChannelId: request.salesChannelId,
    ...(linkId ? { linkId } : {}),
  };
  return { eventName, payload: payload as never };
}

/**
 * The request, row-locked for the decision: of two concurrent decisions the second waits, then
 * reads the first one's terminal state and loses with `409` (FR-045). Every decision bumps
 * `version`, which a caller's read version is compared with.
 */
async function loadRequest(
  em: Parameters<Command['run']>[0]['em'],
  requestId: string,
): Promise<RelatedPayerRequest> {
  const request = await em.findOne(RelatedPayerRequest, { id: requestId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
  if (!request) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Request not found.');
  return request;
}

export interface RequestCreateInput {
  readonly senderOrganizationId: string;
  readonly senderCustomerAccountId: string;
  readonly direction: RelatedPayerRequestDirection;
  readonly taxIdNormalized: string;
  readonly contactEmail: string;
  readonly comment: string | null;
  readonly decision: RoutingDecision;
  readonly approvalMode: RelatedPayerApprovalMode;
  readonly unregisteredMode: RelatedPayerUnregisteredMode;
  readonly salesChannelId: string;
  readonly language: string;
  readonly expiresAt: Date;
}

/** `related_payers.request.create` — FR-040, FR-043, FR-044. */
export function requestCreateCommand(input: RequestCreateInput): Command<RelatedPayerRequest> {
  const id = randomUUID();
  return {
    action: 'related_payers.request.create',
    objectType: OBJECT_TYPE,
    objectId: id,
    async run({ em }) {
      const request = em.create(RelatedPayerRequest, {
        id,
        organizationId: input.senderOrganizationId,
        direction: input.direction,
        senderCustomerAccountId: input.senderCustomerAccountId,
        taxIdNormalized: input.taxIdNormalized,
        contactEmail: input.contactEmail,
        comment: input.comment,
        counterpartyOrganizationId: input.decision.counterpartyOrganizationId,
        routing: input.decision.routing,
        operatorReason: input.decision.operatorReason,
        approvalMode: input.approvalMode,
        unregisteredMode: input.unregisteredMode,
        salesChannelId: input.salesChannelId,
        language: input.language,
        expiresAt: input.expiresAt,
      } as never);
      em.persist(request);
      await em.flush();
      return {
        result: request,
        before: null,
        after: {
          state: 'pending',
          direction: input.direction,
          routing: input.decision.routing,
          operatorReason: input.decision.operatorReason,
          approvalMode: input.approvalMode,
          unregisteredMode: input.unregisteredMode,
          counterpartyMatched: input.decision.counterpartyOrganizationId !== null,
        },
      };
    },
    event: (request) => requestEvent(RELATED_PAYERS_EVENTS.REQUEST_CREATED, request),
    outboxData: requestOutbox,
  };
}

export interface RequestAcceptInput {
  readonly requestId: string;
  readonly expectedVersion: number;
  /** Who decides: the counterparty's user, or the operator (FR-043). */
  readonly step: 'counterparty' | 'operator';
  readonly deciderId: string;
  /**
   * US5-2 — the operator approves a request whose counterparty had no account by naming the
   * Organization just created for it. Only an operator's step, only where none is set.
   */
  readonly assignCounterpartyOrganizationId?: string;
}

/**
 * `related_payers.request.accept` — FR-045. The counterparty's acceptance under
 * `payer_then_admin` moves the request to the operator (`second_step`); any other acceptance
 * creates the link, always on the **buyer's** commercial terms (RP-11, FR-119).
 */
export function requestAcceptCommand(
  input: RequestAcceptInput,
): Command<{ request: RelatedPayerRequest; linkId: string | null }> {
  return {
    action: 'related_payers.request.accept',
    objectType: OBJECT_TYPE,
    objectId: input.requestId,
    async run(ctx) {
      const { em } = ctx;
      const request = await loadRequest(em, input.requestId);
      assertRequestDecision(request, 'active', input.expectedVersion);
      if (input.step === 'counterparty' && request.approvalMode === 'payer_then_admin' && request.routing === 'counterparty') {
        request.counterpartyAcceptedAt = new Date();
        request.routing = 'operator';
        request.operatorReason = 'second_step';
        request.version += 1;
        await em.flush();
        return {
          result: { request, linkId: null },
          before: { state: 'pending', routing: 'counterparty' },
          after: { state: 'pending', step: input.step, routing: 'operator', operatorReason: 'second_step' },
        };
      }
      if (input.assignCounterpartyOrganizationId) {
        if (input.step !== 'operator' || request.counterpartyOrganizationId) {
          throw new HttpError(409, ERROR_CODES.RELATED_PAYER_REQUEST_DECIDED, 'This request already names an organization.');
        }
        request.counterpartyOrganizationId = input.assignCounterpartyOrganizationId;
      }
      const counterparty = request.counterpartyOrganizationId;
      if (!counterparty) {
        throw new HttpError(409, ERROR_CODES.RELATED_PAYER_REQUEST_DECIDED, 'This request has no counterparty to link yet.');
      }
      const [buyer, payer] =
        request.direction === 'buyer_request'
          ? [request.organizationId, counterparty]
          : [counterparty, request.organizationId];
      const link = await linkCreateCommand({
        buyerOrganizationId: buyer,
        payerOrganizationId: payer,
        addressScope: { kind: 'all' },
        commercialTerms: 'buyer',
        origin: request.direction === 'buyer_request' ? 'request' : 'invitation',
        originRequestId: request.id,
        actorKind: input.step === 'operator' ? 'operator' : request.direction === 'buyer_request' ? 'payer' : 'buyer',
      }).run(ctx);
      request.state = 'active';
      request.decidedAt = new Date();
      request.decidedByKind = input.step;
      request.decidedById = input.deciderId;
      request.linkId = link.result.id;
      request.version += 1;
      await em.flush();
      return {
        result: { request, linkId: link.result.id },
        before: { state: 'pending' },
        after: {
          state: 'active',
          step: input.step,
          linkId: link.result.id,
          ...(input.assignCounterpartyOrganizationId ? { counterpartyOrganizationId: input.assignCounterpartyOrganizationId } : {}),
        },
      };
    },
    event: ({ request, linkId }) =>
      request.state === 'active'
        ? requestEvent(RELATED_PAYERS_EVENTS.REQUEST_DECIDED, request, linkId ?? undefined)
        : undefined,
    outboxData: ({ request }) => requestOutbox(request),
  };
}

/** `related_payers.request.reject` — FR-045; the reason is shown to the sender, never audited. */
export function requestRejectCommand(input: {
  readonly requestId: string;
  readonly expectedVersion: number;
  readonly step: 'counterparty' | 'operator';
  readonly deciderId: string;
  readonly reason: string | null;
}): Command<RelatedPayerRequest> {
  return {
    action: 'related_payers.request.reject',
    objectType: OBJECT_TYPE,
    objectId: input.requestId,
    async run({ em }) {
      const request = await loadRequest(em, input.requestId);
      assertRequestDecision(request, 'rejected', input.expectedVersion);
      request.state = 'rejected';
      request.rejectionReason = input.reason;
      request.decidedAt = new Date();
      request.decidedByKind = input.step;
      request.decidedById = input.deciderId;
      request.version += 1;
      await em.flush();
      return {
        result: request,
        before: { state: 'pending' },
        after: { state: 'rejected', step: input.step, rejectionReasonLength: input.reason?.length ?? 0 },
      };
    },
    event: (request) => requestEvent(RELATED_PAYERS_EVENTS.REQUEST_DECIDED, request),
    outboxData: requestOutbox,
  };
}

/** `related_payers.request.withdraw` — FR-045, the sender while pending. Tells nobody (RP-20 c). */
export function requestWithdrawCommand(input: {
  readonly requestId: string;
  readonly expectedVersion: number;
  readonly senderCustomerAccountId: string;
}): Command<RelatedPayerRequest> {
  return {
    action: 'related_payers.request.withdraw',
    objectType: OBJECT_TYPE,
    objectId: input.requestId,
    async run({ em }) {
      const request = await loadRequest(em, input.requestId);
      assertRequestDecision(request, 'withdrawn', input.expectedVersion);
      request.state = 'withdrawn';
      request.decidedAt = new Date();
      request.decidedByKind = 'sender';
      request.decidedById = input.senderCustomerAccountId;
      request.version += 1;
      await em.flush();
      return { result: request, before: { state: 'pending' }, after: { state: 'withdrawn' } };
    },
    event: (request) => requestEvent(RELATED_PAYERS_EVENTS.REQUEST_DECIDED, request),
  };
}

/** `related_payers.request.expire` — FR-045, FR-102; the expiry sweep, as the system actor. */
export function requestExpireCommand(input: { readonly requestId: string; readonly expectedVersion: number }): Command<RelatedPayerRequest> {
  return {
    action: 'related_payers.request.expire',
    objectType: OBJECT_TYPE,
    objectId: input.requestId,
    async run({ em }) {
      const request = await loadRequest(em, input.requestId);
      assertRequestDecision(request, 'expired', input.expectedVersion);
      request.state = 'expired';
      request.decidedAt = new Date();
      request.decidedByKind = 'system';
      request.version += 1;
      await em.flush();
      return { result: request, before: { state: 'pending' }, after: { state: 'expired' } };
    },
    event: (request) => requestEvent(RELATED_PAYERS_EVENTS.REQUEST_DECIDED, request),
    // RP-20 (c) — the requester hears of it from the outbox, after commit.
    outboxData: requestOutbox,
  };
}

/**
 * `related_payers.request.route` — US5 (FR-023, FR-043, FR-044): a pending request that waited
 * for an Organization (the operator's, or a registration's) is routed to one, by the approval mode
 * captured on it. Records the routing, the reason and the Organization's id — never the tax ID.
 */
export function requestRouteCommand(input: {
  readonly requestId: string;
  readonly expectedVersion: number;
  readonly decision: RoutingDecision;
}): Command<RelatedPayerRequest> {
  return {
    action: 'related_payers.request.route',
    objectType: OBJECT_TYPE,
    objectId: input.requestId,
    async run({ em }) {
      const request = await loadRequest(em, input.requestId);
      if (request.state !== 'pending' || request.version !== input.expectedVersion) {
        throw new HttpError(409, ERROR_CODES.RELATED_PAYER_REQUEST_DECIDED, 'This request has already been decided.');
      }
      const before = { routing: request.routing, operatorReason: request.operatorReason };
      request.counterpartyOrganizationId = input.decision.counterpartyOrganizationId;
      request.routing = input.decision.routing;
      request.operatorReason = input.decision.operatorReason;
      // An invitation to register is used up once the request has its Organization (FR-044).
      request.invitationTokenHash = null;
      request.version += 1;
      await em.flush();
      return {
        result: request,
        before,
        after: {
          routing: request.routing,
          operatorReason: request.operatorReason,
          counterpartyOrganizationId: request.counterpartyOrganizationId,
        },
      };
    },
    outboxData: requestOutbox,
  };
}

/** The sha-256 of an invitation token, as stored (`related_payer_requests.invitation_token_hash`). */
export function invitationTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * `related_payers.invitation.send` — US5 (FR-044): a request naming a tax ID no Organization holds
 * is turned into an invitation to register. Issues a fresh token — the row keeps its hash, the
 * caller e-mails the token — and moves the request to `awaiting_registration`.
 *
 * `from: 'routing'` — the request was created in `invite` mode and is already awaiting
 * registration; a token already issued is refused `409` so a redelivered outbox row sends nothing
 * twice. `from: 'operator'` — the operator's *Send invitation* on a queue entry with no Organization.
 */
export function invitationSendCommand(input: {
  readonly requestId: string;
  readonly from: 'routing' | 'operator';
}): Command<{ request: RelatedPayerRequest; token: string }> {
  return {
    action: 'related_payers.invitation.send',
    objectType: OBJECT_TYPE,
    objectId: input.requestId,
    async run({ em }) {
      const request = await loadRequest(em, input.requestId);
      const sendable =
        request.state === 'pending' &&
        !request.counterpartyOrganizationId &&
        (input.from === 'routing'
          ? request.routing === 'awaiting_registration' && !request.invitationTokenHash
          : request.routing === 'operator');
      if (!sendable) {
        throw new HttpError(409, ERROR_CODES.RELATED_PAYER_REQUEST_DECIDED, 'This request cannot be sent an invitation.');
      }
      const before = { routing: request.routing };
      const token = randomBytes(32).toString('base64url');
      request.invitationTokenHash = invitationTokenHash(token);
      request.routing = 'awaiting_registration';
      request.operatorReason = null;
      request.version += 1;
      await em.flush();
      return { result: { request, token }, before, after: { routing: 'awaiting_registration' } };
    },
  };
}
