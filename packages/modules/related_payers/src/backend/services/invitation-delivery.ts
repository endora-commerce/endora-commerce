import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrganizationDetailsPort, TransactionalEmailSender } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { RelatedPayerRequest } from '../entities/related-payer-request.entity.js';
import { invitationSendCommand, invitationTokenHash } from '../commands/request-commands.js';
import { RELATED_PAYER_INVITATION_TO_REGISTER_EMAIL_CODE } from '../email-templates/invitation-defaults.js';

/** Where the storefront registration page is, storefront-relative; the token rides as `?payerInvitation=`. */
export const REGISTRATION_PATH = '/register';
export const INVITATION_QUERY_KEY = 'payerInvitation';

export interface InvitationDeliveryDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly organizations: Pick<OrganizationDetailsPort, 'findByIds'>;
  /** `transactional_emails`' late-bound sender; `undefined` until announced. */
  readonly sender: () => TransactionalEmailSender | undefined;
  /** The channel's default language: the invitation is written in it (US5-3). */
  readonly language: (salesChannelId: string) => Promise<string>;
  /** The absolute storefront origin of a channel, no trailing slash. */
  readonly storefrontOrigin: (salesChannelId: string) => Promise<string>;
  /** The capability on a channel (FR-002): an invitation of a channel where it is off is not found. */
  readonly channelEnabled: (salesChannelId: string) => Promise<boolean>;
  readonly now?: () => Date;
  readonly log: (message: string, context: Record<string, unknown>) => void;
}

/**
 * `specs/182-related-payers/` US5 (FR-044) — the invitation to register that a request naming a tax
 * ID no Organization holds turns into: under `invite` when it is created (from the outbox, after
 * commit, so the sender's reply never waits on it — FR-041), or when the operator sends it from the
 * queue. The token is issued by the `invitation.send` Command, which stores its hash only; the raw
 * token exists in memory here and in the e-mail's link, which pre-fills the tax ID on the
 * registration form. Nothing is created from an invitation: attaching the request waits for an
 * Organization with that tax ID to be approved (`RelatedPayerRequestService.attachRegistered`).
 */
export class RelatedPayerInvitationDelivery {
  constructor(private readonly deps: InvitationDeliveryDeps) {}

  /**
   * Issues the token and e-mails the contact. `routing` — an `invite`-mode request just committed;
   * a token already issued (a redelivered outbox row) sends nothing. `operator` — the queue's
   * action, refused `409` when the request is not one waiting for an Organization.
   */
  async send(requestId: string, from: 'routing' | 'operator'): Promise<void> {
    let issued: { request: RelatedPayerRequest; token: string };
    try {
      issued = await this.deps.commandBus.run(invitationSendCommand({ requestId, from }));
    } catch (error) {
      if (from === 'routing' && (error as { statusCode?: number }).statusCode === 409) return;
      throw error;
    }
    const { request, token } = issued;
    const sender = this.deps.sender();
    if (!sender) {
      this.deps.log('[related_payers] an invitation e-mail was not sent', { requestId, reason: 'no_sender' });
      return;
    }
    const [inviting] = await this.deps.organizations.findByIds([request.organizationId]);
    const origin = await this.deps.storefrontOrigin(request.salesChannelId);
    const url = `${origin}${REGISTRATION_PATH}?${INVITATION_QUERY_KEY}=${encodeURIComponent(token)}`;
    try {
      const outcome = await sender.send({
        code: RELATED_PAYER_INVITATION_TO_REGISTER_EMAIL_CODE,
        salesChannelId: request.salesChannelId,
        language: await this.deps.language(request.salesChannelId),
        to: request.contactEmail,
        // One message per token: a re-sent invitation is a new one.
        messageId: `${RELATED_PAYER_INVITATION_TO_REGISTER_EMAIL_CODE}:request:${request.id}:${invitationTokenHash(token).slice(0, 16)}`,
        variables: {
          sender: { name: inviting?.name ?? '' },
          request: { taxId: request.taxIdNormalized },
          registration: { url },
        },
        meta: { kind: RELATED_PAYER_INVITATION_TO_REGISTER_EMAIL_CODE, requestId: request.id },
      });
      if (outcome.status !== 'sent') {
        this.deps.log('[related_payers] an invitation e-mail was not sent', { requestId, reason: outcome.status });
      }
    } catch (error) {
      if (error instanceof ModuleDisabledError) throw error;
      this.deps.log('[related_payers] an invitation e-mail was not sent', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * `GET /api/v1/related-payers/invitations/:token` (T092) — the tax ID a live invitation names, for
   * the registration form; `null` for a token unknown, used up (the request found its Organization
   * or was decided) or expired, and for a channel where the capability is off.
   */
  async lookup(token: string): Promise<{ taxId: string } | null> {
    if (token.length < 16 || token.length > 128) return null;
    const request = await this.deps.emFactory().findOne(RelatedPayerRequest, { invitationTokenHash: invitationTokenHash(token) });
    const now = this.deps.now?.() ?? new Date();
    if (!request || request.state !== 'pending' || request.routing !== 'awaiting_registration' || request.expiresAt <= now) return null;
    if (!(await this.deps.channelEnabled(request.salesChannelId))) return null;
    return { taxId: request.taxIdNormalized };
  }
}
