import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { formDetailSchema, type FormDefinitionInput, type FormDetail } from '@endora-commerce/contracts';
import { manifest as formsManifest } from '../../../../packages/modules/forms/src/manifest.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `specs/170-forms-module/` T093 — User Story 6: spam protection and restrictions, each enforced by
 * the server (FR-040 – FR-043, research R-12, R-14, R-15).
 *
 * The maximum counts non-spam entries and holds under racing submissions (the form row is locked);
 * an availability window answers `not_yet_open` before it and `closed` after it; a signed-in-only
 * form refuses a guest. A form that requires CAPTCHA while a provider is configured is refused
 * without a response the provider verifies, refused retryably when the provider cannot answer, and
 * taken with a verified one; while no provider is configured it is taken unchecked and the builder
 * warns. Validation runs **before** the CAPTCHA check, so a mistyped answer burns no token. The
 * honeypot and the per-address rate limit are re-asserted end to end. Nothing refused is stored.
 *
 * The provider is Node's global `fetch`, stubbed for the two `siteverify` addresses only.
 */
describe('forms — spam protection and restrictions (US6)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const customer = { b2b_session: 'stub-customer-session' };
  const ADMIN_API = '/api/v1/admin/forms';
  const LANGUAGE = 'en-US';
  const RUN = randomUUID().slice(0, 8);
  const SECRET = `captcha-secret-${RUN}`;
  const SITE_KEY = `site-key-${RUN}`;
  const created: string[] = [];
  let address = 0;

  const nextIp = (): string => `10.172.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;

  /** The provider's answers, by token; anything else is a refusal. */
  type ProviderMode = 'answer' | 'down' | 'error-status';
  let providerMode: ProviderMode = 'answer';
  const providerCalls: { url: string; body: URLSearchParams }[] = [];
  const realFetch = globalThis.fetch;

  function adminCall(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: unknown) {
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
    options: { cookies?: Record<string, string>; ip?: string; language?: string } = {},
  ): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/storefront/forms/${formId}/entries`,
      headers: { 'x-sales-channel': 'default', ...(options.language ? { 'accept-language': options.language } : {}) },
      ...(options.cookies ? { cookies: options.cookies } : {}),
      remoteAddress: options.ip ?? nextIp(),
      payload: payload as Record<string, unknown>,
    });
  }

  function read(formId: string): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/forms/${formId}`,
      headers: { 'x-sales-channel': 'default' },
      remoteAddress: nextIp(),
    });
  }

  function detailOf(response: LightMyRequestResponse): FormDetail {
    expect(response.statusCode, response.body).toBeLessThan(300);
    return formDetailSchema.parse((response.json() as { data: unknown }).data);
  }

  function errorOf(response: LightMyRequestResponse): { code: string; message: string; details?: Record<string, unknown> } {
    return (response.json() as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
  }

  type Options = {
    maxEntries?: number | null;
    availableFrom?: string | null;
    availableUntil?: string | null;
    signedInOnly?: boolean;
    captcha?: boolean;
  };

  function definition(sectionId: string, options: Options = {}): FormDefinitionInput {
    return {
      schemaVersion: 1,
      sections: [
        {
          id: sectionId,
          columns: 1,
          fields: [
            { id: 'f_name', type: 'text', key: 'name', required: true },
            { id: 'f_mail', type: 'email', key: 'email', submitterEmail: true },
          ],
        },
      ],
      behaviour: {
        confirmation: { type: 'message' },
        captchaRequired: options.captcha === true,
        confirmationEmail: { enabled: false, includeSummary: false },
      },
      restrictions: {
        maxEntries: options.maxEntries ?? null,
        availableFrom: options.availableFrom ?? null,
        availableUntil: options.availableUntil ?? null,
        signedInOnly: options.signedInOnly ?? false,
      },
      texts: { [LANGUAGE]: { 'fields.f_name.label': 'Name', 'fields.f_mail.label': 'E-mail' } },
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

  async function setSetting(code: string, value: string): Promise<void> {
    const response = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${code}/value`,
      cookies: admin,
      payload: { scope: 'all', value },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  async function configureCaptcha(provider: 'none' | 'turnstile' | 'hcaptcha'): Promise<void> {
    await setSetting('forms.captcha_provider', provider);
    await setSetting('forms.captcha_site_key', provider === 'none' ? '' : SITE_KEY);
    await setSetting('forms.captcha_secret_key', provider === 'none' ? '' : SECRET);
  }

  async function entryIds(formId: string): Promise<string[]> {
    return withSystemScope('forms restrictions test: read the entries as stored', async () =>
      (
        (await h
          .em()
          .getConnection()
          .execute(`select "id" from "form_entries" where "form_id" = ? order by "submitted_at", "id"`, [formId])) as Array<{
          id: string;
        }>
      ).map((row) => row.id),
    );
  }

  const VALID = { values: { name: 'Ada', email: 'ada@example.com' } };

  beforeAll(async () => {
    h = await setupBackendServer({ enableRateLimit: true });
    await new ManifestReconciler(h.em()).apply([formsManifest.settings!]);
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.endsWith('/siteverify')) return realFetch(input, init);
      const body = new URLSearchParams(String(init?.body ?? ''));
      providerCalls.push({ url, body });
      if (providerMode === 'down') throw new TypeError('fetch failed');
      if (providerMode === 'error-status') return new Response('busy', { status: 502 });
      const success = body.get('secret') === SECRET && body.get('response') === 'good-token';
      return Response.json({ success, ...(success ? {} : { 'error-codes': ['invalid-input-response'] }) });
    });
  }, 60_000);

  afterEach(() => {
    providerMode = 'answer';
    providerCalls.length = 0;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    if (h) {
      await configureCaptcha('none').catch(() => {});
      if (created.length > 0) {
        await withSystemScope('forms restrictions test: clean up', async () => {
          await h
            .em()
            .getConnection()
            .execute(`delete from "forms" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
        });
      }
    }
    await teardownBackendServer(h);
  });

  describe('maximum entries (US6-5)', () => {
    it('counts non-spam entries only, and holds under racing submissions', async () => {
      const form = await published('Maximum', { maxEntries: 2 });
      expect((await submit(form.id, VALID)).statusCode).toBe(201);
      const [first] = await entryIds(form.id);
      // Marked spam: it no longer counts against the maximum.
      const marked = await adminCall('PATCH', `/entries/${first}/status`, { status: 'spam', expectedStatus: 'new' });
      expect(marked.statusCode, marked.body).toBe(200);

      const responses = await Promise.all([submit(form.id, VALID), submit(form.id, VALID), submit(form.id, VALID)]);
      const statuses = responses.map((response) => response.statusCode).sort();
      expect(statuses).toEqual([201, 201, 409]);
      const refused = responses.find((response) => response.statusCode === 409)!;
      expect(errorOf(refused)).toMatchObject({ code: 'FORM_NOT_ACCEPTING', details: { code: 'full' } });
      expect(await entryIds(form.id)).toHaveLength(3);

      // The block reads the same: full.
      expect(((await read(form.id)).json() as { data: { availability: string } }).data.availability).toBe('full');
    });
  });

  describe('availability window (US6-6)', () => {
    it('answers not_yet_open before the window and stores nothing', async () => {
      const form = await published('Later', { availableFrom: new Date(Date.now() + 86_400_000).toISOString() });
      const response = await submit(form.id, VALID);
      expect(response.statusCode, response.body).toBe(409);
      expect(errorOf(response)).toMatchObject({ code: 'FORM_NOT_ACCEPTING', details: { code: 'not_yet_open' } });
      expect(((await read(form.id)).json() as { data: { availability: string } }).data.availability).toBe('not_yet_open');
      expect(await entryIds(form.id)).toEqual([]);
    });

    it('answers closed after the window and stores nothing', async () => {
      const form = await published('Earlier', {
        availableFrom: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        availableUntil: new Date(Date.now() - 86_400_000).toISOString(),
      });
      const response = await submit(form.id, VALID);
      expect(response.statusCode, response.body).toBe(409);
      expect(errorOf(response)).toMatchObject({ code: 'FORM_NOT_ACCEPTING', details: { code: 'closed' } });
      expect(await entryIds(form.id)).toEqual([]);
    });

    it('takes a submission inside the window', async () => {
      const form = await published('Now', {
        availableFrom: new Date(Date.now() - 86_400_000).toISOString(),
        availableUntil: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect((await submit(form.id, VALID)).statusCode).toBe(201);
    });
  });

  describe('signed-in customers only (US6-7)', () => {
    it('refuses a guest with sign_in_required and takes a signed-in customer', async () => {
      const form = await published('Members', { signedInOnly: true });
      const guest = await submit(form.id, VALID);
      expect(guest.statusCode, guest.body).toBe(409);
      expect(errorOf(guest)).toMatchObject({ code: 'FORM_NOT_ACCEPTING', details: { code: 'sign_in_required' } });
      expect(await entryIds(form.id)).toEqual([]);
      expect((await submit(form.id, VALID, { cookies: customer })).statusCode).toBe(201);
    });
  });

  describe('CAPTCHA required and configured (US6-3)', () => {
    let form: FormDetail;

    beforeAll(async () => {
      await configureCaptcha('turnstile');
      form = await published('Captcha', { captcha: true });
    });

    afterAll(async () => {
      await configureCaptcha('none');
    });

    it('serves the provider and the site key, never the secret', async () => {
      const response = await read(form.id);
      expect((response.json() as { data: { captcha: unknown } }).data.captcha).toEqual({ provider: 'turnstile', siteKey: SITE_KEY });
      expect(response.body).not.toContain(SECRET);
    });

    it('refuses a submission without a CAPTCHA response, without asking the provider', async () => {
      const response = await submit(form.id, VALID);
      expect(response.statusCode, response.body).toBe(400);
      expect(errorOf(response).code).toBe('FORM_CAPTCHA_FAILED');
      expect(providerCalls).toEqual([]);
      expect(await entryIds(form.id)).toEqual([]);
    });

    it('refuses a response the provider does not verify', async () => {
      const response = await submit(form.id, { ...VALID, captchaToken: 'bad-token' });
      expect(response.statusCode, response.body).toBe(400);
      expect(errorOf(response).code).toBe('FORM_CAPTCHA_FAILED');
      expect(response.body).not.toContain(SECRET);
      expect(await entryIds(form.id)).toEqual([]);
    });

    it('takes a verified response, sending the secret, the token and the client address to Turnstile', async () => {
      const ip = nextIp();
      const response = await submit(form.id, { ...VALID, captchaToken: 'good-token' }, { ip });
      expect(response.statusCode, response.body).toBe(201);
      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0]!.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      expect(Object.fromEntries(providerCalls[0]!.body)).toEqual({ secret: SECRET, response: 'good-token', remoteip: ip });
      expect(await entryIds(form.id)).toHaveLength(1);
    });

    it.each(['down', 'error-status'] as const)(
      'refuses retryably while the provider is %s, and stores nothing (fail closed)',
      async (mode) => {
        providerMode = mode;
        const before = (await entryIds(form.id)).length;
        const response = await submit(form.id, { ...VALID, captchaToken: 'good-token' });
        expect(response.statusCode, response.body).toBe(503);
        expect(errorOf(response).code).toBe('FORM_CAPTCHA_UNAVAILABLE');
        expect(response.headers['retry-after']).toBe('30');
        expect(await entryIds(form.id)).toHaveLength(before);
      },
    );

    it('validates the answers before the CAPTCHA check, so a refused form burns no token', async () => {
      const response = await submit(form.id, { values: { email: 'not-an-address' }, captchaToken: 'good-token' });
      expect(response.statusCode, response.body).toBe(400);
      expect(errorOf(response).code).toBe('FORM_SUBMISSION_INVALID');
      expect(providerCalls).toEqual([]);
    });

    it('checks hCaptcha at its own address when it is the provider', async () => {
      await setSetting('forms.captcha_provider', 'hcaptcha');
      try {
        const response = await submit(form.id, { ...VALID, captchaToken: 'good-token' });
        expect(response.statusCode, response.body).toBe(201);
        expect(providerCalls.map((call) => call.url)).toEqual(['https://api.hcaptcha.com/siteverify']);
      } finally {
        await setSetting('forms.captcha_provider', 'turnstile');
      }
    });
  });

  describe('CAPTCHA required but not configured (US6-4)', () => {
    it('takes the submission unchecked, serves no widget, and the builder warns', async () => {
      await configureCaptcha('none');
      const form = await published('Unconfigured captcha', { captcha: true });
      expect((await read(form.id)).json()).toMatchObject({ data: { captcha: null } });
      const response = await submit(form.id, VALID);
      expect(response.statusCode, response.body).toBe(201);
      expect(providerCalls).toEqual([]);
      const detail = detailOf(await adminCall('GET', `/${form.id}`));
      expect(detail.warnings).toContainEqual({ code: 'captcha_not_configured' });
    });
  });

  describe('honeypot and rate limit, end to end (US6-1, US6-2)', () => {
    it('answers a filled honeypot as accepted and stores nothing', async () => {
      const form = await published('Honeypot');
      const response = await submit(form.id, { ...VALID, hp: 'https://spam.example' });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toMatchObject({ data: { status: 'accepted' } });
      expect(await entryIds(form.id)).toEqual([]);
    });

    it('refuses the eleventh submission of one address with a translated "too many requests"', async () => {
      const form = await published('Rate limit');
      const ip = nextIp();
      for (let i = 0; i < 10; i += 1) {
        expect((await submit(form.id, { ...VALID, hp: 'bot' }, { ip })).statusCode).toBe(201);
      }
      const english = await submit(form.id, VALID, { ip, language: 'en-US' });
      const polish = await submit(form.id, VALID, { ip, language: 'pl-PL' });
      expect(english.statusCode).toBe(429);
      expect(polish.statusCode).toBe(429);
      expect(errorOf(english)).toMatchObject({ code: 'RATE_LIMITED', message: 'Too many requests.' });
      expect(errorOf(polish)).toMatchObject({ code: 'RATE_LIMITED', message: 'Za dużo żądań.' });
      expect(await entryIds(form.id)).toEqual([]);
    });
  });
});
