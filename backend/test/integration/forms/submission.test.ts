import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  FORMS_EVENTS,
  FormEntrySubmittedEventV1Schema,
  formDetailSchema,
  type CmsPageReadPort,
  type FormDefinitionInput,
  type FormDetail,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `specs/170-forms-module/` T046 — User Story 2: a shopper submits a published form and an entry is
 * stored (US2-4, FR-035, FR-038, FR-040, FR-044, FR-045, research R-12).
 *
 * The entry carries the served version, the request's channel and language, the page and the
 * time; an anonymous submission carries no owner and a signed-in one carries the customer and the
 * organisation the accounts port resolves — never one the body names; a filled honeypot stores,
 * sends and publishes nothing; `forms.entry.submitted.v1` is dispatched once per committed entry and
 * never for a refused one; the confirmation is the form's, a CMS page falling back to the message
 * while `cms` is off or the channel does not serve the page.
 */
describe('forms — place a form and receive submissions (US2)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const customer = { b2b_session: 'stub-customer-session' };
  const ADMIN_API = '/api/v1/admin/forms';
  const LANGUAGE = 'en-US';
  const RUN = randomUUID().slice(0, 8);
  const SENTINEL = `Sentinel answer ${RUN}`;
  const PAGE_ID = randomUUID();
  const created: string[] = [];
  const submitted: unknown[] = [];
  let offSubmitted: () => void = () => {};
  let bilingual: { id: string; code: string };
  let defaultChannelId: string;
  let address = 0;

  const nextIp = (): string => `10.171.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

  function adminCall(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, payload?: unknown) {
    return h.app.inject({
      method,
      url: `${ADMIN_API}${path}`,
      cookies: admin,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  function submit(
    formId: string,
    payload: unknown,
    options: { channel?: string; cookies?: Record<string, string>; language?: string; query?: string } = {},
  ): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/storefront/forms/${formId}/entries${options.query ?? ''}`,
      headers: {
        'x-sales-channel': options.channel ?? 'default',
        ...(options.language ? { 'accept-language': options.language } : {}),
      },
      ...(options.cookies ? { cookies: options.cookies } : {}),
      remoteAddress: nextIp(),
      payload: payload as Record<string, unknown>,
    });
  }

  function detailOf(response: LightMyRequestResponse): FormDetail {
    expect(response.statusCode, response.body).toBeLessThan(300);
    return formDetailSchema.parse((response.json() as { data: unknown }).data);
  }

  type Options = {
    confirmation?: FormDefinitionInput['behaviour']['confirmation'];
    maxEntries?: number | null;
    signedInOnly?: boolean;
    label?: string;
  };

  function definition(sectionId: string, options: Options = {}): FormDefinitionInput {
    return {
      schemaVersion: 1,
      sections: [
        {
          id: sectionId,
          columns: 2,
          fields: [
            { id: 'f_name', type: 'text', key: 'name', required: true },
            { id: 'f_mail', type: 'email', key: 'email', submitterEmail: true },
            { id: 'f_privacy', type: 'privacy_consent', key: 'privacy', required: true },
          ],
        },
      ],
      behaviour: {
        confirmation: options.confirmation ?? { type: 'message' },
        captchaRequired: false,
        confirmationEmail: { enabled: false, includeSummary: false },
      },
      restrictions: {
        maxEntries: options.maxEntries ?? null,
        availableFrom: null,
        availableUntil: null,
        signedInOnly: options.signedInOnly ?? false,
      },
      texts: {
        [LANGUAGE]: {
          'fields.f_name.label': options.label ?? 'Name',
          'fields.f_mail.label': 'E-mail',
          'fields.f_privacy.content': '<p>I accept the privacy policy</p>',
          'messages.success': 'Thank you!',
        },
        'pl-PL': {
          'fields.f_name.label': 'Imię',
          'fields.f_privacy.content': '<p>Akceptuję politykę prywatności</p>',
          'messages.success': 'Dziękujemy!',
        },
      },
    };
  }

  async function published(name: string, options: Options = {}): Promise<FormDetail> {
    const form = detailOf(await adminCall('POST', '', { name: `${name} ${RUN}`, defaultLanguage: LANGUAGE }));
    created.push(form.id);
    const saved = detailOf(
      await adminCall('PUT', `/${form.id}`, {
        expectedRevision: form.revision,
        definition: definition(form.definition.sections[0]!.id, options),
      }),
    );
    return detailOf(await adminCall('POST', `/${saved.id}/publish`, { expectedRevision: saved.revision }));
  }

  interface EntryRow {
    id: string;
    form_id: string;
    form_version_id: string;
    form_version_number: number;
    sales_channel_id: string;
    language: string;
    page_url: string | null;
    submitted_at: Date;
    answers: Record<string, unknown>;
    consents: Array<{ fieldKey: string; kind: string; given: boolean; text: string }>;
    submitter_email: string | null;
    search_text: string;
    status: string;
    customer_account_id: string | null;
    organization_id: string | null;
  }

  async function entries(formId: string): Promise<EntryRow[]> {
    return withSystemScope('forms submission test: read the entries as stored', async () =>
      (await h
        .em()
        .getConnection()
        .execute(`select * from "form_entries" where "form_id" = ? order by "submitted_at", "id"`, [formId])) as EntryRow[],
    );
  }

  async function acceptedCount(formId: string): Promise<number> {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select "accepted_entry_count" as "n" from "forms" where "id" = ?`, [formId])) as Array<{ n: number }>;
    return rows[0]!.n;
  }

  const VALID = { values: { name: 'Ada', email: 'Ada@Example.com', privacy: 'on' }, pageUrl: '/contact?ref=a' };

  beforeAll(async () => {
    h = await setupBackendServer();
    offSubmitted = h.eventBus.on(FORMS_EVENTS.ENTRY_SUBMITTED as never, (payload: unknown) => {
      submitted.push(payload);
    });
    const em = h.em().fork();
    const channel = em.create(SalesChannel, {
      code: `forms-${RUN}`,
      name: { 'en-US': `Forms ${RUN}`, 'pl-PL': `Formularze ${RUN}` },
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
    defaultChannelId = (await em.findOneOrFail(SalesChannel, { code: 'default' })).id;
  }, 60_000);

  afterAll(async () => {
    offSubmitted();
    vi.restoreAllMocks();
    if (h) {
      if (created.length > 0) {
        await withSystemScope('forms submission test: clean up', async () => {
          await h
            .em()
            .getConnection()
            .execute(`delete from "forms" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
        });
      }
      if (bilingual) await h.em().fork().nativeDelete(SalesChannel, { id: bilingual.id });
    }
    await teardownBackendServer(h);
  });

  it('stores an entry with status new, the served version, the channel, the language, the page and the time (US2-4)', async () => {
    const first = await published('Stored');
    // A second version: the entry names the one served when it was submitted.
    const again = detailOf(
      await adminCall('PUT', `/${first.id}`, {
        expectedRevision: first.revision,
        definition: definition(first.definition.sections[0]!.id, { label: 'Full name' }),
      }),
    );
    const form = detailOf(await adminCall('POST', `/${again.id}/publish`, { expectedRevision: again.revision }));
    const before = Date.now();

    const response = await submit(form.id, VALID);
    expect(response.statusCode, response.body).toBe(201);

    const [entry] = await entries(form.id);
    expect(entry).toMatchObject({
      status: 'new',
      form_version_number: 2,
      sales_channel_id: defaultChannelId,
      language: LANGUAGE,
      page_url: '/contact?ref=a',
      answers: { name: 'Ada', email: 'ada@example.com', privacy: true },
      submitter_email: 'ada@example.com',
      customer_account_id: null,
      organization_id: null,
    });
    expect(entry!.consents).toEqual([
      { fieldKey: 'privacy', kind: 'privacy', given: true, text: '<p>I accept the privacy policy</p>' },
    ]);
    expect(new Date(entry!.submitted_at).getTime()).toBeGreaterThanOrEqual(before - 1000);
    const versions = (await h
      .em()
      .getConnection()
      .execute(`select "id" from "form_versions" where "form_id" = ? and "number" = 2`, [form.id])) as Array<{ id: string }>;
    expect(entry!.form_version_id).toBe(versions[0]!.id);
    expect(await acceptedCount(form.id)).toBe(1);
  });

  it('resolves the language from the request within the channel’s languages, else the channel default (FR-035)', async () => {
    const form = await published('Languages');
    expect((await submit(form.id, VALID, { channel: bilingual.code, language: 'pl-PL,pl;q=0.9' })).statusCode).toBe(201);
    expect((await submit(form.id, VALID, { channel: bilingual.code, language: 'de-DE' })).statusCode).toBe(201);
    expect((await submit(form.id, VALID, { channel: bilingual.code, query: '?language=pl-PL' })).statusCode).toBe(201);
    const rows = await entries(form.id);
    expect(rows.map((row) => [row.sales_channel_id, row.language])).toEqual([
      [bilingual.id, 'pl-PL'],
      [bilingual.id, 'en-US'],
      [bilingual.id, 'pl-PL'],
    ]);
    // The consent text is the one shown, in the submission language.
    expect(rows[0]!.consents[0]!.text).toBe('<p>Akceptuję politykę prywatności</p>');
  });

  it('refuses a submission for which no channel resolves, and stores nothing (FR-035)', async () => {
    const form = await published('No channel');
    const response = await submit(form.id, VALID, { channel: `nope-${RUN}` });
    expect(response.statusCode, response.body).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
    expect(await entries(form.id)).toEqual([]);
  });

  it('attributes a signed-in submission to the customer and their organisation, and an anonymous one to nobody (FR-045)', async () => {
    const form = await published('Attribution');
    expect((await submit(form.id, VALID)).statusCode).toBe(201);
    expect((await submit(form.id, VALID, { cookies: customer })).statusCode).toBe(201);
    const rows = await entries(form.id);
    expect(rows.map((row) => [row.customer_account_id, row.organization_id])).toEqual([
      [null, null],
      [TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID],
    ]);
  });

  it.each([
    ['customerAccountId', TEST_CUSTOMER_ID],
    ['organizationId', TEST_ORGANIZATION_ID],
  ])('refuses a body naming %s and stamps nothing (FR-045)', async (key, value) => {
    const form = await published(`Named ${key}`);
    const response = await submit(form.id, { ...VALID, [key]: value });
    expect(response.statusCode, response.body).toBe(400);
    expect(await entries(form.id)).toEqual([]);
  });

  it('takes a signed-in-only form from a customer and refuses an anonymous visitor (FR-043)', async () => {
    const form = await published('Members', { signedInOnly: true });
    const anonymous = await submit(form.id, VALID);
    expect(anonymous.statusCode, anonymous.body).toBe(409);
    expect(anonymous.json()).toMatchObject({ error: { code: 'FORM_NOT_ACCEPTING', details: { code: 'sign_in_required' } } });
    expect((await submit(form.id, VALID, { cookies: customer })).statusCode).toBe(201);
    expect((await entries(form.id)).map((row) => row.customer_account_id)).toEqual([TEST_CUSTOMER_ID]);
  });

  it('stores, publishes and audits nothing for a filled honeypot, and answers as accepted (FR-040)', async () => {
    const form = await published('Honeypot');
    const events = submitted.length;
    const response = await submit(form.id, { ...VALID, hp: 'https://spam.example' });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ data: { status: 'accepted', confirmation: { type: 'message', message: 'Thank you!' } } });
    expect(await entries(form.id)).toEqual([]);
    expect(submitted.length).toBe(events);
    expect(await acceptedCount(form.id)).toBe(0);
    const audit = await h.auditLogService.query({ objectType: 'form_entry' });
    expect(JSON.stringify(audit)).not.toContain(form.id);
  });

  it('dispatches forms.entry.submitted.v1 once per committed entry, with no answer and no owner beyond the organisation', async () => {
    const form = await published('Event');
    const before = submitted.length;
    expect((await submit(form.id, { ...VALID, values: { ...VALID.values, name: SENTINEL } }, { cookies: customer })).statusCode).toBe(201);
    const events = submitted.slice(before).map((payload) => FormEntrySubmittedEventV1Schema.parse(payload));
    const [entry] = await entries(form.id);
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'forms.entry.submitted.v1',
        entryId: entry!.id,
        formId: form.id,
        formKey: form.key,
        formVersion: 1,
        salesChannelId: defaultChannelId,
        organizationId: TEST_ORGANIZATION_ID,
        language: LANGUAGE,
        pageUrl: '/contact?ref=a',
        answers: {},
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(SENTINEL);
    expect(JSON.stringify(events)).not.toContain(TEST_CUSTOMER_ID);
  });

  it('audits one forms.entry.submit per entry, holding no answer', async () => {
    const form = await published('Audit');
    expect((await submit(form.id, { ...VALID, values: { ...VALID.values, name: SENTINEL } })).statusCode).toBe(201);
    const [entry] = await entries(form.id);
    const rows = await h.auditLogService.query({ objectType: 'form_entry', objectId: entry!.id });
    expect(rows.map((row) => row.action)).toEqual(['forms.entry.submit']);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(SENTINEL);
    expect(stored).not.toContain('ada@example.com');
    expect(stored).not.toContain('Ada@Example.com');
  });

  it('takes no entry beyond the maximum: of two racing submissions one commits and one is refused, and only the committed one is published', async () => {
    const form = await published('Maximum', { maxEntries: 1 });
    const before = submitted.length;
    const responses = await Promise.all([submit(form.id, VALID), submit(form.id, VALID)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const refused = responses.find((response) => response.statusCode === 409)!;
    expect(refused.json()).toMatchObject({ error: { code: 'FORM_NOT_ACCEPTING', details: { code: 'full' } } });
    expect(await entries(form.id)).toHaveLength(1);
    expect(await acceptedCount(form.id)).toBe(1);
    expect(submitted.slice(before)).toHaveLength(1);
  });

  describe('the confirmation (FR-038, US2-8)', () => {
    let links: ReturnType<typeof vi.spyOn>;

    beforeAll(() => {
      const port = h.container.resolve<CmsPageReadPort>('cmsPageReadPort');
      links = vi.spyOn(port, 'findStorefrontLinks').mockImplementation(async (ids, scope) =>
        ids.includes(PAGE_ID) && scope.salesChannelId === bilingual.id
          ? [{ id: PAGE_ID, name: 'Thanks', url: scope.language === 'pl-PL' ? '/dziekujemy' : '/thank-you' }]
          : [],
      );
    });

    it('answers the message', async () => {
      const form = await published('Message');
      expect((await submit(form.id, VALID, { language: 'en-US' })).json()).toEqual({
        data: { status: 'accepted', confirmation: { type: 'message', message: 'Thank you!' } },
      });
    });

    it('answers the redirect', async () => {
      const form = await published('Redirect', { confirmation: { type: 'redirect', url: 'https://example.com/thanks' } });
      expect((await submit(form.id, VALID)).json()).toEqual({
        data: { status: 'accepted', confirmation: { type: 'redirect', url: 'https://example.com/thanks' } },
      });
    });

    it('answers the CMS page’s path in the submission language, on the channel that serves it', async () => {
      const form = await published('Page', { confirmation: { type: 'page', cmsPageId: PAGE_ID } });
      const response = await submit(form.id, VALID, { channel: bilingual.code, language: 'pl-PL' });
      expect(response.json()).toEqual({ data: { status: 'accepted', confirmation: { type: 'page', path: '/dziekujemy' } } });
      expect(links).toHaveBeenLastCalledWith([PAGE_ID], { salesChannelId: bilingual.id, language: 'pl-PL' });
      // The public read resolves it the same way.
      const read = await h.app.inject({
        method: 'GET',
        url: `/api/v1/storefront/forms/${form.id}?language=en-US`,
        headers: { 'x-sales-channel': bilingual.code },
      });
      expect((read.json() as { data: { confirmation: unknown } }).data.confirmation).toEqual({ type: 'page', path: '/thank-you' });
    });

    it('falls back to the message when the channel does not serve the page', async () => {
      const form = await published('Unserved page', { confirmation: { type: 'page', cmsPageId: PAGE_ID } });
      expect((await submit(form.id, VALID)).json()).toEqual({
        data: { status: 'accepted', confirmation: { type: 'message', message: 'Thank you!' } },
      });
    });

    it('falls back to the message while cms is off, and does not ask it', async () => {
      const form = await published('Cms off', { confirmation: { type: 'page', cmsPageId: PAGE_ID } });
      links.mockClear();
      const response = await withModuleOff('cms', 'deactivated', () => submit(form.id, VALID, { channel: bilingual.code }));
      expect(response.json()).toEqual({ data: { status: 'accepted', confirmation: { type: 'message', message: 'Thank you!' } } });
      expect(links).not.toHaveBeenCalled();
      expect(await entries(form.id)).toHaveLength(1);
    });
  });

  it('a form placed twice on a page: the two entries differ only by what was posted (US2-7)', async () => {
    const form = await published('Twice');
    expect((await submit(form.id, VALID)).statusCode).toBe(201);
    expect((await submit(form.id, { ...VALID, values: { name: 'Grace', privacy: 'on' } })).statusCode).toBe(201);
    const [first, second] = await entries(form.id);
    const same = (row: EntryRow) => {
      const { id: _id, submitted_at: _at, answers: _answers, submitter_email: _email, search_text: _search, ...rest } = row as EntryRow & {
        created_at?: unknown;
        updated_at?: unknown;
      };
      const { created_at: _c, updated_at: _u, ...kept } = rest as Record<string, unknown>;
      return kept;
    };
    expect(same(first!)).toEqual(same(second!));
    expect(first!.answers).not.toEqual(second!.answers);
  });
});
