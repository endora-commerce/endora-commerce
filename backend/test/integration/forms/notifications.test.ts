import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formDetailSchema,
  type EmailMailerSendInput,
  type EmailMailerSendOutcome,
  type FormDefinitionInput,
  type FormDetail,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { EmailDelivery } from '../../helpers/package-entities.js';
import { auditRows, deleteForms, readEntryRow } from '../../helpers/seed-forms.js';
import type { Mailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { RecordingMailer } from '../../../../packages/modules/email/src/backend/services/recording-mailer.js';
import { PersistentEmailDeliveryRecorder } from '../../../../packages/modules/email/src/backend/services/email-delivery-recorder.js';

/**
 * `specs/170-forms-module/` T086 — User Story 5: the shop notification and the confirmation e-mail
 * (FR-055 – FR-059, A-2, A-3, research R-13).
 *
 * The shared harness runs no workers and builds no queue, so this file stands in for both: the
 * container's notification producer is replaced by one that keeps each job, and the processor the
 * worker would run is driven with that job. The mailer is the platform's recording mailer over a
 * capturing (or failing) transport, so `email_deliveries` rows are the ones production writes.
 */
describe('forms — e-mail notifications (US5)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const ADMIN_API = '/api/v1/admin/forms';
  const RUN = randomUUID().slice(0, 8);
  const SENTINEL = `Sentinel answer ${RUN}`;
  const DEFAULT_RECIPIENT = `default-${RUN}@example.com`;
  const OVERRIDE_RECIPIENTS = [`override1-${RUN}@example.com`, `override2-${RUN}@example.com`];
  const SUBMITTER = `shopper-${RUN}@example.com`;
  const created: string[] = [];
  const channels: string[] = [];
  const pages: string[] = [];
  const jobs: Array<{ entryId: string; shopLanguage: string }> = [];
  const captured: EmailMailerSendInput[] = [];
  let transportDown = false;
  let recording: Mailer | null = null;
  let english: { id: string; code: string };
  let polish: { id: string; code: string };
  let address = 0;

  const bundles = {
    en: JSON.parse(readFileSync(new URL('../../../../packages/modules/forms/i18n/en.json', import.meta.url), 'utf8')) as Record<string, string>,
    pl: JSON.parse(readFileSync(new URL('../../../../packages/modules/forms/i18n/pl.json', import.meta.url), 'utf8')) as Record<string, string>,
  };
  const sentence = (language: 'en' | 'pl', key: string, params: Record<string, string>): string =>
    Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), bundles[language][key] ?? key);

  const mailer: Mailer = {
    async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
      if (!recording) throw new Error('the recording mailer is set up in beforeAll');
      return recording.send(input);
    },
  };

  const nextIp = (): string => `10.172.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

  function adminCall(method: 'GET' | 'POST' | 'PUT', path: string, payload?: unknown): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method,
      url: `${ADMIN_API}${path}`,
      cookies: admin,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  function detailOf(response: LightMyRequestResponse): FormDetail {
    expect(response.statusCode, response.body).toBeLessThan(300);
    return formDetailSchema.parse((response.json() as { data: unknown }).data);
  }

  function definition(sectionId: string, includeSummary: boolean): FormDefinitionInput {
    return {
      schemaVersion: 1,
      sections: [
        {
          id: sectionId,
          columns: 1,
          fields: [
            { id: 'f_name', type: 'text', key: 'name', required: true },
            { id: 'f_mail', type: 'email', key: 'email', submitterEmail: true },
            { id: 'f_msg', type: 'textarea', key: 'message' },
            { id: 'f_privacy', type: 'privacy_consent', key: 'privacy', required: true },
          ],
        },
      ],
      behaviour: {
        confirmation: { type: 'message' },
        captchaRequired: false,
        confirmationEmail: { enabled: true, includeSummary },
      },
      restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
      texts: {
        'en-US': {
          'fields.f_name.label': 'Name',
          'fields.f_mail.label': 'E-mail',
          'fields.f_msg.label': 'Message',
          'fields.f_privacy.content': '<p>I accept the privacy policy</p>',
          'email.confirmation.subject': `Thanks ${RUN}`,
          'email.confirmation.body': '<p>We will reply soon.</p>',
        },
        'pl-PL': {
          'fields.f_name.label': 'Imię',
          'fields.f_msg.label': 'Wiadomość',
          'email.confirmation.subject': `Dziękujemy ${RUN}`,
          'email.confirmation.body': '<p>Wkrótce odpowiemy.</p>',
        },
      },
    };
  }

  async function published(name: string, options: { includeSummary?: boolean; notify?: boolean } = {}): Promise<FormDetail> {
    const form = detailOf(await adminCall('POST', '', { name: `${name} ${RUN}`, defaultLanguage: 'en-US' }));
    created.push(form.id);
    const saved = detailOf(
      await adminCall('PUT', `/${form.id}`, {
        expectedRevision: form.revision,
        definition: definition(form.definition.sections[0]!.id, options.includeSummary ?? false),
      }),
    );
    let current = detailOf(await adminCall('POST', `/${saved.id}/publish`, { expectedRevision: saved.revision }));
    if (options.notify !== false) {
      current = detailOf(
        await adminCall('PUT', `/${current.id}/notifications`, {
          expectedRevision: current.revision,
          recipients: [DEFAULT_RECIPIENT],
          channelRecipients: { [english.id]: OVERRIDE_RECIPIENTS },
        }),
      );
    }
    return current;
  }

  async function submit(form: FormDetail, channelCode: string, language?: string, message = SENTINEL): Promise<string> {
    const before = jobs.length;
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/v1/storefront/forms/${form.id}/entries${language ? `?language=${language}` : ''}`,
      headers: { 'x-sales-channel': channelCode },
      remoteAddress: nextIp(),
      payload: { values: { name: 'Ada', email: SUBMITTER, message, privacy: 'on' }, pageUrl: '/contact' },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(jobs.length).toBe(before + 1);
    return jobs[jobs.length - 1]!.entryId;
  }

  type Processor = (job: {
    data: { entryId: string; shopLanguage: string };
    progress: unknown;
    updateProgress(progress: object): Promise<void>;
  }) => Promise<unknown>;

  /** What the worker would run for the job the subscriber enqueued for `entryId`. */
  async function process(entryId: string): Promise<void> {
    const job = jobs.find((candidate) => candidate.entryId === entryId)!;
    let progress: unknown = 0;
    const processor = h.container.resolve<Processor>('formsNotificationProcessor');
    await processor({
      data: job,
      get progress() {
        return progress;
      },
      async updateProgress(next) {
        progress = next;
      },
    });
  }

  const mailsFor = (entryId: string): EmailMailerSendInput[] => captured.filter((mail) => mail.messageId.startsWith(`forms-${entryId}-`));

  async function deliveryRows(entryId: string): Promise<Array<Record<string, unknown>>> {
    return (await h
      .em()
      .getConnection()
      .execute(`select * from "email_deliveries" where "message_id" like ? order by "message_id"`, [`forms-${entryId}-%`])) as Array<
      Record<string, unknown>
    >;
  }

  beforeAll(async () => {
    h = await setupBackendServer({
      organizationsMailer: mailer,
      moduleOverrides: {
        formsNotificationProducer: {
          enqueue: async (data: { entryId: string; shopLanguage: string }) => {
            jobs.push(data);
            return true;
          },
          close: async () => {},
        },
      },
    });
    recording = new RecordingMailer(
      {
        async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
          if (transportDown) throw new Error('smtp down');
          captured.push(input);
          return { status: 'sent' };
        },
      },
      new PersistentEmailDeliveryRecorder(h.em),
    );
    const em = h.em().fork();
    const make = (suffix: string, defaultLanguage: string) =>
      em.create(SalesChannel, {
        code: `forms-mail-${suffix}-${RUN}`,
        name: { 'en-US': `Forms mail ${suffix}`, 'pl-PL': `Formularze ${suffix}` },
        languages: ['en-US', 'pl-PL'],
        defaultLanguage,
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
        systemDefault: false,
        status: 'active',
      });
    const en = make('en', 'en-US');
    const pl = make('pl', 'pl-PL');
    await em.persistAndFlush([en, pl]);
    english = { id: en.id, code: en.code };
    polish = { id: pl.id, code: pl.code };
    channels.push(en.id, pl.id);
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await deleteForms(h, created);
    const em = h.em();
    await em.nativeDelete(EmailDelivery, { messageId: { $like: 'forms-%' }, recipient: { $like: `%${RUN}%` } });
    for (const id of pages) {
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/cms/pages/${id}`, cookies: admin });
    }
    if (channels.length > 0) await em.nativeDelete(SalesChannel, { id: { $in: channels } });
    await teardownBackendServer(h);
  });

  it("sends the channel's own list instead of the default one, with Reply-To the submitter (US5-1, A-2)", async () => {
    const form = await published('Override');
    const entryId = await submit(form, english.code);
    expect(jobs.find((job) => job.entryId === entryId)).toEqual({ entryId, shopLanguage: 'en-US' });
    await process(entryId);
    const shop = mailsFor(entryId).filter((mail) => mail.kind === 'forms.entry_notification');
    expect(shop.map((mail) => mail.to).sort()).toEqual([...OVERRIDE_RECIPIENTS].sort());
    for (const mail of shop) {
      expect(mail.replyTo).toBe(SUBMITTER);
      expect(mail.salesChannelId).toBe(english.id);
      expect(mail.subject).toBe(sentence('en', 'mail.notification.subject', { form: form.name }));
      expect(mail.text).toContain(SENTINEL);
      expect(mail.text).toContain('/contact');
    }
  });

  it("sends the default list on any other channel, in that channel's default language (A-3)", async () => {
    const form = await published('Default list');
    const entryId = await submit(form, polish.code, 'en-US');
    expect(jobs.find((job) => job.entryId === entryId)?.shopLanguage).toBe('pl-PL');
    await process(entryId);
    const shop = mailsFor(entryId).filter((mail) => mail.kind === 'forms.entry_notification');
    expect(shop.map((mail) => mail.to)).toEqual([DEFAULT_RECIPIENT]);
    expect(shop[0]!.subject).toBe(sentence('pl', 'mail.notification.subject', { form: form.name }));
    expect(shop[0]!.text).toContain('Imię: Ada');
  });

  it('stores the entry and sends nothing to the shop when the channel has no recipients; the form warns (US5-2)', async () => {
    const form = await published('Nobody', { notify: false });
    expect(form.warnings).toContainEqual({ code: 'no_recipients' });
    const entryId = await submit(form, english.code);
    expect(await readEntryRow(h, entryId)).toBeDefined();
    await process(entryId);
    expect(mailsFor(entryId).filter((mail) => mail.kind === 'forms.entry_notification')).toEqual([]);
    expect(detailOf(await adminCall('GET', `/${form.id}`)).warnings).toContainEqual({ code: 'no_recipients' });
  });

  it('sends one confirmation, in the language of the page, with the summary when chosen (US5-3, FR-058)', async () => {
    const form = await published('Confirmed', { includeSummary: true });
    const entryId = await submit(form, english.code, 'pl-PL');
    await process(entryId);
    await process(entryId);
    const confirmations = mailsFor(entryId).filter((mail) => mail.kind === 'forms.entry_confirmation');
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({ to: SUBMITTER, subject: `Dziękujemy ${RUN}`, messageId: `forms-${entryId}-confirmation` });
    expect(confirmations[0]!.text).toContain('Wkrótce odpowiemy.');
    expect(confirmations[0]!.text).toContain(`Wiadomość:\n${SENTINEL}`);
    expect(confirmations[0]!.replyTo).toBeUndefined();
    expect((await readEntryRow(h, entryId))?.['confirmation_sent_at'] ?? null).not.toBeNull();
  });

  it('keeps the entry and answers the shopper 201 when the transport fails; the failed delivery is recorded (US5-5, FR-059)', async () => {
    const form = await published('Failing');
    transportDown = true;
    let entryId = '';
    try {
      entryId = await submit(form, english.code);
      await expect(process(entryId)).rejects.toThrow(/smtp down/);
    } finally {
      transportDown = false;
    }
    expect(await readEntryRow(h, entryId)).toBeDefined();
    const rows = await deliveryRows(entryId);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) expect(row['status']).toBe('failed');
    // The confirmation was not stamped by a send that did not happen.
    expect((await readEntryRow(h, entryId))?.['confirmation_sent_at'] ?? null).toBeNull();
  });

  it('keeps the answers out of every delivery record, audit row and job payload (FR-055, FR-057)', async () => {
    const form = await published('Private', { includeSummary: true });
    const entryId = await submit(form, english.code);
    await process(entryId);
    const rows = await deliveryRows(entryId);
    expect(rows.map((row) => [row['kind'], row['recipient']]).sort()).toEqual(
      [
        ['forms.entry_confirmation', SUBMITTER],
        ['forms.entry_notification', OVERRIDE_RECIPIENTS[0]],
        ['forms.entry_notification', OVERRIDE_RECIPIENTS[1]],
      ].sort(),
    );
    for (const row of rows) {
      expect(row['status']).toBe('sent');
      expect(JSON.stringify(row)).not.toContain(SENTINEL);
      expect(JSON.stringify(row)).not.toContain('Ada');
    }
    for (const row of [...(await auditRows(h, { objectId: entryId })), ...(await auditRows(h, { objectId: form.id }))]) {
      expect(JSON.stringify(row)).not.toContain(SENTINEL);
    }
    expect(JSON.stringify(jobs)).not.toContain(SENTINEL);
    expect(JSON.stringify(jobs)).not.toContain(SUBMITTER);
  });

  it('never shows a recipient in the public read or in stored page data (US5-4, FR-056)', async () => {
    const form = await published('Hidden recipients');
    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/forms/${form.id}?language=en-US`,
      headers: { 'x-sales-channel': english.code },
    });
    expect(read.statusCode, read.body).toBe(200);
    for (const recipient of [DEFAULT_RECIPIENT, ...OVERRIDE_RECIPIENTS]) expect(read.body).not.toContain(recipient);
    expect(read.body).not.toContain('"recipients"');
    expect(read.body).not.toContain('"channelRecipients"');

    const slug = `forms-mail-${RUN}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      cookies: admin,
      payload: { name: `Forms mail ${RUN}`, slug, active: true, salesChannelIds: [english.id], languages: ['en-US'] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const page = (created.json() as { data: { id: string; version: number } }).data;
    pages.push(page.id);
    const content = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${page.id}/content/en-US`,
      cookies: admin,
      payload: { data: { root: { props: {} }, content: [{ type: 'forms.Form', props: { id: 'block-1', formId: form.id } }] }, version: page.version },
    });
    expect(content.statusCode, content.body).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: `/api/v1/admin/cms/pages/${page.id}/publish`, cookies: admin })).statusCode).toBe(200);
    const stored = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
      headers: { 'x-sales-channel': english.code },
    });
    expect(stored.statusCode, stored.body).toBe(200);
    expect(stored.body).toContain(form.id);
    for (const recipient of [DEFAULT_RECIPIENT, ...OVERRIDE_RECIPIENTS]) expect(stored.body).not.toContain(recipient);
  });
});
