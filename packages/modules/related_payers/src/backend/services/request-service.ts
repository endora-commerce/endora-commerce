import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  normalizeTaxId,
  organizationCompanyTaxId,
  RELATED_PAYERS_ORGANIZATION_PERMISSIONS as P,
  type AdminRelatedPayerRequest,
  type AdminRelatedPayerRequestsQuery,
  type CreateRelatedPayerRequestBody,
  type CustomerAccountReadPort,
  type OrganizationDetailsPort,
  type OrganizationPermissionPort,
  type RelatedPayerApprovalMode,
  type RelatedPayerIncomingRequest,
  type RelatedPayerRequestDirection,
  type RelatedPayerSentRequest,
  type RelatedPayerUnregisteredMode,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { RelatedPayerLink } from '../entities/related-payer-link.entity.js';
import { RelatedPayerRequest } from '../entities/related-payer-request.entity.js';
import {
  requestAcceptCommand,
  requestCreateCommand,
  requestRejectCommand,
  requestRouteCommand,
  requestWithdrawCommand,
} from '../commands/request-commands.js';
import { assertWithinDailyLimit, dailyWindowStart } from './daily-limit.js';
import { routeRequest } from './request-routing.js';

/** What a request is created under: the channel's modes and limits, read once (FR-043, FR-046). */
export interface RequestChannelSettings {
  readonly approvalMode: RelatedPayerApprovalMode;
  readonly unregisteredMode: RelatedPayerUnregisteredMode;
  readonly ttlDays: number;
  readonly dailyLimit: number;
}

export interface RequestServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly organizations: Pick<OrganizationDetailsPort, 'findByTaxId' | 'findByIds'>;
  readonly permissions: Pick<OrganizationPermissionPort, 'rolesHolding'>;
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'listByOrganization'>;
  readonly settings: (salesChannelId: string) => Promise<RequestChannelSettings>;
  /** The store's time zone, which "today" of the daily limit starts in (FR-046). */
  readonly timeZone: () => Promise<string>;
  readonly now?: () => Date;
  /** After a link was created from a request: drop the buyer's cached links (research R-9). */
  readonly onLinksChanged: (buyerOrganizationId: string) => Promise<void>;
}

/** The queue's page when the caller names no `pageSize` — its cap before it was paged. */
const UNPAGED_QUEUE_LIMIT = 500;

export interface RequestSender {
  readonly organizationId: string;
  readonly customerAccountId: string;
  readonly salesChannelId: string;
  readonly language: string;
}

/**
 * `specs/182-related-payers/` FR-040 – FR-047 — payer requests and their decisions, for the
 * customer routes. The reply to a sender never depends on what the tax ID matched (FR-041):
 * {@link create} answers the sender's own row id whatever the routing.
 */
export class RelatedPayerRequestService {
  constructor(private readonly deps: RequestServiceDeps) {}

  /** FR-040, FR-046 — the limit first, then the lookup, then the route; one reply. */
  async create(
    sender: RequestSender,
    body: CreateRelatedPayerRequestBody,
    direction: RelatedPayerRequestDirection = 'buyer_request',
  ): Promise<{ id: string; state: 'pending' }> {
    const settings = await this.deps.settings(sender.salesChannelId);
    const now = this.deps.now?.() ?? new Date();
    const since = dailyWindowStart(now, await this.deps.timeZone());
    const sentToday = await this.deps
      .emFactory()
      .count(RelatedPayerRequest, { organizationId: sender.organizationId, createdAt: { $gte: since } });
    assertWithinDailyLimit(sentToday, settings.dailyLimit);

    const decision = await withSystemScope('related_payers: route a payer request', async () => {
      const found = await this.deps.organizations.findByTaxId(body.taxId);
      return this.#route(
        { direction, organizationId: sender.organizationId, approvalMode: settings.approvalMode, unregisteredMode: settings.unregisteredMode },
        found.filter((o) => o.id !== sender.organizationId),
      );
    });

    const request = await this.deps.commandBus.run(
      requestCreateCommand({
        senderOrganizationId: sender.organizationId,
        senderCustomerAccountId: sender.customerAccountId,
        direction,
        taxIdNormalized: body.taxId,
        contactEmail: body.contactEmail,
        comment: body.comment ?? null,
        decision,
        approvalMode: settings.approvalMode,
        unregisteredMode: settings.unregisteredMode,
        salesChannelId: sender.salesChannelId,
        language: sender.language,
        expiresAt: new Date(now.getTime() + settings.ttlDays * 86_400_000),
      }),
    );
    return { id: request.id, state: 'pending' };
  }

  /** FR-041, FR-047 — the sender's view: no counterparty, routing or operator reason. */
  async listSent(
    organizationId: string,
    direction: RelatedPayerRequestDirection = 'buyer_request',
  ): Promise<RelatedPayerSentRequest[]> {
    const rows = await this.deps
      .emFactory()
      .find(RelatedPayerRequest, { organizationId, direction }, { orderBy: { createdAt: 'desc', id: 'desc' } });
    return rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      taxId: r.taxIdNormalized,
      contactEmail: r.contactEmail,
      comment: r.comment ?? null,
      state: r.state,
      rejectionReason: r.rejectionReason ?? null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  /** FR-042, FR-047 — the requests waiting for this Organization to decide. */
  async listIncoming(
    organizationId: string,
    directions: readonly RelatedPayerRequestDirection[],
  ): Promise<RelatedPayerIncomingRequest[]> {
    if (directions.length === 0) return [];
    return withSystemScope('related_payers: requests awaiting the counterparty', async () => {
      const rows = await this.deps.emFactory().find(
        RelatedPayerRequest,
        { counterpartyOrganizationId: organizationId, routing: 'counterparty', state: 'pending', direction: { $in: [...directions] } },
        { orderBy: { createdAt: 'desc', id: 'desc' } },
      );
      const senders = new Map(
        (await this.deps.organizations.findByIds([...new Set(rows.map((r) => r.organizationId))])).map((o) => [o.id, o]),
      );
      return rows.map((r) => ({
        id: r.id,
        direction: r.direction,
        senderOrganizationId: r.organizationId,
        senderName: senders.get(r.organizationId)?.name ?? '',
        senderTaxId: senders.get(r.organizationId)?.taxId ?? null,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
      }));
    });
  }

  /** FR-045 — the counterparty accepts; the link is created on the buyer's terms. */
  async acceptIncoming(
    organizationId: string,
    deciderId: string,
    requestId: string,
    directions: readonly RelatedPayerRequestDirection[] = ['buyer_request'],
  ): Promise<void> {
    const request = await this.#incoming(organizationId, requestId, directions);
    const { request: decided, linkId } = await withSystemScope('related_payers: decide a payer request', () =>
      this.deps.commandBus.run(
        requestAcceptCommand({ requestId, expectedVersion: request.version, step: 'counterparty', deciderId }),
      ),
    );
    if (linkId) await this.deps.onLinksChanged(decided.direction === 'buyer_request' ? decided.organizationId : organizationId);
  }

  /** FR-045 — the counterparty rejects, with an optional reason shown to the sender. */
  async rejectIncoming(
    organizationId: string,
    deciderId: string,
    requestId: string,
    reason: string | null,
    directions: readonly RelatedPayerRequestDirection[] = ['buyer_request'],
  ): Promise<void> {
    const request = await this.#incoming(organizationId, requestId, directions);
    await withSystemScope('related_payers: decide a payer request', () =>
      this.deps.commandBus.run(
        requestRejectCommand({ requestId, expectedVersion: request.version, step: 'counterparty', deciderId, reason }),
      ),
    );
  }

  /** FR-045 — the sender withdraws its own pending request. */
  async withdraw(
    organizationId: string,
    senderCustomerAccountId: string,
    requestId: string,
    direction: RelatedPayerRequestDirection = 'buyer_request',
  ): Promise<void> {
    const request = await this.deps.emFactory().findOne(RelatedPayerRequest, { id: requestId, organizationId, direction });
    if (!request) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Request not found.');
    await this.deps.commandBus.run(
      requestWithdrawCommand({ requestId, expectedVersion: request.version, senderCustomerAccountId }),
    );
  }

  /**
   * FR-023 — the operator queue: requests routed to an operator, `pending` unless asked for
   * another state, oldest first. Read in the operator's own reach (the ambient filter on the
   * sender), with everything the sender never sees. One page of it and the total across every
   * page (UX audit DS-05, #1439); `id` breaks a `createdAt` tie, or a page boundary could repeat
   * a row and skip another. Without a `pageSize` the page is the first 500, the queue's old cap.
   */
  async listQueue(
    query: AdminRelatedPayerRequestsQuery,
  ): Promise<{ rows: AdminRelatedPayerRequest[]; page: number; pageSize: number; total: number }> {
    const pageSize = query.pageSize ?? UNPAGED_QUEUE_LIMIT;
    const page = query.pageSize === undefined ? 1 : query.page;
    const [rows, total] = await this.deps.emFactory().findAndCount(
      RelatedPayerRequest,
      {
        routing: 'operator',
        state: query.state ?? 'pending',
        ...(query.reason ? { operatorReason: query.reason } : {}),
        ...(query.salesChannelId ? { salesChannelId: query.salesChannelId } : {}),
      },
      { orderBy: { createdAt: 'asc', id: 'asc' }, offset: (page - 1) * pageSize, limit: pageSize },
    );
    const ids = [...new Set(rows.flatMap((r) => [r.organizationId, ...(r.counterpartyOrganizationId ? [r.counterpartyOrganizationId] : [])]))];
    const orgs = new Map((ids.length ? await this.deps.organizations.findByIds(ids) : []).map((o) => [o.id, o]));
    // FR-023 — a pending entry with no Organization yet lists the ones its tax ID matches now: two
    // for an ambiguous tax ID, or one that registered since.
    const candidates = new Map<string, Array<{ organizationId: string; name: string }>>();
    for (const r of rows) {
      if (r.state === 'pending' && !r.counterpartyOrganizationId) {
        candidates.set(r.id, (await this.#candidates(r)).map((o) => ({ organizationId: o.id, name: o.name })));
      }
    }
    const listed = rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      taxId: r.taxIdNormalized,
      contactEmail: r.contactEmail,
      comment: r.comment ?? null,
      state: r.state,
      rejectionReason: r.rejectionReason ?? null,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
      senderOrganizationId: r.organizationId,
      senderName: orgs.get(r.organizationId)?.name ?? '',
      counterpartyOrganizationId: r.counterpartyOrganizationId ?? null,
      counterpartyName: r.counterpartyOrganizationId ? (orgs.get(r.counterpartyOrganizationId)?.name ?? '') : null,
      routing: r.routing,
      operatorReason: r.operatorReason ?? null,
      approvalMode: r.approvalMode,
      unregisteredMode: r.unregisteredMode,
      salesChannelId: r.salesChannelId,
      counterpartyAcceptedAt: r.counterpartyAcceptedAt?.toISOString() ?? null,
      candidates: candidates.get(r.id) ?? [],
    }));
    return { rows: listed, page, pageSize, total };
  }

  /** FR-023 — the operator approves a queued request: the link, on the buyer's terms. */
  async operatorApprove(adminUserId: string, requestId: string): Promise<void> {
    const request = await this.#queued(requestId);
    if (request.state === 'pending' && !request.counterpartyOrganizationId) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Choose the organization this request names before approving it.');
    }
    const { request: decided, linkId } = await this.deps.commandBus.run(
      requestAcceptCommand({ requestId, expectedVersion: request.version, step: 'operator', deciderId: adminUserId }),
    );
    if (linkId) {
      await this.deps.onLinksChanged(decided.direction === 'buyer_request' ? decided.organizationId : decided.counterpartyOrganizationId!);
    }
  }

  /** FR-023 — the operator rejects; the reason is shown to the sender. */
  async operatorReject(adminUserId: string, requestId: string, reason: string): Promise<void> {
    const request = await this.#queued(requestId);
    await this.deps.commandBus.run(
      requestRejectCommand({ requestId, expectedVersion: request.version, step: 'operator', deciderId: adminUserId, reason }),
    );
  }

  /**
   * FR-023 (US5, T087) — the operator names the Organization a queued request means: one its tax
   * ID matches now. The request is routed by the approval mode captured when it was created, and
   * its new routing is announced from the outbox (`request.route`).
   */
  async operatorAssign(requestId: string, organizationId: string): Promise<void> {
    const request = await this.#unresolved(requestId);
    const candidate = (await this.#candidates(request)).find((o) => o.id === organizationId);
    if (!candidate) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Choose one of the organizations the request\'s tax ID names.');
    }
    const decision = await withSystemScope('related_payers: route a payer request', () => this.#route(request, [candidate]));
    await this.deps.commandBus.run(requestRouteCommand({ requestId, expectedVersion: request.version, decision }));
  }

  /**
   * FR-023, US5-2 — the counterparty had no account: the operator creates it (`create`, the
   * organization create), approved, with the tax ID the request named, and approves the request
   * naming it — the link, on the buyer's terms.
   */
  async operatorCreateOrganization(
    adminUserId: string,
    requestId: string,
    taxId: string,
    create: () => Promise<{ id: string }>,
  ): Promise<{ organizationId: string; linkId: string }> {
    const request = await this.#unresolved(requestId);
    if (normalizeTaxId(taxId) !== request.taxIdNormalized) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The new organization must have the tax ID the request names.');
    }
    const created = await create();
    const { request: decided, linkId } = await this.deps.commandBus.run(
      requestAcceptCommand({
        requestId,
        expectedVersion: request.version,
        step: 'operator',
        deciderId: adminUserId,
        assignCounterpartyOrganizationId: created.id,
      }),
    );
    await this.deps.onLinksChanged(decided.direction === 'buyer_request' ? decided.organizationId : created.id);
    return { organizationId: created.id, linkId: linkId! };
  }

  /**
   * FR-044, US5-4 — an Organization became `active` (its registration approved): every pending
   * request still awaiting the registration of its tax ID is routed to it by its captured approval
   * mode. An expired one is not pending, so it attaches nothing (US5-5).
   */
  async attachRegistered(organizationId: string): Promise<number> {
    const [org] = await this.deps.organizations.findByIds([organizationId]);
    const taxId = org ? organizationCompanyTaxId(org) : null;
    if (!org || org.status !== 'active' || org.isPersonal || !taxId) return 0;
    const waiting = await this.deps.emFactory().find(RelatedPayerRequest, {
      taxIdNormalized: normalizeTaxId(taxId),
      routing: 'awaiting_registration',
      state: 'pending',
      expiresAt: { $gt: this.deps.now?.() ?? new Date() },
      organizationId: { $ne: organizationId },
    });
    let attached = 0;
    for (const request of waiting) {
      const decision = await this.#route(request, [org]);
      try {
        await this.deps.commandBus.run(requestRouteCommand({ requestId: request.id, expectedVersion: request.version, decision }));
        attached += 1;
      } catch (error) {
        // Decided or withdrawn in between: nothing to attach.
        if ((error as { statusCode?: number }).statusCode !== 409) throw error;
      }
    }
    return attached;
  }

  /** The queue's invitation action asks first: a request it may invite for, or `404` / `409`. */
  async assertUnresolved(requestId: string): Promise<void> {
    await this.#unresolved(requestId);
  }

  /** A pending request waiting for the operator with no Organization named, or `404`; decided — `409`. */
  async #unresolved(requestId: string): Promise<RelatedPayerRequest> {
    const request = await this.#queued(requestId);
    if (request.state !== 'pending') {
      throw new HttpError(409, ERROR_CODES.RELATED_PAYER_REQUEST_DECIDED, 'This request has already been decided.');
    }
    if (request.counterpartyOrganizationId) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Request not found.');
    return request;
  }

  /** The Organizations a request's tax ID matches now, the sender excluded. */
  async #candidates(request: RelatedPayerRequest) {
    const found = await withSystemScope('related_payers: organizations a payer request names', () =>
      this.deps.organizations.findByTaxId(request.taxIdNormalized),
    );
    return found.filter((o) => o.id !== request.organizationId);
  }

  /**
   * FR-043, FR-044 — where a request goes, given the Organizations its tax ID matches: each judged
   * eligible (active, a company, not already linked to the sender in this direction), and the one
   * eligible match asked whether it has an approver. Run under a system scope by the caller.
   */
  async #route(
    request: Pick<RelatedPayerRequest, 'direction' | 'organizationId' | 'approvalMode' | 'unregisteredMode'>,
    candidates: ReadonlyArray<{ id: string; status: string; isPersonal: boolean }>,
  ) {
    const buyerSide = request.direction === 'buyer_request';
    const live = candidates.length
      ? await this.deps.emFactory().find(RelatedPayerLink, {
          state: { $ne: 'revoked' },
          ...(buyerSide
            ? { organizationId: request.organizationId, payerOrganizationId: { $in: candidates.map((c) => c.id) } }
            : { payerOrganizationId: request.organizationId, organizationId: { $in: candidates.map((c) => c.id) } }),
        })
      : [];
    const linked = new Set(live.map((l) => (buyerSide ? l.payerOrganizationId : l.organizationId)));
    const matches = candidates.map((c) => ({
      organizationId: c.id,
      eligible: c.status === 'active' && !c.isPersonal && !linked.has(c.id),
    }));
    const single = matches.length === 1 && matches[0]!.eligible ? matches[0]!.organizationId : null;
    const hasEligibleApprover = single ? (await this.#approvers(single, buyerSide ? P.APPROVE : P.MANAGE)).length > 0 : false;
    return routeRequest({
      approvalMode: request.approvalMode,
      unregisteredMode: request.unregisteredMode,
      matches,
      hasEligibleApprover,
    });
  }

  /**
   * A request in the operator's reach that is the operator's to decide, or `404` exactly as a
   * missing one. A decided one is found, and loses with `409`.
   */
  async #queued(requestId: string): Promise<RelatedPayerRequest> {
    const request = await this.deps.emFactory().findOne(RelatedPayerRequest, { id: requestId });
    if (!request || (request.state === 'pending' && request.routing !== 'operator')) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Request not found.');
    }
    return request;
  }

  /**
   * A request this Organization may decide as counterparty, or `404` exactly as a request that
   * does not exist (FR-047, Principle XI). A decided one is found, and loses with `409`.
   */
  async #incoming(
    organizationId: string,
    requestId: string,
    directions: readonly RelatedPayerRequestDirection[],
  ): Promise<RelatedPayerRequest> {
    const request = await withSystemScope('related_payers: a request awaiting the counterparty', () =>
      this.deps.emFactory().findOne(RelatedPayerRequest, { id: requestId, counterpartyOrganizationId: organizationId }),
    );
    // US6 — a request to pay is the payer's approvers' to decide, an invitation from a payer the
    // buyer's payer managers': a member holding only the other permission finds nothing.
    if (!request || !directions.includes(request.direction) || (request.state === 'pending' && request.routing !== 'counterparty')) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Request not found.');
    }
    return request;
  }

  /** FR-042, FR-043 — the counterparty's active members holding the approving permission. */
  async #approvers(organizationId: string, code: string) {
    const [members, roles] = await Promise.all([
      this.deps.customerAccounts.listByOrganization(organizationId, { activeOnly: true }),
      this.deps.permissions.rolesHolding(organizationId, code),
    ]);
    return members.filter(
      (m) => roles.includes(m.organizationRoleId) && m.blockedAt === null && m.anonymizedAt === null && m.email !== '',
    );
  }
}
