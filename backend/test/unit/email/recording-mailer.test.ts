import { describe, expect, it } from 'vitest';
import type { Mailer, MailerSendInput, MailerSendOutcome } from '../../../src/modules/email/services/mailer.js';
import { RecordingMailer } from '../../../src/modules/email/services/recording-mailer.js';
import type {
  EmailDeliveryRecorder,
  EmailDeliveryRecordInput,
} from '../../../src/modules/email/services/email-delivery-recorder.js';

/**
 * D-59 — every transport call leaves a durable row, and the row says which of
 * the three things happened: the message went out, the platform deliberately
 * did not send it, or the send failed.
 *
 * The ordering assertion is the load-bearing one. The record is written
 * **after** the transport call and can never change its outcome: a bookkeeping
 * failure must not cost a send, and a send that raised must still raise for the
 * caller whose tolerance decides what that means.
 */

class StubRecorder implements EmailDeliveryRecorder {
  readonly rows: EmailDeliveryRecordInput[] = [];
  constructor(private readonly id: string | null = 'row-1') {}
  async record(input: EmailDeliveryRecordInput): Promise<string | null> {
    this.rows.push(input);
    return this.id;
  }
}

const MESSAGE: MailerSendInput = {
  messageId: 'invoice_issued:abc',
  to: 'buyer@example.com',
  subject: 'Invoice FV 1/2026',
  text: 'Your invoice',
  kind: 'invoice_issued',
  salesChannelId: '00000000-0000-0000-0000-0000000000aa',
  document: { type: 'invoice', id: 'ffffffff-0000-4000-8000-000000000001' },
  meta: { kind: 'invoice_issued', invoiceId: 'ffffffff-0000-4000-8000-000000000001' },
};

function transport(outcome: MailerSendOutcome): Mailer {
  return { async send(): Promise<MailerSendOutcome> { return outcome; } };
}

describe('email — the delivery record (D-59)', () => {
  it('records one sent row carrying the recipient, the kind and the document', async () => {
    const recorder = new StubRecorder();
    const mailer = new RecordingMailer(transport({ status: 'sent' }), recorder);

    await expect(mailer.send(MESSAGE)).resolves.toEqual({ status: 'sent' });

    expect(recorder.rows).toHaveLength(1);
    expect(recorder.rows[0]).toMatchObject({
      messageId: 'invoice_issued:abc',
      recipient: 'buyer@example.com',
      kind: 'invoice_issued',
      status: 'sent',
      subject: 'Invoice FV 1/2026',
      documentType: 'invoice',
      documentId: 'ffffffff-0000-4000-8000-000000000001',
      salesChannelId: '00000000-0000-0000-0000-0000000000aa',
    });
    expect(recorder.rows[0]?.reason).toBeUndefined();
  });

  it('records a transport suppression as suppressed, never as failed', async () => {
    const recorder = new StubRecorder();
    const mailer = new RecordingMailer(
      transport({ status: 'suppressed', reason: 'duplicate_message_id' }),
      recorder,
    );

    await expect(mailer.send(MESSAGE)).resolves.toEqual({
      status: 'suppressed',
      reason: 'duplicate_message_id',
    });
    expect(recorder.rows[0]).toMatchObject({
      status: 'suppressed',
      reason: 'duplicate_message_id',
    });
  });

  it('records a failed row and still raises for the caller', async () => {
    const recorder = new StubRecorder();
    const mailer = new RecordingMailer(
      {
        async send(): Promise<MailerSendOutcome> {
          throw new Error('smtp down');
        },
      },
      recorder,
    );

    await expect(mailer.send(MESSAGE)).rejects.toThrow('smtp down');
    expect(recorder.rows).toHaveLength(1);
    expect(recorder.rows[0]).toMatchObject({ status: 'failed', reason: 'transport_error' });
    expect(recorder.rows[0]?.detail).toContain('smtp down');
  });

  it('falls back to the meta kind every legacy in-code builder already carries', async () => {
    const recorder = new StubRecorder();
    const mailer = new RecordingMailer(transport({ status: 'sent' }), recorder);

    await mailer.send({
      messageId: 'return_authorized:1',
      to: 'buyer@example.com',
      subject: 'Return authorised',
      text: 'ok',
      meta: { returnCaseId: 'rc-1', kind: 'return_authorized' },
    });

    expect(recorder.rows[0]).toMatchObject({ kind: 'return_authorized' });
  });

  it('does not lose the send when the record cannot be written', async () => {
    // The recorder answers `null` for a row it could not persist — the
    // contained failure D-59 requires, proved from the mailer's side.
    const mailer = new RecordingMailer(transport({ status: 'sent' }), new StubRecorder(null));
    await expect(mailer.send(MESSAGE)).resolves.toEqual({ status: 'sent' });
  });
});
