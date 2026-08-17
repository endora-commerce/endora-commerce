import { z } from 'zod';

/**
 * The `email` module's published contract (D-59, issue #114).
 *
 * The delivery recorder lives here rather than in the module because a second
 * module reads it: `transactional_emails` decides `suppressed` above the
 * transport and records that decision itself, so the shape is a boundary and
 * not an internal. Feature 075 FR-001 — a type-only reach into another module's
 * `services/` is still a reach.
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
