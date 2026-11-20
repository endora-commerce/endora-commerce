import type { EntityManager } from '@mikro-orm/postgresql';
import {
  organizationCompanyTaxId,
  RELATED_PAYERS_ORGANIZATION_PERMISSIONS as P,
  type AdminNotificationRecordPort,
  type CustomerAccountReadPort,
  type CustomerAccountRecord,
  type CustomerNotificationRecordPort,
  type OrganizationDetailsPort,
  type OrganizationPermissionPort,
  type RelatedPayerRequestOutbox,
  type RelatedPayerRevokedByKind,
  type TransactionalEmailSender,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { RelatedPayerLink } from '../entities/related-payer-link.entity.js';
import { RelatedPayerRequest } from '../entities/related-payer-request.entity.js';
import {
  RELATED_PAYER_LINK_REVOKED_EMAIL_CODE,
  RELATED_PAYER_REQUEST_DECIDED_EMAIL_CODE,
  RELATED_PAYER_REQUEST_EXPIRED_EMAIL_CODE,
  RELATED_PAYER_REQUEST_RECEIVED_EMAIL_CODE,
} from '../email-templates/request-defaults.js';
import { RELATED_PAYER_INVITATION_RECEIVED_EMAIL_CODE } from '../email-templates/invitation-defaults.js';

/** Where the account's *Payers* screen is, storefront-relative (no locale prefix). */
export const PAYERS_ACCOUNT_PATH = '/payers';
/** Where the operator queue is, admin-relative. */
export const OPERATOR_QUEUE_PATH = '/related-payers/requests';

export interface RequestNotificationDeps {
  readonly emFactory: () => EntityManager;
  readonly organizations: Pick<OrganizationDetailsPort, 'findByIds'>;
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'listByOrganization'>;
  readonly permissions: Pick<OrganizationPermissionPort, 'rolesHolding'>;
  /** `transactional_emails`' late-bound sender; `undefined` until announced. */
  readonly sender: () => TransactionalEmailSender | undefined;
  /** The store's language for a channel, or the default store's for `null` (RP-17 d). */
  readonly language: (salesChannelId: string | null) => Promise<string>;
  /** The storefront notification centre, `null` while `customer_notifications` is absent. */
  readonly centre: () => CustomerNotificationRecordPort | null;
  /** The admin bell, `null` while `admin_notifications` is absent. */
  readonly bell: () => AdminNotificationRecordPort | null;
  readonly log: (message: string, context: Record<string, unknown>) => void;
}

/** What the outbox row recorded at commit: the routing and state the delivery acts on. */
export type CommittedRequest = Pick<RelatedPayerRequestOutbox, 'routing' | 'state'>;

type Recipient = Pick<CustomerAccountRecord, 'id' | 'email' | 'organizationId'>;

/**
 * `specs/182-related-payers/` T081 (FR-025, FR-042, FR-045, FR-050) — what the request and link
 * Commands' after-commit outbox rows deliver: the counterparty's approvers hear of a request; the
 * sender's requester and payer managers of its decision; the operators of a new queue entry; the
 * other side of a revoked link. Read under the drain's system scope; every party is re-read here,
 * so the outbox row carries ids and codes only.
 *
 * A message that does not go out is logged, never raised: the outbox row is the claim, and a
 * failed e-mail retried would also repeat the ones that went out (the payer-order e-mails'
 * precedent). A module switched off underneath is the one thing raised, so the row is retried.
 */
export class RelatedPayerRequestNotifications {
  constructor(private readonly deps: RequestNotificationDeps) {}

  /**
   * `request.create` committed (FR-042, FR-025), and `request.route` (US5: the request found its
   * Organization after it was created — assigned by the operator, or attached on registration): the counterparty, or the operators — as the
   * request was routed **at its commit** (`committed`, the outbox row's data), not as it is when
   * the row is delivered: a request Y accepted meanwhile is the acceptance's to announce.
   */
  async requestCreated(requestId: string, committed: CommittedRequest): Promise<void> {
    const request = await this.deps.emFactory().findOne(RelatedPayerRequest, { id: requestId });
    if (!request || request.state !== 'pending') return;
    if (committed.routing === 'operator') return this.#queued(request);
    if (committed.routing !== 'counterparty' || !request.counterpartyOrganizationId) return;
    const approving = request.direction === 'buyer_request' ? P.APPROVE : P.MANAGE;
    const recipients = await this.#holders(request.counterpartyOrganizationId, approving);
    const orgs = await this.#organizations([request.organizationId, request.counterpartyOrganizationId]);
    const sender = orgs.get(request.organizationId);
    const counterparty = orgs.get(request.counterpartyOrganizationId);
    const senderName = sender?.name ?? '';
    const senderTaxId = sender ? (organizationCompanyTaxId(sender) ?? '') : '';
    // US6 — a payer's invitation reaches the buyer's payer managers, worded for that direction.
    const invitation = request.direction === 'payer_invitation';
    await this.#email(
      invitation ? RELATED_PAYER_INVITATION_RECEIVED_EMAIL_CODE : RELATED_PAYER_REQUEST_RECEIVED_EMAIL_CODE,
      recipients,
      request.salesChannelId,
      `request:${request.id}`,
      {
        variables: invitation
          ? { sender: { name: senderName, taxId: senderTaxId }, buyer: { name: counterparty?.name ?? '' } }
          : { sender: { name: senderName, taxId: senderTaxId }, payer: { name: counterparty?.name ?? '' } },
        meta: { requestId: request.id },
      },
    );
    await this.#centre(recipients, {
      kind: invitation ? 'related_payers.invitation_received' : 'related_payers.request_received',
      subjectType: 'related_payer_request',
      subjectId: request.id,
      salesChannelId: request.salesChannelId,
      title: invitation ? `${senderName} offers to pay for your orders` : `${senderName} asks you to pay for its orders`,
      titleMessage: {
        scope: 'related_payers',
        key: invitation ? 'notifications.invitationReceived.title' : 'notifications.requestReceived.title',
        params: { sender: senderName },
      },
    });
  }

  /**
   * `request.accept` / `request.reject` committed (FR-045): a decision tells the sender's
   * requester and payer managers; an acceptance that moved the request to the operator's second
   * step tells the operators instead.
   */
  async requestDecided(requestId: string, committed: CommittedRequest): Promise<void> {
    const request = await this.deps.emFactory().findOne(RelatedPayerRequest, { id: requestId });
    if (!request) return;
    if (committed.state === 'pending') {
      if (committed.routing === 'operator' && request.state === 'pending') await this.#queued(request);
      return;
    }
    if (committed.state !== 'active' && committed.state !== 'rejected') return;
    const managing = request.direction === 'buyer_request' ? P.MANAGE : P.APPROVE;
    const [holders, members] = await Promise.all([
      this.#holders(request.organizationId, managing),
      this.#members(request.organizationId),
    ]);
    const requester = members.find((m) => m.id === request.senderCustomerAccountId);
    const recipients = unique([...(requester ? [requester] : []), ...holders]);
    const sender = (await this.#organizations([request.organizationId])).get(request.organizationId);
    await this.#email(RELATED_PAYER_REQUEST_DECIDED_EMAIL_CODE, recipients, request.salesChannelId, `request:${request.id}`, {
      variables: { buyer: { name: sender?.name ?? '' }, request: { taxId: request.taxIdNormalized } },
      meta: { requestId: request.id },
    });
    await this.#centre(recipients, {
      kind: 'related_payers.request_decided',
      subjectType: 'related_payer_request',
      subjectId: request.id,
      salesChannelId: request.salesChannelId,
      title: `Your payer request for tax ID ${request.taxIdNormalized} has been decided`,
      titleMessage: { scope: 'related_payers', key: 'notifications.requestDecided.title', params: { taxId: request.taxIdNormalized } },
    });
  }

  /**
   * `request.expire` committed (RP-20 c): the member who sent it — and only that member — hears
   * that it expired undecided. A withdrawal has no outbox row and tells nobody.
   */
  async requestExpired(requestId: string, committed: CommittedRequest): Promise<void> {
    if (committed.state !== 'expired') return;
    const request = await this.deps.emFactory().findOne(RelatedPayerRequest, { id: requestId });
    if (!request || request.state !== 'expired') return;
    const requester = (await this.#members(request.organizationId)).filter((m) => m.id === request.senderCustomerAccountId);
    const sender = (await this.#organizations([request.organizationId])).get(request.organizationId);
    await this.#email(RELATED_PAYER_REQUEST_EXPIRED_EMAIL_CODE, requester, request.salesChannelId, `request:${request.id}`, {
      variables: { buyer: { name: sender?.name ?? '' }, request: { taxId: request.taxIdNormalized } },
      meta: { requestId: request.id },
    });
    await this.#centre(requester, {
      kind: 'related_payers.request_expired',
      subjectType: 'related_payer_request',
      subjectId: request.id,
      salesChannelId: request.salesChannelId,
      title: `Your payer request for tax ID ${request.taxIdNormalized} has expired`,
      titleMessage: { scope: 'related_payers', key: 'notifications.requestExpired.title', params: { taxId: request.taxIdNormalized } },
    });
  }

  /** `link.revoke` committed (FR-050): the other side; both, when the operator or the port revoked. */
  async linkRevoked(linkId: string, revokedByKind: RelatedPayerRevokedByKind): Promise<void> {
    const link = await this.deps.emFactory().findOne(RelatedPayerLink, { id: linkId });
    if (!link || link.state !== 'revoked') return;
    const tellBuyer = revokedByKind !== 'buyer';
    const tellPayer = revokedByKind !== 'payer';
    const recipients = unique([
      ...(tellBuyer ? await this.#holders(link.organizationId, P.MANAGE) : []),
      ...(tellPayer ? await this.#holders(link.payerOrganizationId, P.APPROVE) : []),
    ]);
    const orgs = await this.#organizations([link.organizationId, link.payerOrganizationId]);
    const buyerName = orgs.get(link.organizationId)?.name ?? '';
    const payerName = orgs.get(link.payerOrganizationId)?.name ?? '';
    await this.#email(RELATED_PAYER_LINK_REVOKED_EMAIL_CODE, recipients, null, `link:${link.id}`, {
      variables: { buyer: { name: buyerName }, payer: { name: payerName } },
      meta: { linkId: link.id },
    });
    await this.#centre(recipients, {
      kind: 'related_payers.link_revoked',
      subjectType: 'related_payer_link',
      subjectId: link.id,
      salesChannelId: null,
      title: `${payerName} no longer pays for orders of ${buyerName}`,
      titleMessage: { scope: 'related_payers', key: 'notifications.linkRevoked.title', params: { payer: payerName, buyer: buyerName } },
    });
  }

  /** FR-025 — one bell entry for every operator, per request that enters the queue. */
  async #queued(request: RelatedPayerRequest): Promise<void> {
    const bell = this.deps.bell();
    if (!bell) return;
    await bell.record({
      audience: 'all_admins',
      kind: 'related_payers.request_queued',
      subjectType: 'related_payer_request',
      subjectId: request.id,
      title: 'A payer request waits for an operator decision',
      titleMessage: { scope: 'related_payers', key: 'notifications.requestQueued.title' },
      linkPath: OPERATOR_QUEUE_PATH,
    });
  }

  async #members(organizationId: string): Promise<CustomerAccountRecord[]> {
    const members = await this.deps.customerAccounts.listByOrganization(organizationId, { activeOnly: true });
    return members.filter((m) => m.blockedAt === null && m.anonymizedAt === null && m.email !== '');
  }

  /** Active members whose role holds `code` (the `rolesHolding` precedent, research R-10). */
  async #holders(organizationId: string, code: string): Promise<CustomerAccountRecord[]> {
    const [members, roles] = await Promise.all([this.#members(organizationId), this.deps.permissions.rolesHolding(organizationId, code)]);
    return members.filter((m) => roles.includes(m.organizationRoleId));
  }

  async #organizations(ids: string[]) {
    return new Map((await this.deps.organizations.findByIds([...new Set(ids)])).map((o) => [o.id, o]));
  }

  async #email(
    code: string,
    recipients: readonly Recipient[],
    salesChannelId: string | null,
    subjectKey: string,
    message: { variables: Record<string, unknown>; meta: Record<string, string> },
  ): Promise<void> {
    if (recipients.length === 0) return;
    const language = await this.deps.language(salesChannelId);
    for (const recipient of recipients) {
      const sender = this.deps.sender();
      if (!sender) return this.deps.log('[related_payers] an e-mail was not sent', { code, reason: 'no_sender' });
      try {
        const outcome = await sender.send({
          code,
          salesChannelId,
          language,
          to: recipient.email,
          messageId: `${code}:${subjectKey}:${recipient.id}`,
          variables: message.variables,
          meta: { kind: code, ...message.meta },
        });
        if (outcome.status !== 'sent') {
          this.deps.log('[related_payers] an e-mail was not sent', { code, recipientId: recipient.id, reason: outcome.status });
        }
      } catch (error) {
        if (error instanceof ModuleDisabledError) throw error;
        this.deps.log('[related_payers] an e-mail was not sent', {
          code,
          recipientId: recipient.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async #centre(
    recipients: readonly Recipient[],
    entry: {
      kind: string;
      subjectType: string;
      subjectId: string;
      salesChannelId: string | null;
      title: string;
      titleMessage: { scope: string; key: string; params?: Record<string, string> };
    },
  ): Promise<void> {
    const centre = this.deps.centre();
    if (!centre) return;
    for (const recipient of recipients) {
      await centre.record({
        organizationId: recipient.organizationId,
        customerAccountId: recipient.id,
        salesChannelId: entry.salesChannelId,
        sourceModule: 'related_payers',
        // Unique per producer: a redelivered outbox row answers the entry already recorded.
        sourceKey: `${entry.kind}:${entry.subjectId}:${recipient.id}`,
        kind: entry.kind,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        title: entry.title,
        titleMessage: entry.titleMessage,
        linkPath: PAYERS_ACCOUNT_PATH,
      });
    }
  }
}

function unique<T extends { id: string }>(items: readonly T[]): T[] {
  return [...new Map(items.map((i) => [i.id, i])).values()];
}
