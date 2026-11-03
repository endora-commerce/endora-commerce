import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, FORMS_SETTING_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { CAPTCHA_VERIFY_URLS, CaptchaVerifier } from './captcha-verifier.js';

/**
 * `specs/170-forms-module/` T092 — the server-side CAPTCHA check (research R-14, FR-042): one
 * `fetch` to the configured provider's `siteverify` with `secret`, `response` and `remoteip`, the
 * settings read per call. `success: true` passes; a refusal or a missing token is
 * `400 FORM_CAPTCHA_FAILED`; a provider that cannot answer — timeout, network error, non-2xx, a body
 * that is not the provider's — is `503 FORM_CAPTCHA_UNAVAILABLE` (fail closed, A-5). The secret is
 * never written to a log, an error or its details.
 */

const SECRET = 'sk-live-very-secret-0000';
const SITE_KEY = '0x4AAAAAAA-site';

type Stored = { provider?: string; siteKey?: string; secretKey?: string };

function settingsPort(stored: Stored) {
  const values: Record<string, string | undefined> = {
    [FORMS_SETTING_CODES.CAPTCHA_PROVIDER]: stored.provider,
    [FORMS_SETTING_CODES.CAPTCHA_SITE_KEY]: stored.siteKey,
    [FORMS_SETTING_CODES.CAPTCHA_SECRET_KEY]: stored.secretKey,
  };
  return {
    getMany: vi.fn(async (codes: readonly string[]) => {
      const answer = new Map<string, { ok: true; value: unknown } | { ok: false; error: Error }>();
      for (const code of codes) {
        const value = values[code];
        answer.set(code, value === undefined ? { ok: false, error: new Error('not set') } : { ok: true, value });
      }
      return answer;
    }),
  };
}

const TURNSTILE: Stored = { provider: 'turnstile', siteKey: SITE_KEY, secretKey: SECRET };
const HCAPTCHA: Stored = { provider: 'hcaptcha', siteKey: SITE_KEY, secretKey: SECRET };

function verifier(stored: Stored, timeoutMs?: number) {
  const settings = settingsPort(stored);
  return { settings, verifier: new CaptchaVerifier({ settings: settings as never, ...(timeoutMs ? { timeoutMs } : {}) }) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }
  throw new Error('expected a refusal');
}

let fetchMock: ReturnType<typeof vi.fn>;
const logged: unknown[][] = [];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  logged.length = 0;
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
  }
});

afterEach(() => {
  // The secret reaches the provider and nothing else: no console line carries it.
  expect(JSON.stringify(logged)).not.toContain(SECRET);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CaptchaVerifier', () => {
  it.each([
    ['turnstile', TURNSTILE, CAPTCHA_VERIFY_URLS.turnstile],
    ['hcaptcha', HCAPTCHA, CAPTCHA_VERIFY_URLS.hcaptcha],
  ] as const)('posts secret, response and remoteip to the %s siteverify endpoint', async (_name, stored, url) => {
    fetchMock.mockResolvedValue(json({ success: true }));
    const { verifier: check } = verifier(stored);
    await expect(check.verify({ token: 'tok-1', remoteIp: '203.0.113.7' })).resolves.toBe('verified');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toEqual({ secret: SECRET, response: 'tok-1', remoteip: '203.0.113.7' });
  });

  it('names the endpoints of research R-14', () => {
    expect(CAPTCHA_VERIFY_URLS).toEqual({
      turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      hcaptcha: 'https://api.hcaptcha.com/siteverify',
    });
  });

  it('leaves remoteip out when the client address is unknown', async () => {
    fetchMock.mockResolvedValue(json({ success: true }));
    await verifier(TURNSTILE).verifier.verify({ token: 'tok-1', remoteIp: undefined });
    const body = new URLSearchParams((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.has('remoteip')).toBe(false);
  });

  it('reads the settings on every call, so a key changed by an operator is the next check’s', async () => {
    fetchMock.mockImplementation(async () => json({ success: true }));
    const { verifier: check, settings } = verifier(TURNSTILE);
    await check.verify({ token: 'a', remoteIp: undefined });
    await check.verify({ token: 'b', remoteIp: undefined });
    expect(settings.getMany).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['provider none', { provider: 'none', siteKey: SITE_KEY, secretKey: SECRET }],
    ['no site key', { provider: 'turnstile', siteKey: '', secretKey: SECRET }],
    ['no secret', { provider: 'turnstile', siteKey: SITE_KEY, secretKey: ' ' }],
    ['nothing stored', {}],
    ['an unknown provider', { provider: 'recaptcha', siteKey: SITE_KEY, secretKey: SECRET }],
  ] as const)('is not configured with %s, and asks nobody (US6-4)', async (_name, stored) => {
    await expect(verifier(stored).verifier.verify({ token: 'tok', remoteIp: undefined })).resolves.toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a missing or blank token with FORM_CAPTCHA_FAILED, without asking the provider', async () => {
    for (const token of [undefined, '', '   ']) {
      const error = await refusal(verifier(TURNSTILE).verifier.verify({ token, remoteIp: undefined }));
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe(ERROR_CODES.FORM_CAPTCHA_FAILED);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['success false', { success: false, 'error-codes': ['invalid-input-response'] }],
    ['no success flag', { 'error-codes': [] }],
    ['success as a string', { success: 'true' }],
  ])('refuses %s with FORM_CAPTCHA_FAILED', async (_name, body) => {
    fetchMock.mockResolvedValue(json(body));
    const error = await refusal(verifier(HCAPTCHA).verifier.verify({ token: 'tok', remoteIp: undefined }));
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe(ERROR_CODES.FORM_CAPTCHA_FAILED);
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(SECRET);
  });

  it.each([
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['a timeout', () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))],
    ['a 500', () => Promise.resolve(json({ success: true }, 500))],
    ['a 429', () => Promise.resolve(json({ success: false }, 429))],
    ['a body that is not JSON', () => Promise.resolve(new Response('<html>oops</html>', { status: 200 }))],
  ])('answers %s with a retryable FORM_CAPTCHA_UNAVAILABLE (fail closed)', async (_name, answer) => {
    fetchMock.mockImplementation(answer);
    const error = await refusal(verifier(TURNSTILE).verifier.verify({ token: 'tok', remoteIp: undefined }));
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe(ERROR_CODES.FORM_CAPTCHA_UNAVAILABLE);
    expect(error.headers).toEqual({ 'Retry-After': '30' });
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(SECRET);
  });

  it('gives up on a provider that does not answer within the timeout', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const error = await refusal(verifier(TURNSTILE, 20).verifier.verify({ token: 'tok', remoteIp: undefined }));
    expect(error.code).toBe(ERROR_CODES.FORM_CAPTCHA_UNAVAILABLE);
  });

  it('waits five seconds by default', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(json({ success: true }));
    await verifier(TURNSTILE).verifier.verify({ token: 'tok', remoteIp: undefined });
    expect(timeout).toHaveBeenCalledWith(5000);
  });
});
