// Issue #1371 — the e-mail a customer asks for on the storefront's *Forgot
// password* page (`POST /api/v1/auth/password-reset/request`).
//
// The route minted a token and answered 202, and nothing mailed the link, so a
// customer who forgot the password had no way back into the account from the
// storefront. It is an admin-editable transactional e-mail now, sent through
// `transactional_emails`' `templateEmailPort`; the plain mailer below is
// reached only when that port answers `false` — no definition for the code, or
// no sender composed — because a reset link that silently fails to go out is
// worse than one in English.
//
// A separate code from `customers`' `customer_password_reset_by_admin`
// (issue #1295): the customer started this one, and the copy says so.

import type { EmailMailerPort, EmailMailerSendOutcome } from '@endora-commerce/contracts';
import type { OrgTemplateEmail } from './org-template-email.js';

/** The code this module declares in its manifest's `transactionalEmails`. */
export const PASSWORD_RESET_EMAIL_CODE = 'customer_password_reset';

export interface PasswordResetEmailDeps {
  /** Absent: no template sender is composed, and the plain mailer sends. */
  templateEmail?: OrgTemplateEmail | undefined;
  mailer: EmailMailerPort;
}

export interface PasswordResetEmailInput {
  /**
   * The account's address — the folded form the reset lookup matched, never
   * the address as typed, so a look-alike that folds onto an account cannot
   * have that account's link mailed to itself.
   */
  to: string;
  messageId: string;
  /** The storefront reset page, already under {@link language}'s URL prefix. */
  resetUrl: string;
  /** The channel the request came through; `null`: the system-default one. */
  salesChannelId: string | null;
  /**
   * The channel language the link was composed for, so the message and the
   * page it opens agree. `null`: the channel decides.
   */
  language: string | null;
}

export type PasswordResetEmailOutcome =
  | { via: 'template' }
  | { via: 'mailer'; outcome: EmailMailerSendOutcome };

export async function sendPasswordResetEmail(
  deps: PasswordResetEmailDeps,
  input: PasswordResetEmailInput,
): Promise<PasswordResetEmailOutcome> {
  const handled = deps.templateEmail
    ? await deps.templateEmail.trySend({
        code: PASSWORD_RESET_EMAIL_CODE,
        to: input.to,
        messageId: input.messageId,
        variables: { resetUrl: input.resetUrl },
        ...(input.salesChannelId ? { salesChannelId: input.salesChannelId } : {}),
        ...(input.language ? { language: input.language } : {}),
      })
    : false;
  if (handled) return { via: 'template' };

  // The `no_definition` tier: English, which the owner ruling of 2026-09-01
  // makes every module's default.
  const outcome = await deps.mailer.send({
    messageId: input.messageId,
    to: input.to,
    subject: 'Reset your password',
    text:
      'We received a request to reset the password of your account. ' +
      `Set a new password here: ${input.resetUrl}\n\n` +
      'If you did not ask for this, you can ignore this message — your current password stays unchanged.',
    kind: 'password_reset',
  });
  return { via: 'mailer', outcome };
}
