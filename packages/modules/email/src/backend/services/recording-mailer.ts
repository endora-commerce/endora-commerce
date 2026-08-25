import type { Mailer, MailerSendInput, MailerSendOutcome } from './mailer.js';
import type { EmailDeliveryRecorder, EmailDeliveryRecordInput } from './email-delivery-recorder.js';

/**
 * The mailer every sending module resolves: a driver plus its delivery record
 * (D-59, issue #114).
 *
 * A decorator rather than a line in each of the seventeen call sites, for the
 * reason `providePort`'s gate is a wrapper rather than a call: a record the
 * transport seam writes cannot be forgotten by the module somebody adds next
 * month, and a hand-placed one demonstrably was — that is how "did the customer
 * get the invoice" ended up answerable only from a log.
 *
 * **Ordering, which is the part with a wrong answer.** The transport is called
 * first and the record written after it, in both directions:
 *
 *   - a send that succeeded is recorded, and if that write fails the recorder
 *     answers `null` (it never throws) so the caller still sees `sent` — the
 *     message did leave, and reporting otherwise would be a lie that could
 *     trigger a resend;
 *   - a send that raised is recorded as `failed` and the error is **re-thrown
 *     unchanged**, so every caller's own tolerance keeps deciding what a failed
 *     message means for the operation it followed.
 *
 * The other order — record first, then send — is the outbox D-58 refused: it
 * buys atomicity between a business write and an enqueue that nothing here
 * promises, and it costs a row that claims a message was attempted before
 * anything was.
 */
export class RecordingMailer implements Mailer {
  constructor(
    private readonly transport: Mailer,
    private readonly recorder: EmailDeliveryRecorder,
  ) {}

  async send(input: MailerSendInput): Promise<MailerSendOutcome> {
    let outcome: MailerSendOutcome;
    try {
      outcome = await this.transport.send(input);
    } catch (error) {
      await this.recorder.record({
        ...contextOf(input),
        status: 'failed',
        reason: 'transport_error',
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    await this.recorder.record({
      ...contextOf(input),
      ...(outcome.status === 'sent'
        ? { status: 'sent' as const }
        : { status: 'suppressed' as const, reason: outcome.reason }),
    });
    return outcome;
  }
}

/**
 * What the row keeps about the message itself.
 *
 * `kind` falls back to `meta.kind` because that convention predates this record
 * — ten in-code builders already write it — so the fallback covers them without
 * ten edits, and `unspecified` is reserved for a sender that names itself
 * nowhere at all.
 */
function contextOf(input: MailerSendInput): Omit<EmailDeliveryRecordInput, 'status'> {
  const metaKind = input.meta?.['kind'];
  return {
    messageId: input.messageId,
    recipient: input.to,
    kind: input.kind ?? (typeof metaKind === 'string' ? metaKind : 'unspecified'),
    subject: input.subject,
    ...(input.salesChannelId !== undefined ? { salesChannelId: input.salesChannelId } : {}),
    ...(input.document ? { documentType: input.document.type, documentId: input.document.id } : {}),
    ...(input.meta ? { context: input.meta } : {}),
  };
}
