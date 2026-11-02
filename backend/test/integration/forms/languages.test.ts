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
import { deleteForms, readEntryRow } from '../../helpers/seed-forms.js';
import type { Mailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * `specs/170-forms-module/` T100 — User Story 7: a form in the shopper's language (FR-067, FR-068,
 * research R-7, R-24, A-3).
 *
 * One structure, texts per language: the public read in each storefront language falls back to the
 * form's default language for a text left untranslated (US7-2), and never answers in a language the
 * channel does not serve. Validation messages are the module's built-ins in the submission language,
 * an operator's own message winning where one was written (US7-3). The confirmation message and the
 * confirmation e-mail follow the submission language, the shop notification the channel's default
 * language. The builder's `untranslated` warning names the incomplete language and how much of it.
 *
 * As in `notifications.test.ts`, the harness runs no worker: the producer keeps each job and the
 * worker's processor is driven with it; the mailer captures what would be sent.
 */
describe('forms — in the shopper’s language (US7)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const ADMIN_API = '/api/v1/admin/forms';
  const RUN = randomUUID().slice(0, 8);
  const SUBMITTER = `shopper-${RUN}@example.com`;
  const RECIPIENT = `shop-${RUN}@example.com`;
  const created: string[] = [];
  const channels: string[] = [];
  const jobs: Array<{ entryId: string; shopLanguage: string }> = [];
  const captured: EmailMailerSendInput[] = [];
  let bilingual: { id: string; code: string };
  let address = 0;

  const bundle = (language: 'en' | 'pl'): Record<string, string> =>
    JSON.parse(readFileSync(new URL(`../../../../packages/modules/forms/i18n/${language}.json`, import.meta.url), 'utf8')) as Record<
      string,
      string
    >;
  const bundles = { en: bundle('en'), pl: bundle('pl') };

  const mailer: Mailer = {
    async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
      captured.push(input);
      return { status: 'sent' };
    },
  };

  const nextIp = (): string => `10.173.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

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

  function definition(sectionId: string): FormDefinitionInput {
    return {
      schemaVersion: 1,
      sections: [
        {
          id: sectionId,
          columns: 1,
          fields: [
            { id: 'f_name', type: 'text', key: 'name', required: true },
            { id: 'f_mail', type: 'email', key: 'email', required: true, submitterEmail: true },
            { id: 'f_topic', type: 'select', key: 'topic', options: [{ id: 'o_sales', value: 'sales' }, { id: 'o_help', value: 'help' }] },
          ],
        },
      ],
      behaviour: {
        confirmation: { type: 'message' },
        captchaRequired: false,
        confirmationEmail: { enabled: true, includeSummary: true },
      },
      restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
      texts: {
        'en-US': {
          'form.title': 'Contact us',
          'form.submitLabel': 'Send',
          'fields.f_name.label': 'Name',
          'fields.f_name.errors.required': 'Tell us your name, please.',
          'fields.f_mail.label': 'E-mail',
          'fields.f_topic.label': 'Topic',
          'fields.f_topic.options.o_sales': 'Sales',
          'fields.f_topic.options.o_help': 'Help',
          'messages.success': '<p>Thank you!</p>',
          'email.confirmation.subject': `Thanks ${RUN}`,
          'email.confirmation.body': '<p>We will reply soon.</p>',
        },
        // Polish, incomplete: no e-mail label, no "Help" option, no confirmation text.
        'pl-PL': {
          'form.title': 'Napisz do nas',
          'fields.f_name.label': 'Imię',
          'fields.f_name.errors.required': 'Podaj swoje imię.',
          'fields.f_topic.label': 'Temat',
          'fields.f_topic.options.o_sales': 'Sprzedaż',
          'messages.success': '<p>Dziękujemy!</p>',
          'email.confirmation.subject': `Dziękujemy ${RUN}`,
        },
      },
    };
  }

  async function published(name: string): Promise<FormDetail> {
    const form = detailOf(await adminCall('POST', '', { name: `${name} ${RUN}`, defaultLanguage: 'en-US' }));
    created.push(form.id);
    const saved = detailOf(
      await adminCall('PUT', `/${form.id}`, { expectedRevision: form.revision, definition: definition(form.definition.sections[0]!.id) }),
    );
    const live = detailOf(await adminCall('POST', `/${saved.id}/publish`, { expectedRevision: saved.revision }));
    return detailOf(
      await adminCall('PUT', `/${live.id}/notifications`, { expectedRevision: live.revision, recipients: [RECIPIENT], channelRecipients: {} }),
    );
  }

  function read(formId: string, language: string): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/forms/${formId}?language=${language}`,
      headers: { 'x-sales-channel': bilingual.code },
      remoteAddress: nextIp(),
    });
  }

  function submit(formId: string, language: string, values: Record<string, string>): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/storefront/forms/${formId}/entries?language=${language}`,
      headers: { 'x-sales-channel': bilingual.code },
      remoteAddress: nextIp(),
      payload: { values, pageUrl: '/kontakt' },
    });
  }

  type PublicRead = {
    language: string;
    texts: Record<string, string>;
    sections: Array<{ fields: Array<{ key: string; label: string; options?: Array<{ value: string; label: string }> }> }>;
  };

  const fieldOf = (data: PublicRead, key: string) => data.sections[0]!.fields.find((field) => field.key === key)!;

  type Processor = (job: {
    data: { entryId: string; shopLanguage: string };
    progress: unknown;
    updateProgress(progress: object): Promise<void>;
  }) => Promise<unknown>;

  async function process(entryId: string): Promise<void> {
    const job = jobs.find((candidate) => candidate.entryId === entryId)!;
    let progress: unknown = 0;
    await h.container.resolve<Processor>('formsNotificationProcessor')({
      data: job,
      get progress() {
        return progress;
      },
      async updateProgress(next) {
        progress = next;
      },
    });
  }

  let form: FormDetail;

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
    const em = h.em().fork();
    const channel = em.create(SalesChannel, {
      code: `forms-lang-${RUN}`,
      name: { 'en-US': `Forms languages ${RUN}`, 'pl-PL': `Formularze języki ${RUN}` },
      languages: ['en-US', 'pl-PL'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(channel);
    bilingual = { id: channel.id, code: channel.code };
    channels.push(channel.id);
    form = await published('Languages');
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await deleteForms(h, created);
    if (channels.length > 0) await h.em().nativeDelete(SalesChannel, { id: { $in: channels } });
    await teardownBackendServer(h);
  });

  describe('the public read (US7-2)', () => {
    it('answers each storefront language in its own texts, the default language behind an untranslated one', async () => {
      const polish = ((await read(form.id, 'pl-PL')).json() as { data: PublicRead }).data;
      expect(polish.language).toBe('pl-PL');
      expect(polish.texts.title).toBe('Napisz do nas');
      // Untranslated: the default language's text.
      expect(polish.texts.submitLabel).toBe('Send');
      expect(fieldOf(polish, 'name').label).toBe('Imię');
      expect(fieldOf(polish, 'email').label).toBe('E-mail');
      expect(fieldOf(polish, 'topic').options).toEqual([
        { id: 'o_sales', value: 'sales', label: 'Sprzedaż' },
        { id: 'o_help', value: 'help', label: 'Help' },
      ]);

      const english = ((await read(form.id, 'en-US')).json() as { data: PublicRead }).data;
      expect(english.texts.title).toBe('Contact us');
      expect(fieldOf(english, 'name').label).toBe('Name');
    });

    it('answers a language the channel does not serve in the channel’s default language', async () => {
      const german = ((await read(form.id, 'de-DE')).json() as { data: PublicRead }).data;
      expect(german.language).toBe('en-US');
      expect(german.texts.title).toBe('Contact us');
    });
  });

  describe('validation messages (US7-3)', () => {
    type Refusal = { error: { code: string; details: { fields: Array<{ fieldKey: string; code: string; message: string }> } } };
    const messageOf = (body: Refusal, key: string) => body.error.details.fields.find((field) => field.fieldKey === key)?.message;

    it('words a built-in message in the submission language', async () => {
      const polish = (await submit(form.id, 'pl-PL', { name: 'Ada', email: 'nope' })).json() as Refusal;
      expect(polish.error.code).toBe('FORM_SUBMISSION_INVALID');
      expect(messageOf(polish, 'email')).toBe(bundles.pl['validation.invalid_email']);
      const english = (await submit(form.id, 'en-US', { name: 'Ada', email: 'nope' })).json() as Refusal;
      expect(messageOf(english, 'email')).toBe(bundles.en['validation.invalid_email']);
    });

    it('lets the operator’s own message win, in the submission language', async () => {
      const polish = (await submit(form.id, 'pl-PL', { email: SUBMITTER })).json() as Refusal;
      expect(messageOf(polish, 'name')).toBe('Podaj swoje imię.');
      const english = (await submit(form.id, 'en-US', { email: SUBMITTER })).json() as Refusal;
      expect(messageOf(english, 'name')).toBe('Tell us your name, please.');
    });
  });

  describe('what follows an accepted submission', () => {
    it('confirms in the submission language and stores it on the entry', async () => {
      const response = await submit(form.id, 'pl-PL', { name: 'Ada', email: SUBMITTER, topic: 'help' });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toEqual({ data: { status: 'accepted', confirmation: { type: 'message', message: '<p>Dziękujemy!</p>' } } });
      const job = jobs[jobs.length - 1]!;
      expect((await readEntryRow(h, job.entryId))?.['language']).toBe('pl-PL');
    });

    it('sends the confirmation in the submission language, the default behind an untranslated text, and the shop notification in the channel’s default language (A-3)', async () => {
      const response = await submit(form.id, 'pl-PL', { name: 'Ada', email: SUBMITTER, topic: 'sales' });
      expect(response.statusCode, response.body).toBe(201);
      const job = jobs[jobs.length - 1]!;
      expect(job.shopLanguage).toBe('en-US');
      await process(job.entryId);
      const mails = captured.filter((mail) => mail.messageId.startsWith(`forms-${job.entryId}-`));

      const confirmation = mails.find((mail) => mail.kind === 'forms.entry_confirmation')!;
      expect(confirmation.subject).toBe(`Dziękujemy ${RUN}`);
      // The Polish body was never written: the default language's.
      expect(confirmation.text).toContain('We will reply soon.');
      // The summary's labels and option labels are the submission language's.
      expect(confirmation.text).toContain('Imię: Ada');
      expect(confirmation.text).toContain('Temat: Sprzedaż');

      const shop = mails.find((mail) => mail.kind === 'forms.entry_notification')!;
      expect(shop.subject).toBe(bundles.en['mail.notification.subject']!.replace('{form}', form.name));
      expect(shop.text).toContain('Name: Ada');
      expect(shop.text).toContain('Topic: Sales');
    });
  });

  describe('the builder (US7-2, FR-018)', () => {
    it('names the incomplete language and how many of its texts fall back', async () => {
      const detail = detailOf(await adminCall('GET', `/${form.id}`));
      const untranslated = detail.warnings.filter((warning) => warning.code === 'untranslated');
      // E-mail label, "Help", the button, the confirmation body.
      expect(untranslated).toEqual([{ code: 'untranslated', language: 'pl-PL', missing: 4 }]);
    });
  });
});
