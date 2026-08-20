import type { EmailMailerPort, TransactionalEmailSender } from '@b2b/contracts';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import type { ReturnCase } from '../entities/return-case.entity.js';
import type { ReturnNotifier } from './return-authorization-service.js';
import { buildReturnAuthorizedEmail } from '../email-templates/return-authorized.js';
import { buildReturnRejectedEmail } from '../email-templates/return-rejected.js';

/** Resolves a customer account's email address (injected to avoid importing
 *  the customer_accounts module's internals into returns). */
export type CustomerEmailResolver = (customerAccountId: string) => Promise<string | null>;

/**
 * Why the authorize / reject e-mail did — or did not — go out (issue #78).
 *
 * Both methods answered `void`, and reaching the transactional sender counted
 * as done: they returned right after the send whatever it reported, so a
 * deactivated template, a transport-less composition and a code with no
 * definition were indistinguishable from a delivered message — and from the
 * legacy-builder path, which is the only one that put an e-mail anywhere in
 * those cases.
 */
export type ReturnEmailNotSentReason =
  /** The case carries no RMA number, so there is no authorization to announce. */
  | 'no_rma'
  /** No address resolves for the case's customer account. */
  | 'no_recipient'
  /** The operator switched this return e-mail off. */
  | 'deactivated'
  /** No mailer is wired behind the sender. */
  | 'no_transport'
  /** No template exists for this code yet. */
  | 'no_definition'
  /**
   * The transport itself declined to send (D-59) — today, an already-accepted
   * `messageId`, so an earlier call delivered the message and this one did not.
   */
  | 'suppressed'
  /** The send raised, and the workflow transition stays applied. */
  | 'failed';

export type ReturnEmailResult = { sent: true } | { sent: false; reason: ReturnEmailNotSentReason };

/**
 * Where a send that did not happen is reported. Injectable so a test can read
 * it; defaults to `console.warn`, which is what the rest of this layer uses.
 */
export type ReturnEmailLog = (message: string, context: Record<string, unknown>) => void;

/** Feature 047 — optional transactional-email wiring (admin-editable templates). */
export interface ReturnNotifierEmailOptions {
  getTransactionalEmailSender?: () => TransactionalEmailSender | undefined;
  resolveLanguage?: (salesChannelId: string) => Promise<string>;
  log?: ReturnEmailLog;
}

/**
 * ReturnEmailNotifier — feature 046 (US2, FR-017).
 *
 * Sends the authorize / reject notifications through the platform Mailer.
 * Best-effort: the caller (`ReturnAuthorizationService`) already wraps these in
 * a try/catch so a mail failure never blocks the workflow transition — which is
 * exactly why every non-sent path is written to the log here as well as named
 * in the result. That caller discards the result, so the log is what an
 * operator has; a direct caller and the tests read the result.
 *
 * **Which message goes out is unchanged.** The legacy in-code builder still
 * runs only when no sender is wired at all, including when the sender answers
 * `no_definition` — where `templateEmailPort` would fall back. Making returns
 * fall back too is a decision about what mail a client receives, not a
 * reporting repair, so it is named here and in the result rather than slipped
 * in: the reason reaches the log, and nothing is sent silently.
 */
export class ReturnEmailNotifier implements ReturnNotifier {
  private readonly log: ReturnEmailLog;

  constructor(
    private readonly mailer: EmailMailerPort,
    private readonly resolveCustomerEmail: CustomerEmailResolver,
    private readonly emailOptions: ReturnNotifierEmailOptions = {},
  ) {
    this.log = emailOptions.log ?? ((message, context): void => console.warn(message, context));
  }

  private async language(salesChannelId: string): Promise<string> {
    if (!this.emailOptions.resolveLanguage) return 'en-US';
    try {
      return await this.emailOptions.resolveLanguage(salesChannelId);
    } catch {
      return 'en-US';
    }
  }

  async authorized(rc: ReturnCase): Promise<ReturnEmailResult> {
    const kind = 'return_authorized';
    if (!rc.rmaNumber) return this.notSent(rc, kind, 'no_rma');
    const to = await this.resolveCustomerEmail(rc.customerAccountId);
    if (!to) return this.notSent(rc, kind, 'no_recipient');
    const rmaNumber = rc.rmaNumber;
    const sender = this.emailOptions.getTransactionalEmailSender?.();
    try {
      if (sender) {
        const outcome = await sender.send({
          code: kind,
          salesChannelId: rc.salesChannelId,
          language: await this.language(rc.salesChannelId),
          to,
          messageId: `${kind}:${rc.id}`,
          variables: { rmaNumber, returnCaseId: rc.id },
          meta: { returnCaseId: rc.id, kind },
        });
        if (outcome.status !== 'sent') return this.notSent(rc, kind, outcome.status);
        return { sent: true };
      }
      const outcome = await this.mailer.send(
        buildReturnAuthorizedEmail({ to, rmaNumber, returnCaseId: rc.id }),
      );
      if (outcome.status !== 'sent') return this.notSent(rc, kind, 'suppressed');
      return { sent: true };
    } catch (error) {
      return this.contained(rc, kind, error);
    }
  }

  async rejected(rc: ReturnCase): Promise<ReturnEmailResult> {
    const kind = 'return_rejected';
    const to = await this.resolveCustomerEmail(rc.customerAccountId);
    if (!to) return this.notSent(rc, kind, 'no_recipient');
    const reason = rc.rejectionReason ?? '';
    const sender = this.emailOptions.getTransactionalEmailSender?.();
    try {
      if (sender) {
        const outcome = await sender.send({
          code: kind,
          salesChannelId: rc.salesChannelId,
          language: await this.language(rc.salesChannelId),
          to,
          messageId: `${kind}:${rc.id}`,
          variables: { reason, returnCaseId: rc.id },
          meta: { returnCaseId: rc.id, kind },
        });
        if (outcome.status !== 'sent') return this.notSent(rc, kind, outcome.status);
        return { sent: true };
      }
      const outcome = await this.mailer.send(
        buildReturnRejectedEmail({ to, reason, returnCaseId: rc.id }),
      );
      if (outcome.status !== 'sent') return this.notSent(rc, kind, 'suppressed');
      return { sent: true };
    } catch (error) {
      return this.contained(rc, kind, error);
    }
  }

  /**
   * The tolerance the workflow transition needs, narrowed to what it is for.
   *
   * A switched-off module is a presence answer about the whole operation rather
   * than one message that failed to render, so it travels on. Everything else
   * is contained: the return case has already moved to its new status and must
   * not move back because the customer could not be told.
   */
  private contained(rc: ReturnCase, kind: string, error: unknown): ReturnEmailResult {
    rethrowIfModuleDisabled(error);
    return this.notSent(rc, kind, 'failed', error);
  }

  private notSent(
    rc: ReturnCase,
    kind: string,
    reason: ReturnEmailNotSentReason,
    error?: unknown,
  ): ReturnEmailResult {
    this.log('[returns] the return e-mail was not sent', {
      returnCaseId: rc.id,
      kind,
      reason,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : error }),
    });
    return { sent: false, reason };
  }
}
