import type {
  EmailMailerPort,
  EmailMailerSendInput,
  EmailMailerSendOutcome,
  EmailMailerSuppressionReason,
} from '@endora-commerce/contracts';

/**
 * Mailer abstraction (T136 + T178 helper).
 *
 * Every send is idempotent on the message id supplied by the caller — that
 * lets retry loops re-send the same template without duplicating mail.
 *
 * The default `ConsoleMailer` writes to stdout so dev environments work
 * without an SMTP server. Production composition wires a real SMTP
 * transport (e.g. via nodemailer) by implementing this interface.
 *
 * The four shapes moved to `@endora-commerce/contracts` in feature 075's Phase P —
 * thirty-two sites across eight modules named them at this path, and D-59's
 * `MailerSendOutcome` is read one layer up by `transactional_emails`. They are
 * aliased back here so the drivers below and the consumers Phase C has not
 * reached yet keep compiling; the aliases go with the last of those consumers.
 */

export type MailerSendInput = EmailMailerSendInput;

export type MailerSuppressionReason = EmailMailerSuppressionReason;

export type MailerSendOutcome = EmailMailerSendOutcome;

export type Mailer = EmailMailerPort;

export class ConsoleMailer implements Mailer {
  private readonly seen = new Set<string>();

  async send(input: MailerSendInput): Promise<MailerSendOutcome> {
    if (this.seen.has(input.messageId)) return { status: 'suppressed', reason: 'duplicate_message_id' };
    this.seen.add(input.messageId);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        msg: 'console-mailer',
        to: input.to,
        subject: input.subject,
        body: input.text,
        meta: input.meta,
      }),
    );
    return { status: 'sent' };
  }
}

/**
 * In-memory mailer for tests. Captures every sent message; tests assert
 * against `sent`.
 */
export class InMemoryMailer implements Mailer {
  readonly sent: MailerSendInput[] = [];

  async send(input: MailerSendInput): Promise<MailerSendOutcome> {
    this.sent.push(input);
    return { status: 'sent' };
  }
}
