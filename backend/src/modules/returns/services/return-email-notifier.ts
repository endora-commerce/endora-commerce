import type { Mailer } from '../../email/services/mailer.js';
import type { ReturnCase } from '../entities/return-case.entity.js';
import type { ReturnNotifier } from './return-authorization-service.js';
import { buildReturnAuthorizedEmail } from '../email-templates/return-authorized.js';
import { buildReturnRejectedEmail } from '../email-templates/return-rejected.js';

/** Resolves a customer account's email address (injected to avoid importing
 *  the customer_accounts module's internals into returns). */
export type CustomerEmailResolver = (customerAccountId: string) => Promise<string | null>;

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
  ) {}

  async authorized(rc: ReturnCase): Promise<void> {
    if (!rc.rmaNumber) return;
    const to = await this.resolveCustomerEmail(rc.customerAccountId);
    if (!to) return;
    await this.mailer.send(
      buildReturnAuthorizedEmail({ to, rmaNumber: rc.rmaNumber, returnCaseId: rc.id }),
    );
  }

  async rejected(rc: ReturnCase): Promise<void> {
    const to = await this.resolveCustomerEmail(rc.customerAccountId);
    if (!to) return;
    await this.mailer.send(
      buildReturnRejectedEmail({ to, reason: rc.rejectionReason ?? '', returnCaseId: rc.id }),
    );
  }
}
