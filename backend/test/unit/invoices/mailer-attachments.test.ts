import { describe, expect, it } from 'vitest';
import { InMemoryMailer } from '../../../src/modules/email/services/mailer.js';

describe('mailer attachments (US5)', () => {
  it('InMemoryMailer captures attachments passed through MailerSendInput', async () => {
    const mailer = new InMemoryMailer();
    await mailer.send({
      messageId: 'invoice_issued:abc',
      to: 'buyer@example.com',
      subject: 'Invoice FV 1/2026',
      text: 'Your invoice',
      attachments: [{ filename: 'invoice-FV_1_2026.pdf', content: Buffer.from('%PDF-1.4'), contentType: 'application/pdf' }],
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.attachments?.[0]?.filename).toBe('invoice-FV_1_2026.pdf');
    expect(mailer.sent[0]?.attachments?.[0]?.contentType).toBe('application/pdf');
  });
});
