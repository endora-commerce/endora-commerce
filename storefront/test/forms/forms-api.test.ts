import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `storefront/lib/api/forms.ts` — the storefront's two calls to the `forms` module's public API
 * (`specs/170-forms-module/` T050, contracts/public-api.md §1–§3, research R-21).
 *
 * The read is anonymous and shared: tagged with the form's storefront tag and revalidated within
 * 60 s, so a publish, close or delete reaches the page by the tag and, at the latest, by the
 * window. The submission forwards the shopper's session (attribution, FR-045) and address (the rate
 * limit, FR-041), and every backend answer becomes one outcome the handler can speak.
 */

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

const fetchMock = vi.fn();
const FORM_ID = '3b0c9f0e-2d1a-4c5b-8e7f-6a5b4c3d2e1f';

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('BACKEND_BASE_URL', 'http://backend.test');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const BODY = { values: { name: 'Ada' }, pageUrl: '/kontakt' };

describe('getPublicForm', () => {
  it('reads the public definition in the page language, tagged and revalidated at 60 s', async () => {
    fetchMock.mockResolvedValue(answer(200, { data: { formId: FORM_ID, availability: 'unavailable' } }));
    const { getPublicForm } = await import('../../lib/api/forms');

    await expect(getPublicForm(FORM_ID, { salesChannelCode: 'b2c', locale: 'pl-PL', viewerSession: 'secret' })).resolves.toEqual({
      formId: FORM_ID,
      availability: 'unavailable',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { next?: { revalidate?: number; tags?: string[] } }];
    expect(url).toBe(`http://backend.test/api/v1/storefront/forms/${FORM_ID}?language=pl-PL`);
    expect(init.next).toEqual({ revalidate: 60, tags: [`forms:form:${FORM_ID}`] });
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Sales-Channel'] ?? headers['x-sales-channel']).toBe('b2c');
    // The definition is the same for every viewer: the read is anonymous.
    expect(headers['Cookie'] ?? headers['cookie']).toBeUndefined();
  });
});

describe('submitFormEntry', () => {
  it('posts the body with the channel, the language, the session and the forwarded address', async () => {
    fetchMock.mockResolvedValue(
      answer(201, { data: { status: 'accepted', confirmation: { type: 'message', message: 'Thanks' } } }),
    );
    const { submitFormEntry } = await import('../../lib/api/forms');

    await expect(
      submitFormEntry({
        formId: FORM_ID,
        body: BODY,
        channelCode: 'b2c',
        locale: 'pl-PL',
        sessionCookie: 'sess-1',
        forwardedFor: '203.0.113.7',
      }),
    ).resolves.toEqual({ kind: 'accepted', confirmation: { type: 'message', message: 'Thanks' } });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://backend.test/api/v1/storefront/forms/${FORM_ID}/entries`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(BODY);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Sales-Channel'] ?? headers['x-sales-channel']).toBe('b2c');
    expect(headers['Accept-Language']).toBe('pl-PL');
    expect(headers['Cookie']).toBe('b2b_session=sess-1');
    expect(headers['x-forwarded-for']).toBe('203.0.113.7');
  });

  it('sends no session and no forwarded address when there are none', async () => {
    fetchMock.mockResolvedValue(answer(201, { data: { status: 'accepted', confirmation: { type: 'message', message: '' } } }));
    const { submitFormEntry } = await import('../../lib/api/forms');
    await submitFormEntry({ formId: FORM_ID, body: BODY, channelCode: 'b2c', locale: 'en-US', sessionCookie: null, forwardedFor: null });
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers).not.toHaveProperty('Cookie');
    expect(headers).not.toHaveProperty('x-forwarded-for');
  });

  it.each([
    [
      'a refused answer',
      400,
      { error: { code: 'FORM_SUBMISSION_INVALID', message: 'no', details: { fields: [{ fieldKey: 'email', code: 'invalid_email', message: 'Bad' }] } } },
      { kind: 'invalid', fields: [{ fieldKey: 'email', code: 'invalid_email', message: 'Bad' }] },
    ],
    ['a refused body', 400, { error: { code: 'VALIDATION_FAILED', message: 'no' } }, { kind: 'invalid', fields: [] }],
    ['a failed CAPTCHA', 400, { error: { code: 'FORM_CAPTCHA_FAILED', message: 'no' } }, { kind: 'captcha' }],
    [
      'a form that takes no entry',
      409,
      { error: { code: 'FORM_NOT_ACCEPTING', message: 'no', details: { code: 'closed' } } },
      { kind: 'not_accepting', reason: 'closed' },
    ],
    ['a body over the limit', 413, { error: { code: 'FORM_SUBMISSION_TOO_LARGE', message: 'no' } }, { kind: 'too_large' }],
    ['the rate limit', 429, { error: { code: 'RATE_LIMITED', message: 'no' } }, { kind: 'rate_limited' }],
    ['an unreachable CAPTCHA provider (retryable)', 503, { error: { code: 'FORM_CAPTCHA_UNAVAILABLE', message: 'no' } }, { kind: 'captcha_unavailable' }],
    ['the module switched off', 503, { error: { code: 'MODULE_DISABLED', message: 'no' } }, { kind: 'unavailable' }],
    ['a server fault', 500, { error: { code: 'INTERNAL', message: 'no' } }, { kind: 'unavailable' }],
  ])('maps %s to its outcome', async (_name, status, body, outcome) => {
    fetchMock.mockResolvedValue(answer(status, body));
    const { submitFormEntry } = await import('../../lib/api/forms');
    await expect(submitFormEntry({ formId: FORM_ID, body: BODY, channelCode: 'b2c', locale: 'en-US' })).resolves.toEqual(outcome);
  });

  it('maps a network failure to unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const { submitFormEntry } = await import('../../lib/api/forms');
    await expect(submitFormEntry({ formId: FORM_ID, body: BODY, channelCode: 'b2c', locale: 'en-US' })).resolves.toEqual({
      kind: 'unavailable',
    });
  });
});
