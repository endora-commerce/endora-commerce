// Issue #1295 — the e-mail an operator triggers with **Reset password** on the
// admin customer screen (`POST /api/v1/admin/customers/:id/password-reset`).
//
// It is an admin-editable transactional e-mail, sent through `transactional_emails`'
// `templateEmailPort`. The plain mailer below is reached only when that port
// answers `false` — no definition for the code, or no sender composed — because
// a reset link that silently fails to go out is worse than one in English.

import type {
  EmailMailerPort,
  EmailMailerSendOutcome,
  TemplateEmailPort,
} from '@endora-commerce/contracts';

/** The code this module declares in its manifest's `transactionalEmails`. */
export const ADMIN_PASSWORD_RESET_EMAIL_CODE = 'customer_password_reset_by_admin';

export interface AdminPasswordResetEmailDeps {
  /** Absent: no template sender is composed, and the plain mailer sends. */
  templateEmail?: TemplateEmailPort | undefined;
  mailer: EmailMailerPort;
}

export interface AdminPasswordResetEmailInput {
  customerId: string;
  to: string;
  messageId: string;
  /** The storefront reset page, already under {@link language}'s URL prefix. */
  resetUrl: string;
  /**
   * The language the link was composed for — the channel's default language —
   * so the message and the page it opens agree. `null`: the channel decides.
   */
  language: string | null;
}

export type AdminPasswordResetEmailOutcome =
  | { via: 'template' }
  | { via: 'mailer'; outcome: EmailMailerSendOutcome };

export async function sendAdminPasswordResetEmail(
  deps: AdminPasswordResetEmailDeps,
  input: AdminPasswordResetEmailInput,
): Promise<AdminPasswordResetEmailOutcome> {
  const meta = { customerAccountId: input.customerId };
  const handled = deps.templateEmail
    ? await deps.templateEmail.trySend({
        code: ADMIN_PASSWORD_RESET_EMAIL_CODE,
        to: input.to,
        messageId: input.messageId,
        variables: { resetUrl: input.resetUrl },
        meta,
        ...(input.language ? { language: input.language } : {}),
      })
    : false;
  if (handled) return { via: 'template' };

  // The `no_definition` tier: English, which the owner ruling of 2026-09-01
  // makes every module's default.
  const outcome = await deps.mailer.send({
    messageId: input.messageId,
    to: input.to,
    subject: 'Set a new password',
    text: `An administrator started a password reset for your account. Set a new password here: ${input.resetUrl}`,
    kind: 'admin_password_reset',
    meta,
  });
  return { via: 'mailer', outcome };
}
