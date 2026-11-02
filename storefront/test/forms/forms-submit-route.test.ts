import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `POST /forms/submit` — the storefront handler behind the `forms.Form` block
 * (`specs/170-forms-module/` T050, contracts/public-api.md §3, research R-9, R-10, FR-037).
 *
 * The backend client, the module presence and the server context are stubbed: what is under test
 * is the handler's own decisions — the 404 while `forms` is absent, the size guard before parsing,
 * the body it builds from the posted form, the JSON answers, the `303` back to the page addressed to
 * the block, the `forms_attempt` cookie of a refused no-JS attempt and the query keys it owns.
 */

const submitFormEntry = vi.fn();
const present = vi.fn((_id: string) => true);

vi.mock('../../lib/api/forms', () => ({
  submitFormEntry: (input: unknown) => submitFormEntry(input),
}));

// `/forms/contact` (feature 169) is `cms`' handler; only its backend call is stubbed, so the
// off-state case below can show it does not depend on `forms`.
const submitContactForm = vi.fn(async (_input: unknown) => 'sent');
vi.mock('../../lib/api/contact-form', () => ({
  submitContactForm: (input: unknown) => submitContactForm(input),
}));
vi.mock('../../lib/api/newsletter', () => ({ subscribeNewsletter: async () => undefined }));

vi.mock('../../lib/api/module-presence', () => ({
  getModulePresence: async () => ({
    isPresent: (id: string) => present(id),
    presentIds: [],
    absentIds: [],
  }),
}));

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    ctx: { salesChannelCode: 'b2c', locale: 'pl-PL', viewerSession: 'sess-1' },
    urlState: {
      languages: [
        { languageCode: 'en-US', prefix: 'en', prefixed: false, isDefault: true },
        { languageCode: 'pl-PL', prefix: 'pl', prefixed: true, isDefault: false },
      ],
      aliases: [],
      current: 'pl-PL',
    },
  }),
}));

const FORM_ID = '3b0c9f0e-2d1a-4c5b-8e7f-6a5b4c3d2e1f';

const BASE = {
  formId: FORM_ID,
  blockId: 'Form-1',
  returnTo: '/pl/kontakt?utm=a&formsBlock=old&formsOutcome=error&formsReason=invalid&formsAttempt=x&contact=sent&form=c1',
  anchor: 'write-to-us',
  hp_extra: '',
  name: 'Ada',
  interests: ['doors', 'windows'],
  'address.city': 'Kraków',
};

async function post(
  fields: Record<string, string | string[]>,
  init: { json?: boolean; forwardedFor?: string; contentLength?: string; https?: boolean } = {},
): Promise<Response> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) body.append(key, v);
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (init.json) headers['Accept'] = 'application/json';
  if (init.forwardedFor) headers['x-forwarded-for'] = init.forwardedFor;
  if (init.contentLength) headers['content-length'] = init.contentLength;
  const { POST } = await import('../../app/forms/submit/route');
  return POST(new Request(`${init.https ? 'https' : 'http'}://shop.test/pl/forms/submit`, { method: 'POST', headers, body }));
}

function attemptOf(response: Response): { attemptId: string; blockId: string; errors: unknown[]; answers: Record<string, unknown>; truncated: boolean } {
  const cookie = response.headers.get('set-cookie') ?? '';
  const value = /forms_attempt=([^;]+)/.exec(cookie)?.[1] ?? '';
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

beforeEach(() => {
  submitFormEntry.mockReset();
  submitFormEntry.mockResolvedValue({ kind: 'accepted', confirmation: { type: 'message', message: 'Thanks' } });
  present.mockReset();
  present.mockReturnValue(true);
});

afterEach(() => {
  vi.resetModules();
});

describe('POST /forms/submit', () => {
  it('answers 404 while forms is absent, and submits nothing', async () => {
    present.mockImplementation((id: string) => id !== 'forms');
    const res = await post(BASE);
    expect(res.status).toBe(404);
    expect(present).toHaveBeenCalledWith('forms');
    expect(submitFormEntry).not.toHaveBeenCalled();
  });

  it('leaves /forms/contact working while forms is absent (US10-2)', async () => {
    present.mockImplementation((id: string) => id !== 'forms');
    submitContactForm.mockClear();
    const { POST } = await import('../../app/forms/contact/route');
    const body = new URLSearchParams({
      returnTo: '/pl/kontakt',
      form: 'contact-1',
      email: 'ada@example.com',
      message: 'Hello',
      privacyConsent: 'on',
    });
    const res = await POST(
      new Request('http://shop.test/pl/forms/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'sent' });
    expect(submitContactForm).toHaveBeenCalledTimes(1);
  });

  it('builds the submission from the posted form: values by name, repeated names as lists, the page, the session and the address', async () => {
    await post({ ...BASE, hp_extra: '', 'cf-turnstile-response': 'token-1' }, { forwardedFor: '203.0.113.7' });
    expect(submitFormEntry).toHaveBeenCalledWith({
      formId: FORM_ID,
      body: {
        values: { name: 'Ada', interests: ['doors', 'windows'], 'address.city': 'Kraków' },
        pageUrl: '/pl/kontakt?utm=a&contact=sent&form=c1',
        captchaToken: 'token-1',
      },
      channelCode: 'b2c',
      locale: 'pl-PL',
      sessionCookie: 'sess-1',
      forwardedFor: '203.0.113.7',
    });
  });

  it('passes a filled honeypot on as hp, which the backend answers as accepted', async () => {
    await post({ ...BASE, hp_extra: 'https://spam.example' });
    expect((submitFormEntry.mock.calls[0]![0] as { body: { hp?: string } }).body.hp).toBe('https://spam.example');
  });

  it('refuses a malformed form id without asking the backend', async () => {
    const res = await post({ ...BASE, formId: 'nope' }, { json: true });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
    expect(submitFormEntry).not.toHaveBeenCalled();
  });

  describe('with JavaScript (Accept: application/json)', () => {
    it('answers the confirmation, never cached', async () => {
      const res = await post(BASE, { json: true });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ status: 'accepted', confirmation: { type: 'message', message: 'Thanks' } });
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it.each([
      [{ kind: 'invalid', fields: [{ fieldKey: 'name', code: 'required', message: 'Needed' }] }, 400, { error: 'invalid', fields: [{ fieldKey: 'name', code: 'required', message: 'Needed' }] }],
      [{ kind: 'captcha' }, 400, { error: 'captcha' }],
      [{ kind: 'captcha_unavailable' }, 503, { error: 'captcha_unavailable' }],
      [{ kind: 'not_accepting', reason: 'full' }, 400, { error: 'not_accepting', reason: 'full' }],
      [{ kind: 'rate_limited' }, 429, { error: 'rate_limited' }],
      [{ kind: 'unavailable' }, 503, { error: 'unavailable' }],
      [{ kind: 'too_large' }, 413, { error: 'too_large' }],
    ])('answers %j with %i', async (outcome, status, body) => {
      submitFormEntry.mockResolvedValue(outcome);
      const res = await post(BASE, { json: true });
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(body);
      // JavaScript keeps its own state: no cookie.
      expect(res.headers.get('set-cookie')).toBeNull();
    });
  });

  describe('without JavaScript (303 back to the page)', () => {
    it('returns to the page with the outcome addressed to the block, the handler’s old keys gone and 169’s kept', async () => {
      const res = await post(BASE);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(
        '/pl/kontakt?utm=a&contact=sent&form=c1&formsBlock=Form-1&formsOutcome=accepted#write-to-us',
      );
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('goes to the redirect address, or to the CMS page in the page language', async () => {
      submitFormEntry.mockResolvedValueOnce({ kind: 'accepted', confirmation: { type: 'redirect', url: 'https://example.com/thanks' } });
      expect((await post(BASE)).headers.get('location')).toBe('https://example.com/thanks');
      submitFormEntry.mockResolvedValueOnce({ kind: 'accepted', confirmation: { type: 'page', path: '/dziekujemy' } });
      expect((await post(BASE)).headers.get('location')).toBe('/pl/dziekujemy');
    });

    it.each([
      [{ kind: 'captcha' }, 'captcha'],
      [{ kind: 'captcha_unavailable' }, 'captcha_unavailable'],
      [{ kind: 'not_accepting', reason: 'closed' }, 'not_accepting'],
      [{ kind: 'rate_limited' }, 'rate_limited'],
      [{ kind: 'unavailable' }, 'unavailable'],
      [{ kind: 'too_large' }, 'too_large'],
    ])('returns a refusal %j with its reason and an attempt id, and sets no cookie', async (outcome, reason) => {
      submitFormEntry.mockResolvedValue(outcome);
      const res = await post(BASE);
      expect(res.status).toBe(303);
      const location = new URL(res.headers.get('location')!, 'http://shop.test');
      expect(location.pathname).toBe('/pl/kontakt');
      expect(location.searchParams.get('formsBlock')).toBe('Form-1');
      expect(location.searchParams.get('formsOutcome')).toBe('error');
      expect(location.searchParams.get('formsReason')).toBe(reason);
      expect(location.searchParams.get('formsAttempt')).toMatch(/^[0-9a-f-]{36}$/);
      expect(location.hash).toBe('#write-to-us');
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('keeps a refused attempt’s answers and errors in a short-lived, page-scoped, script-proof cookie', async () => {
      submitFormEntry.mockResolvedValue({ kind: 'invalid', fields: [{ fieldKey: 'name', code: 'too_long', message: 'Too long' }] });
      const res = await post(BASE, { https: true });
      const location = new URL(res.headers.get('location')!, 'http://shop.test');
      expect(location.searchParams.get('formsReason')).toBe('invalid');
      const cookie = res.headers.get('set-cookie')!;
      expect(cookie).toContain('Path=/pl/kontakt');
      expect(cookie).toContain('Max-Age=300');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Secure');
      expect(attemptOf(res)).toEqual({
        attemptId: location.searchParams.get('formsAttempt'),
        blockId: 'Form-1',
        errors: [{ fieldKey: 'name', code: 'too_long', message: 'Too long' }],
        answers: { name: 'Ada', interests: ['doors', 'windows'], 'address.city': 'Kraków' },
        truncated: false,
      });
    });

    it('is not Secure on plain HTTP', async () => {
      submitFormEntry.mockResolvedValue({ kind: 'invalid', fields: [] });
      expect((await post(BASE)).headers.get('set-cookie')).not.toContain('Secure');
    });

    it('drops the answers that do not fit the cookie’s budget, in field order, and says so', async () => {
      submitFormEntry.mockResolvedValue({ kind: 'invalid', fields: [] });
      const res = await post({ ...BASE, first: 'a'.repeat(1500), second: 'b'.repeat(2500), third: 'c' });
      const attempt = attemptOf(res);
      expect(attempt.truncated).toBe(true);
      expect(attempt.answers['first']).toBe('a'.repeat(1500));
      expect(attempt.answers).not.toHaveProperty('second');
      expect((res.headers.get('set-cookie') ?? '').length).toBeLessThan(4096);
    });

    it('refuses a body over the limit without parsing it', async () => {
      const res = await post(BASE, { contentLength: '300000' });
      expect(res.status).toBe(303);
      const location = new URL(res.headers.get('location')!, 'http://shop.test');
      // Unparsed, so the page and the block are unknown: home, with the reason.
      expect(location.searchParams.get('formsReason')).toBe('too_large');
      expect(submitFormEntry).not.toHaveBeenCalled();
    });

    it('never leaves the shop: a foreign returnTo returns home', async () => {
      const res = await post({ ...BASE, returnTo: '//evil.example/x' });
      expect(res.headers.get('location')).toBe('/?formsBlock=Form-1&formsOutcome=accepted#write-to-us');
    });
  });
});
