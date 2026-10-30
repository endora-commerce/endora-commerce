import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `submitContactForm` — the storefront's call to `POST /api/v1/storefront/cms/contact-form`
 * (`specs/169-page-builder-contact-form/` T105, contracts/contact-form-api.md §3 step 3): the
 * request channel and the shopper's forwarded address go with it, and every backend answer maps
 * to one of three outcomes.
 */

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

const fetchMock = vi.fn();

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

const SUBMISSION = { email: 'shopper@example.com', message: 'Hello', privacyConsent: true as const };

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('submitContactForm', () => {
  it('posts the submission with the channel and the forwarded address, and answers sent', async () => {
    fetchMock.mockResolvedValue(answer(200, { data: { status: 'sent' } }));
    const { submitContactForm } = await import('../../lib/api/contact-form');

    await expect(
      submitContactForm({ submission: SUBMISSION, channelCode: 'b2c', forwardedFor: '203.0.113.7' }),
    ).resolves.toBe('sent');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://backend.test/api/v1/storefront/cms/contact-form');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(SUBMISSION);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Sales-Channel'] ?? headers['x-sales-channel']).toBe('b2c');
    expect(headers['x-forwarded-for']).toBe('203.0.113.7');
  });

  it('sends no forwarded address when the request carried none', async () => {
    fetchMock.mockResolvedValue(answer(200, { data: { status: 'sent' } }));
    const { submitContactForm } = await import('../../lib/api/contact-form');
    await submitContactForm({ submission: SUBMISSION, channelCode: 'b2c', forwardedFor: null });
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers).not.toHaveProperty('x-forwarded-for');
  });

  it('maps a 400 to invalid', async () => {
    fetchMock.mockResolvedValue(answer(400, { error: { code: 'VALIDATION_FAILED', message: 'no' } }));
    const { submitContactForm } = await import('../../lib/api/contact-form');
    await expect(submitContactForm({ submission: SUBMISSION, channelCode: 'b2c' })).resolves.toBe('invalid');
  });

  it.each([409, 429, 500, 503])('maps a %i to unavailable', async (status) => {
    fetchMock.mockResolvedValue(answer(status, { error: { code: 'X', message: 'no' } }));
    const { submitContactForm } = await import('../../lib/api/contact-form');
    await expect(submitContactForm({ submission: SUBMISSION, channelCode: 'b2c' })).resolves.toBe('unavailable');
  });

  it('maps a network failure to unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const { submitContactForm } = await import('../../lib/api/contact-form');
    await expect(submitContactForm({ submission: SUBMISSION, channelCode: 'b2c' })).resolves.toBe('unavailable');
  });
});
