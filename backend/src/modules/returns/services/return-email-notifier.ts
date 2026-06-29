import type { Mailer } from '../../email/services/mailer.js';
import type { TransactionalEmailSender } from '@b2b/contracts';
import type { ReturnCase } from '../entities/return-case.entity.js';
import type { ReturnNotifier } from './return-authorization-service.js';
import { buildReturnAuthorizedEmail } from '../email-templates/return-authorized.js';
import { buildReturnRejectedEmail } from '../email-templates/return-rejected.js';

/** Resolves a customer account's email address (injected to avoid importing
 *  the customer_accounts module's internals into returns). */
export type CustomerEmailResolver = (customerAccountId: string) => Promise<string | null>;

/** Feature 047 — optional transactional-email wiring (admin-editable templates). */
export interface ReturnNotifierEmailOptions {
  getTransactionalEmailSender?: () => TransactionalEmailSender | undefined;
  resolveLanguage?: (salesChannelId: string) => Promise<string>;
}

/**
 * ReturnEmailNotifier — feature 046 (US2, FR-017).
 *
 * Sends the authorize / reject notifications through the platform Mailer.
 * Best-effort: the caller (`ReturnAuthorizationService`) already wraps these in
 * a try/catch so a mail failure never blocks the workflow transition.
 */
export class ReturnEmailNotifier implements ReturnNotifier {
  constructor(
    private readonly mailer: Mailer,
    private readonly resolveCustomerEmail: CustomerEmailResolver,
    private readonly emailOptions: ReturnNotifierEmailOptions = {},
  ) {}

  private async language(salesChannelId: string): Promise<string> {
    if (!this.emailOptions.resolveLanguage) return 'en-US';
    try {
      return await this.emailOptions.resolveLanguage(salesChannelId);
    } catch {
      return 'en-US';
    }
  }

  async authorized(rc: ReturnCase): Promise<void> {
    if (!rc.rmaNumber) return;
    const to = await this.resolveCustomerEmail(rc.customerAccountId);
    if (!to) return;
    const sender = this.emailOptions.getTransactionalEmailSender?.();
    if (sender) {
      await sender.send({
        code: 'return_authorized',
        salesChannelId: rc.salesChannelId,
        language: await this.language(rc.salesChannelId),
        to,
        messageId: `return_authorized:${rc.id}`,
        variables: { rmaNumber: rc.rmaNumber, returnCaseId: rc.id },
        meta: { returnCaseId: rc.id, kind: 'return_authorized' },
      });
      return;
    }
    await this.mailer.send(
      buildReturnAuthorizedEmail({ to, rmaNumber: rc.rmaNumber, returnCaseId: rc.id }),
    );
  }

  async rejected(rc: ReturnCase): Promise<void> {
    const to = await this.resolveCustomerEmail(rc.customerAccountId);
    if (!to) return;
    const sender = this.emailOptions.getTransactionalEmailSender?.();
    if (sender) {
      await sender.send({
        code: 'return_rejected',
        salesChannelId: rc.salesChannelId,
        language: await this.language(rc.salesChannelId),
        to,
        messageId: `return_rejected:${rc.id}`,
        variables: { reason: rc.rejectionReason ?? '', returnCaseId: rc.id },
        meta: { returnCaseId: rc.id, kind: 'return_rejected' },
      });
      return;
    }
    await this.mailer.send(
      buildReturnRejectedEmail({ to, reason: rc.rejectionReason ?? '', returnCaseId: rc.id }),
    );
  }
}
