import { z } from 'zod';

/**
 * The `email` module's published contract (D-59, issue #114; extended by
 * feature 075's Phase P).
 *
 * `email` owns no route, no entity and no worker: it is two registrations —
 * the platform's outbound transport, and the durable record of what became of
 * each message that left through it.
 *
 * The delivery recorder lives here rather than in the module because a second
 * module reads it: `transactional_emails` decides `suppressed` above the
 * transport and records that decision itself, so the shape is a boundary and
 * not an internal. Feature 075 FR-001 — a type-only reach into another
 * module's `services/` is still a reach.
 *
 * `EmailMailerPort` joins it for the same reason at a larger scale:
 * thirty-two import sites across eight modules named `Mailer` /
 * `MailerSendInput` at `email/services/mailer.ts`, which makes it the single
 * largest contract in the sweep and the one with the smallest surface — two
 * shapes and one method.
 */

/** What became of one outbound message. */
export const emailDeliveryStatusSchema = z.enum(['sent', 'suppressed', 'failed']);
export type EmailDeliveryStatus = z.infer<typeof emailDeliveryStatusSchema>;

/**
 * Why a recorded message did not go out; absent for a delivered one.
 *
 * The split down the middle is the load-bearing part: the first two are the
 * platform deliberately not sending, the last three are a message that was
 * meant to go out and did not. An operator reading the record has to be able to
 * tell a configuration from an outage, and since feature 074 shipped per-e-mail
 * deactivation, "not sent" stopped being the same as "broken".
 */
export const emailDeliveryReasonSchema = z.enum([
  /** Suppressed: the operator switched this e-mail off. */
  'deactivated',
  /** Suppressed: the transport had already accepted this message id. */
  'duplicate_message_id',
  /** Failed: the transport raised. */
  'transport_error',
  /** Failed: no transport is wired in this composition. */
  'no_transport',
  /** Failed: no template exists for this code. */
  'no_definition',
]);
export type EmailDeliveryReason = z.infer<typeof emailDeliveryReasonSchema>;

export interface EmailDeliveryRecordInput {
  messageId: string;
  recipient: string;
  kind: string;
  status: EmailDeliveryStatus;
  reason?: EmailDeliveryReason;
  detail?: string;
  subject?: string;
  salesChannelId?: string | null;
  documentType?: string;
  documentId?: string;
  context?: Record<string, unknown>;
}

/**
 * **Never throws.** That is the contract, not an implementation detail: every
 * caller reaches this after a message has already been handed to a transport or
 * already been suppressed, so a failure here can only lose the record — it must
 * never be able to lose, or appear to lose, the send. A caller therefore needs
 * no `catch`, which is also what keeps a bare one from growing around a port.
 *
 * Answers the row id, or `null` when the row could not be written.
 */
export interface EmailDeliveryRecorder {
  record(input: EmailDeliveryRecordInput): Promise<string | null>;
}

// --- ports -------------------------------------------------------------------
//
// Plain TypeScript rather than Zod from here down: these describe in-process
// calls, not an API boundary.

export interface EmailAttachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
}

export interface EmailMailerSendInput {
  /** Stable id, idempotency key for retries. Every send is idempotent on it. */
  messageId: string;
  to: string;
  subject: string;
  /** Plain-text body (always present; the readable alternative for HTML mail). */
  text: string;
  /** Optional HTML body (feature 047). When present, sent as multipart alternative. */
  html?: string;
  /** Optional binary attachments (feature 047 invoices — PDF delivery). */
  attachments?: EmailAttachment[];
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
export type EmailMailerSuppressionReason = 'duplicate_message_id';

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
export type EmailMailerSendOutcome =
  /** Handed to the transport. */
  | { status: 'sent' }
  /** The transport deliberately did not send it. */
  | { status: 'suppressed'; reason: EmailMailerSuppressionReason };

/**
 * Container name: `emailMailer`. Owner: `email`.
 *
 * **Registered with `ctx.di.register`, not `providePort`, and that is
 * deliberate.** `email`'s manifest declares it non-deactivatable — it is the
 * transport every message leaves through, and a business configures a driver
 * rather than switching the transport off — so a gate on its effective state
 * could never close. Feature 075 does not change that registration; a port
 * whose gate is unreachable would advertise a failure mode the platform cannot
 * produce. (`auth` is also non-deactivatable and does use `providePort`; the
 * two differ because `auth` had already made that call for `requireAdmin`, and
 * one answer per module beats one answer per repository.)
 *
 * The driver decision — SMTP when the environment configures one, console
 * otherwise — belongs to the module and is not part of this contract, and
 * neither does the delivery record: `EmailDeliveryRecorder` above is a
 * separate registration because `transactional_emails` writes to it without
 * going through the transport at all.
 */
export interface EmailMailerPort {
  send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome>;
}
