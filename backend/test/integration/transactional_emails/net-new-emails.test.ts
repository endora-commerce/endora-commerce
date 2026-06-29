import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../src/modules/email/services/mailer.js';
import { TransactionalEmailService } from '../../../src/modules/transactional_emails/services/transactional-email.service.js';
import { ContentResolver } from '../../../src/modules/transactional_emails/services/content-resolver.js';
import { BrandingService } from '../../../src/modules/transactional_emails/services/branding.service.js';
import { EmbedResolver } from '../../../src/modules/transactional_emails/services/embed-resolver.js';
import type { SettingsService } from '../../../src/modules/settings/services/settings.service.js';

const fakeSettings = {
  get: async () => {
    throw new Error('no settings in this test');
  },
} as unknown as SettingsService;

function service(mailer: InMemoryMailer, h: BackendServerHandle): TransactionalEmailService {
  return new TransactionalEmailService({
    emFactory: h.em,
    contentResolver: new ContentResolver(),
    branding: new BrandingService(fakeSettings),
    embeds: new EmbedResolver(),
    mailer,
  });
}

describe('transactional emails — net-new payment + shipment emails (US5)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('payment_status_changed renders its registered default (paid + failed)', async () => {
    const mailer = new InMemoryMailer();
    const svc = service(mailer, h);
    await svc.send({
      code: 'payment_status_changed',
      salesChannelId: '00000000-0000-0000-0000-0000000000aa',
      language: 'en-US',
      to: 'buyer@example.com',
      messageId: 'payment_status_changed:o1:paid',
      variables: { order: { businessId: 'ORD-9' }, payment: { statusLabel: 'Paid', failureReason: '' } },
    });
    await svc.send({
      code: 'payment_status_changed',
      salesChannelId: '00000000-0000-0000-0000-0000000000aa',
      language: 'en-US',
      to: 'buyer@example.com',
      messageId: 'payment_status_changed:o1:failed',
      variables: { order: { businessId: 'ORD-9' }, payment: { statusLabel: 'Failed', failureReason: 'Card declined' } },
    });
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[0]!.subject).toBe('Payment update for order ORD-9');
    expect(mailer.sent[0]!.html).toContain('Paid');
    expect(mailer.sent[1]!.html).toContain('Card declined');
    expect(mailer.sent[0]!.html).not.toContain('{{');
  });

  it('shipment_created renders its registered default', async () => {
    const mailer = new InMemoryMailer();
    const svc = service(mailer, h);
    await svc.send({
      code: 'shipment_created',
      salesChannelId: '00000000-0000-0000-0000-0000000000aa',
      language: 'en-US',
      to: 'buyer@example.com',
      messageId: 'shipment_created:s1',
      variables: { order: { businessId: 'ORD-9' } },
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.subject).toBe('Your order ORD-9 has shipped');
    expect(mailer.sent[0]!.html).toContain('ORD-9');
    expect(mailer.sent[0]!.html).not.toContain('{{');
  });
});
