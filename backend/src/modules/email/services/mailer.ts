/**
 * Mailer abstraction (T136 + T178 helper).
 *
 * Every send is idempotent on the message id supplied by the caller — that
 * lets retry loops re-send the same template without duplicating mail.
 *
 * The default `ConsoleMailer` writes to stdout so dev environments work
 * without an SMTP server. Production composition wires a real SMTP
 * transport (e.g. via nodemailer) by implementing this interface.
 */

export interface MailerSendInput {
  /** Stable id, idempotency key for retries. */
  messageId: string;
  to: string;
  subject: string;
  /** Plain-text body (always present; the readable alternative for HTML mail). */
  text: string;
  /** Optional HTML body (feature 047). When present, sent as multipart alternative. */
  html?: string;
  /** Optional structured payload retained alongside the email for audit. */
  meta?: Record<string, unknown>;
}

export interface Mailer {
  send(input: MailerSendInput): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  private readonly seen = new Set<string>();

  async send(input: MailerSendInput): Promise<void> {
    if (this.seen.has(input.messageId)) return;
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
  }
}

/**
 * In-memory mailer for tests. Captures every sent message; tests assert
 * against `sent`.
 */
export class InMemoryMailer implements Mailer {
  readonly sent: MailerSendInput[] = [];

  async send(input: MailerSendInput): Promise<void> {
    this.sent.push(input);
  }
}
