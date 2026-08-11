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
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';

const ADMIN_COOKIE = { b2b_admin_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/transactional-emails';

// Settings stub: always throws so branding falls back to defaults (empty logo).
const fakeSettings = {
  get: async () => {
    throw new Error('no settings in this test');
  },
} as unknown as SettingsService;

const simpleContent = (text: string) => ({
  root: { props: {} },
  content: [{ type: 'EmailText', props: { id: 't1', text, align: 'left' } }],
  zones: {},
});

describe('transactional emails — edit + send (US1)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists the reconciled order_confirmation definition', async () => {
    const res = await h.app.inject({ method: 'GET', url: BASE, cookies: ADMIN_COOKIE });
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { data: { items: Array<{ code: string }> } }).data.items;
    expect(items.some((i) => i.code === 'order_confirmation')).toBe(true);
  });

  it('returns the module default before any customization', async () => {
    // Order-independent: ensure no global override exists first (shared test DB).
    await h.app.inject({
      method: 'DELETE',
      url: `${BASE}/order_confirmation/content?language=en-US`,
      cookies: ADMIN_COOKIE,
    });
    const res = await h.app.inject({
      method: 'GET',
      url: `${BASE}/order_confirmation?language=en-US`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const detail = (res.json() as { data: { effective: { source: string; subject: string } } }).data;
    expect(detail.effective.source).toBe('default');
    expect(detail.effective.subject).toContain('{{var order.businessId}}');
  });

  it('saves a global override and reflects it on read', async () => {
    const save = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/order_confirmation/content?language=en-US`,
      cookies: ADMIN_COOKIE,
      payload: { subject: 'Custom {{var order.businessId}}', content: simpleContent('Hello {{var customer.firstName}}') },
    });
    expect(save.statusCode).toBe(200);

    const detail = await h.app.inject({
      method: 'GET',
      url: `${BASE}/order_confirmation?language=en-US`,
      cookies: ADMIN_COOKIE,
    });
    const d = (detail.json() as { data: { effective: { source: string; subject: string } } }).data;
    expect(d.effective.source).toBe('global');
    expect(d.effective.subject).toBe('Custom {{var order.businessId}}');
  });

  it('previews with sample data and leaves no unresolved placeholders', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `${BASE}/order_confirmation/preview`,
      cookies: ADMIN_COOKIE,
      payload: { language: 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    const { subject, html } = (res.json() as { data: { subject: string; html: string } }).data;
    expect(subject).toBe('Custom ORD-1042');
    expect(html).toContain('Hello Anna');
    expect(html).not.toContain('{{');
  });

  it('rejects an empty subject and a non-email-safe component', async () => {
    const empty = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/order_confirmation/content?language=en-US`,
      cookies: ADMIN_COOKIE,
      payload: { subject: '   ', content: simpleContent('x') },
    });
    expect(empty.statusCode).toBe(422);

    const unsafe = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/order_confirmation/content?language=en-US`,
      cookies: ADMIN_COOKIE,
      payload: {
        subject: 'ok',
        content: { root: { props: {} }, content: [{ type: 'ScriptBlock', props: {} }], zones: {} },
      },
    });
    expect(unsafe.statusCode).toBe(400);
  });

  it('resets to the module default', async () => {
    const reset = await h.app.inject({
      method: 'DELETE',
      url: `${BASE}/order_confirmation/content?language=en-US`,
      cookies: ADMIN_COOKIE,
    });
    expect(reset.statusCode).toBe(200);
    const data = (reset.json() as { data: { source: string } }).data;
    expect(data.source).toBe('default');
  });

  it('sends the resolved email with variables substituted (InMemoryMailer)', async () => {
    // Save a global override the send will resolve.
    await h.app.inject({
      method: 'PUT',
      url: `${BASE}/order_confirmation/content?language=en-US`,
      cookies: ADMIN_COOKIE,
      payload: {
        subject: 'Order {{var order.businessId}}',
        content: simpleContent('Hi {{var customer.firstName}}\n{{for item in order.items}}{{var item.name}} x {{var item.quantity}}\n{{/for}}Total {{var order.total}}'),
      },
    });

    const mailer = new InMemoryMailer();
    const service = new TransactionalEmailService({
      emFactory: h.em,
      contentResolver: new ContentResolver(),
      branding: new BrandingService(fakeSettings),
      embeds: new EmbedResolver(),
      mailer,
    });

    await service.send({
      code: 'order_confirmation',
      salesChannelId: '00000000-0000-0000-0000-0000000000aa',
      language: 'en-US',
      to: 'buyer@example.com',
      messageId: 'order_confirmation:test-1',
      variables: {
        order: { businessId: 'B-77', total: '199,00 PLN', items: [{ name: 'Widget', quantity: 2 }] },
        customer: { firstName: 'Bo' },
      },
    });

    expect(mailer.sent).toHaveLength(1);
    const msg = mailer.sent[0]!;
    expect(msg.subject).toBe('Order B-77');
    expect(msg.to).toBe('buyer@example.com');
    expect(msg.html).toContain('Hi Bo');
    expect(msg.html).toContain('Widget x 2');
    expect(msg.html).toContain('Total 199,00 PLN');
    expect(msg.html).not.toContain('{{');
    expect(msg.text).toContain('Hi Bo');
  });

  it('still sends when a referenced variable is missing (no broken placeholder)', async () => {
    const mailer = new InMemoryMailer();
    const service = new TransactionalEmailService({
      emFactory: h.em,
      contentResolver: new ContentResolver(),
      branding: new BrandingService(fakeSettings),
      embeds: new EmbedResolver(),
      mailer,
    });
    await service.send({
      code: 'order_confirmation',
      salesChannelId: '00000000-0000-0000-0000-0000000000aa',
      language: 'en-US',
      to: 'buyer@example.com',
      messageId: 'order_confirmation:test-2',
      variables: { order: { businessId: 'B-78', items: [] } },
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.html).not.toContain('{{');
  });
});
