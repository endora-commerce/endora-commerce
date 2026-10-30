import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailMailerSendInput, EmailMailerSendOutcome } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { EmailDelivery } from '../../helpers/package-entities.js';
import type { Mailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { RecordingMailer } from '../../../../packages/modules/email/src/backend/services/recording-mailer.js';
import { PersistentEmailDeliveryRecorder } from '../../../../packages/modules/email/src/backend/services/email-delivery-recorder.js';

/**
 * Feature 169 (T102; `specs/169-page-builder-contact-form/` contracts/contact-form-api.md §2,
 * FR-017–FR-020) — `POST /api/v1/storefront/cms/contact-form` over HTTP.
 *
 * What this file holds that the unit tests cannot: the route's own validation on the wire, the
 * recipients read for the **request's** channel (Principle XII), the rate limit (this file's app
 * registers `@fastify/rate-limit`), and the delivery record the platform mailer writes — a fixed
 * subject, the operator's address, no context — so nothing the shopper typed reaches a table.
 *
 * The mailer is the container's recording mailer over a capturing transport and the persistent
 * recorder, so the delivery rows are real ones. The setting is written per channel on channels
 * this file creates, and those values and channels are removed in `afterAll`.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const URL = '/api/v1/storefront/cms/contact-form';
const SETTING = 'cms.contact_form_recipients';
const RUN = `pb169_${randomUUID().slice(0, 8)}`;
const RECIPIENTS = [`sales-${RUN}@example.com`, `office-${RUN}@example.com`];
const OTHER_RECIPIENT = `other-${RUN}@example.com`;

const VALID = {
  email: `shopper-${RUN}@example.com`,
  message: `Please call me back (${RUN}).`,
  privacyConsent: true,
  name: 'Ada',
  subject: `Typed subject ${RUN}`,
  pagePath: '/contact',
};

describe('contact form — storefront endpoint (feature 169, contract §2)', () => {
  let h: BackendServerHandle;
  const captured: EmailMailerSendInput[] = [];
  let recording: Mailer | null = null;
  const createdChannels: Array<{ id: string; code: string }> = [];
  let withRecipients: { id: string; code: string };
  let without: { id: string; code: string };
  let other: { id: string; code: string };
  let address = 0;

  /** A fresh client address per request group, so the per-IP limit is this test's alone. */
  const nextIp = (): string => `10.169.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

  const mailer: Mailer = {
    async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
      if (!recording) throw new Error('the recording mailer is set up in beforeAll');
      return recording.send(input);
    },
  };

  async function createChannel(suffix: string): Promise<{ id: string; code: string }> {
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: `${RUN}-${suffix}`,
      name: { 'en-US': `Contact ${suffix}`, 'pl-PL': `Kontakt ${suffix}` },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['USD'],
      defaultCurrency: 'USD',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(channel);
    const created = { id: channel.id, code: channel.code };
    createdChannels.push(created);
    return created;
  }

  async function setRecipients(channelCode: string, value: unknown): Promise<{ statusCode: number; body: string }> {
    return h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${SETTING}/value`,
      cookies: ADMIN,
      payload: { scope: 'subset', salesChannelCodes: [channelCode], value: value as object },
    });
  }

  function post(payload: unknown, channelCode: string, remoteAddress = nextIp()) {
    return h.app.inject({
      method: 'POST',
      url: URL,
      headers: { 'x-sales-channel': channelCode },
      remoteAddress,
      payload: payload as object,
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none', enableRateLimit: true, organizationsMailer: mailer });
    recording = new RecordingMailer(
      {
        async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
          captured.push(input);
          return { status: 'sent' };
        },
      },
      new PersistentEmailDeliveryRecorder(h.em),
    );
    withRecipients = await createChannel('with');
    without = await createChannel('without');
    other = await createChannel('other');
    expect((await setRecipients(withRecipients.code, RECIPIENTS)).statusCode).toBe(200);
    expect((await setRecipients(without.code, [])).statusCode).toBe(200);
    expect((await setRecipients(other.code, [OTHER_RECIPIENT])).statusCode).toBe(200);
  }, 60_000);

  afterAll(async () => {
    if (h) {
      const codes = createdChannels.map((c) => c.code).join(',');
      if (codes) {
        await h.app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/settings/${SETTING}/values?salesChannelCodes=${codes}`,
          cookies: ADMIN,
        });
      }
      const em = h.em();
      await em.nativeDelete(EmailDelivery, { recipient: { $in: [...RECIPIENTS, OTHER_RECIPIENT] } });
      if (createdChannels.length > 0) {
        await em.nativeDelete(SalesChannel, { id: { $in: createdChannels.map((c) => c.id) } });
      }
      await teardownBackendServer(h);
    }
  });

  it('sends one e-mail per recipient of the request channel and answers sent', async () => {
    const before = captured.length;
    const res = await post(VALID, withRecipients.code);

    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'sent' } });
    const sent = captured.slice(before);
    expect(sent.map((m) => m.to).sort()).toEqual([...RECIPIENTS].sort());
    for (const message of sent) {
      expect(message.replyTo).toBe(VALID.email);
      expect(message.kind).toBe('cms.contact_form');
      expect(message.salesChannelId).toBe(withRecipients.id);
      expect(message.subject).toContain('Contact with');
      expect(message.subject).not.toContain(RUN);
      expect(message.text).toContain(VALID.message);
      expect(message.text).toContain(VALID.subject);
      expect(message).not.toHaveProperty('meta');
    }
  });

  it('never answers with a recipient or the submitted values', async () => {
    const res = await post(VALID, withRecipients.code);
    expect(res.statusCode).toBe(200);
    for (const recipient of RECIPIENTS) expect(res.body).not.toContain(recipient);
    expect(res.body).not.toContain(RUN);
  });

  it('records each delivery with the fixed subject and no context, so nothing typed is stored', async () => {
    const em = h.em();
    em.clear();
    const rows = await em.find(EmailDelivery, { recipient: { $in: RECIPIENTS } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.kind).toBe('cms.contact_form');
      expect(row.status).toBe('sent');
      expect(row.subject).not.toContain(RUN);
      expect(JSON.stringify(row)).not.toContain(VALID.email);
      expect(JSON.stringify(row)).not.toContain(VALID.message);
      expect(row.context ?? null).toBeNull();
    }
  });

  it.each([
    ['the e-mail', { email: undefined }],
    ['a valid e-mail', { email: 'not-an-address' }],
    ['the message', { message: undefined }],
    ['a non-empty message', { message: '   ' }],
    ['the privacy consent', { privacyConsent: undefined }],
    ['a true privacy consent', { privacyConsent: false }],
    ['a short enough name', { name: 'a'.repeat(201) }],
    ['a single-line subject', { subject: 'first\nsecond' }],
    ['no unknown key', { to: 'attacker@example.com' }],
  ])('refuses a submission without %s with 400 VALIDATION_FAILED and sends nothing', async (_name, patch) => {
    const before = captured.length;
    const body = JSON.parse(JSON.stringify({ ...VALID, ...patch })) as Record<string, unknown>;
    const res = await post(body, withRecipients.code);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(captured.length).toBe(before);
  });

  it('answers 409 CMS_CONTACT_FORM_UNAVAILABLE on a channel with no recipients', async () => {
    const before = captured.length;
    const res = await post(VALID, without.code);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'CMS_CONTACT_FORM_UNAVAILABLE' } });
    expect(captured.length).toBe(before);
  });

  it("uses the request channel's recipients only (Principle XII)", async () => {
    const before = captured.length;
    expect((await post(VALID, other.code)).statusCode).toBe(200);
    expect(captured.slice(before).map((m) => m.to)).toEqual([OTHER_RECIPIENT]);
  });

  it('answers sent to a filled honeypot and sends nothing', async () => {
    const before = captured.length;
    const res = await post({ ...VALID, website: 'https://spam.example' }, withRecipients.code);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'sent' } });
    expect(captured.length).toBe(before);
  });

  it('limits one client address to ten submissions in the window', async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await post({ ...VALID, website: 'bot' }, withRecipients.code, ip)).statusCode);
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    // Another address is not affected.
    expect((await post({ ...VALID, website: 'bot' }, withRecipients.code)).statusCode).toBe(200);
  });

  it('refuses recipients that are not 0–10 e-mail addresses on the Settings write', async () => {
    expect((await setRecipients(other.code, ['not an address'])).statusCode).toBe(400);
    expect(
      (await setRecipients(other.code, Array.from({ length: 11 }, (_, i) => `r${i}-${RUN}@example.com`))).statusCode,
    ).toBe(400);
  });
});
