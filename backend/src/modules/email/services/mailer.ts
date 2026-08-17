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
  /** Optional binary attachments (feature 047 invoices — PDF delivery). */
  attachments?: Array<{ filename: string; content: Uint8Array; contentType?: string }>;
  /**
   * What this message is — the transactional-email code, or a legacy in-code
   * builder's own name for it (D-59). Absent, the delivery record falls back to
   * `meta.kind`, which every in-code builder in the tree already carries.
   */
  kind?: string;
  /**
   * The business document this message delivers, when it delivers one (D-59).
   * An invoice e-mail is the case the ruling was written for: the record has to
   * be findable by the document an operator is asked about, not only by a
   * recipient and a message id.
   */
  document?: { type: string; id: string };
  /** The channel the message was rendered for, or `null` for the platform-wide one. */
  salesChannelId?: string | null;
  /** Optional structured payload retained alongside the email for audit. */
  meta?: Record<string, unknown>;
}

/**
 * Why a transport did not send a message it was handed, without failing (D-59).
 *
 * Today there is one: a driver that deduplicates on `messageId` and has already
 * accepted this one. The union exists so a second reason arrives as a value the
 * delivery record already knows how to hold, rather than as a boolean nobody
 * can interpret.
 */
export type MailerSuppressionReason = 'duplicate_message_id';

/**
 * What one transport call did with one message (D-59, issue #114).
 *
 * `send` answered `void`, so the layer that actually hands a message to SMTP
 * was the one layer in the send path with nothing to say — while
 * `TransactionalSendOutcome` and `OrderEmailResult`, computed above it, both
 * distinguish a delivered message from a suppressed one. That is the gap this
 * type closes, and the delivery record is what makes the answer outlive a log
 * rotation.
 *
 * **A transport failure still throws.** Unchanged deliberately: every caller
 * already contains its own send failure after a committed write, and turning
 * the throw into a value would silently retire those tolerances. So this union
 * enumerates the ways a message can fail to go out *without* an error, exactly
 * as `TransactionalSendOutcome` does one layer up.
 */
export type MailerSendOutcome =
  /** Handed to the transport. */
  | { status: 'sent' }
  /** The transport deliberately did not send it. */
  | { status: 'suppressed'; reason: MailerSuppressionReason };

export interface Mailer {
  send(input: MailerSendInput): Promise<MailerSendOutcome>;
}

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
