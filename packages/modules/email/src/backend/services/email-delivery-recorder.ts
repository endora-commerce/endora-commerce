import type { EntityManager } from '@mikro-orm/postgresql';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import type { EmailDeliveryRecordInput, EmailDeliveryRecorder } from '@endora-commerce/contracts';
import { EmailDelivery } from '../entities/email-delivery.entity.js';

/**
 * Where the delivery record is written (D-59, issue #114).
 *
 * One row per delivery decision, written after the decision — never before,
 * because a row that exists before a send was attempted is the `pending` state
 * of the outbox D-58 refused, one queue hop from the same problem.
 */

// The shapes below are published in `packages/contracts/src/email.ts`: a
// second module (`transactional_emails`) decides `suppressed` above the
// transport and records it, so they are a boundary rather than an internal.
// Re-exported here so this file stays the one place a reader looks for the
// recorder.
export type {
  EmailDeliveryReason,
  EmailDeliveryRecordInput,
  EmailDeliveryRecorder,
  EmailDeliveryStatus,
} from '@endora-commerce/contracts';

/** Where a record that could not be written is reported. Injectable for tests. */
export type EmailDeliveryLog = (message: string, context: Record<string, unknown>) => void;

export class PersistentEmailDeliveryRecorder implements EmailDeliveryRecorder {
  private readonly log: EmailDeliveryLog;

  constructor(
    private readonly emFactory: () => EntityManager,
    log?: EmailDeliveryLog,
  ) {
    this.log = log ?? ((message, context): void => console.warn(message, context));
  }

  async record(input: EmailDeliveryRecordInput): Promise<string | null> {
    // command-coverage-ignore: bookkeeping about a message that has already been
    // sent or suppressed — there is no domain state here to undo, and the write
    // that triggered the message is audited where it happened.
    try {
      const em = this.emFactory();
      const row = em.create(EmailDelivery, {
        messageId: input.messageId,
        recipient: input.recipient,
        kind: input.kind,
        status: input.status,
        attemptedAt: new Date(),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.detail !== undefined ? { detail: input.detail.slice(0, 4000) } : {}),
        ...(input.subject !== undefined ? { subject: input.subject.slice(0, 998) } : {}),
        ...(input.salesChannelId !== undefined ? { salesChannelId: input.salesChannelId } : {}),
        ...(input.documentType !== undefined ? { documentType: input.documentType } : {}),
        ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
        ...(input.context !== undefined ? { context: input.context } : {}),
      });
      await em.persistAndFlush(row);
      return row.id;
    } catch (error) {
      // A switched-off module is a presence answer and travels: this recorder is
      // reached across a module boundary, and flattening a 503 into "the record
      // was not written" would turn fail-closed into fail-open for the caller.
      rethrowIfModuleDisabled(error);
      // Everything else is contained, and this is the narrow tolerance the
      // ordering in `RecordingMailer` depends on: the message has already left
      // (or already been suppressed), so a bookkeeping failure must cost the
      // record and nothing else. It is named rather than silent.
      this.log('[email] the delivery record was not written', {
        messageId: input.messageId,
        status: input.status,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }
}
