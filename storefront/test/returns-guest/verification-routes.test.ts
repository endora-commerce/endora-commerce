import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import { StorefrontApiError } from '../../lib/api/client';
import { tForLocale } from '../../lib/i18n/messages';
import { visibleText } from '../account/i18n/text';

/**
 * `specs/181-guest-complaints/` T063 (FR-020 – FR-023; research R-3, R-4; owner rulings
 * O-2, O-3; design review S-2 – S-4, F-3, F-5, F-7): asking for a link, opening it, and
 * leaving.
 *
 * - The request handler answers `303` to *sent* for every outcome the backend keeps
 *   uniform (FR-021); a malformed address, a throttle and the setting off come back to
 *   the entry as a code, never as the backend's sentence or the address.
 * - The GET *verify* page redeems nothing and never submits itself; the POST redeems and
 *   sets `b2b_returns_guest`.
 * - A refused redemption (`410`, a double click) goes to the *no longer works* state, which
 *   continues to the form while this browser holds any live guest session (O-2), and
 *   prefills a new link's address only when this browser asked for the link (O-3).
 */
const en = tForLocale('en-US');

const api = {
  requestGuestVerification: vi.fn(),
  redeemGuestLink: vi.fn(),
  leaveGuestSession: vi.fn(),
  getGuestFormConfig: vi.fn(),
  getGuestAvailability: vi.fn(),
};
let guestSession: string | null = null;
let pendingCookie: string | undefined;
const redirects: string[] = [];

vi.mock('../../lib/api/returns-guest', () => ({
  requestGuestVerification: (...a: unknown[]) => api.requestGuestVerification(...a),
  redeemGuestLink: (...a: unknown[]) => api.redeemGuestLink(...a),
  leaveGuestSession: (...a: unknown[]) => api.leaveGuestSession(...a),
  getGuestFormConfig: (...a: unknown[]) => api.getGuestFormConfig(...a),
  getGuestAvailability: (...a: unknown[]) => api.getGuestAvailability(...a),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'b2b_returns_guest_pending' && pendingCookie
        ? { value: pendingCookie }
        : name === 'b2b_returns_guest' && guestSession
          ? { value: guestSession }
          : undefined,
  }),
  headers: async () => new Headers(),
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'en-US',
    ctx: { locale: 'en-US', salesChannelCode: 'default' },
    modules: { isPresent: () => true, presentIds: [], absentIds: [] },
    urlState: { languages: [], aliases: [], current: 'en-US' },
  }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    redirects.push(to);
    throw new Error(`redirect ${to}`);
  },
  localizedPath: async (path: string) => path,
}));

const { encodeGuestPending, decodeGuestPending } = await import('../../lib/returns/guest');
const { POST: requestLink } = await import('../../app/returns/guest/request/route');
const { POST: continueLink } = await import('../../app/returns/guest/verify/continue/route');
const { POST: leave } = await import('../../app/returns/guest/leave/route');
const { default: VerifyPage } = await import('../../app/returns/guest/verify/page');
const { default: SentPage } = await import('../../app/returns/guest/sent/page');

function post(url: string, fields: Record<string, string>, cookie?: string): Request {
  const body = new URLSearchParams(fields);
  return new Request(`http://shop.test${url}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.9', ...(cookie ? { cookie } : {}) },
  });
}

const setCookies = (res: Response): string[] =>
  (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie();
const cookieNamed = (res: Response, name: string): string | undefined => setCookies(res).find((c) => c.startsWith(`${name}=`));

async function renderPage(page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>, params: Record<string, string>): Promise<string> {
  return renderToString(createElement('div', null, (await page({ searchParams: Promise.resolve(params) })) as ReactElement));
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.requestGuestVerification.mockResolvedValue({ linkValidMinutes: 60 });
  api.getGuestAvailability.mockResolvedValue(true);
  api.leaveGuestSession.mockResolvedValue(undefined);
  guestSession = null;
  pendingCookie = undefined;
  redirects.length = 0;
});

describe('POST /returns/guest/request', () => {
  it('answers 303 to sent, keeping the address in an HttpOnly cookie scoped to the guest pages (F-7)', async () => {
    const res = await requestLink(post('/returns/guest/request', { email: ' anna@example.test ', hp: '', from: '/returns' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/returns/guest/sent');
    const [input, options] = api.requestGuestVerification.mock.calls[0]!;
    expect(input).toEqual({ email: 'anna@example.test', language: 'en-US' });
    expect(options).toMatchObject({ forwardedFor: '203.0.113.9' });
    const cookie = cookieNamed(res, 'b2b_returns_guest_pending')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/returns\/guest(;|$)/);
    expect(cookie).toMatch(/Max-Age=86400/);
    const value = /b2b_returns_guest_pending=([^;]+)/.exec(cookie)![1]!;
    expect(decodeGuestPending(value)).toMatchObject({ email: 'anna@example.test', linkValidMinutes: 60 });
    // Nothing of the address in the URL (issue #745).
    expect(res.headers.get('location')).not.toContain('anna');
  });

  it('forwards the honeypot, and answers the same 303 when the backend fails', async () => {
    api.requestGuestVerification.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await requestLink(post('/returns/guest/request', { email: 'anna@example.test', hp: 'bot' }));
    expect(api.requestGuestVerification.mock.calls[0]![0]).toMatchObject({ hp: 'bot' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/returns/guest/sent');
  });

  it.each([
    [new StorefrontApiError(400, 'VALIDATION_FAILED', 'bad'), '/returns/guest?error=email'],
    [new StorefrontApiError(429, 'RATE_LIMITED', 'slow'), '/returns/guest?error=rate_limited'],
    [new StorefrontApiError(403, 'RETURN_GUEST_COMPLAINTS_DISABLED', 'off'), '/returns/guest?error=disabled'],
  ])('comes back to the entry with a code for %s', async (error, location) => {
    api.requestGuestVerification.mockRejectedValue(error);
    const res = await requestLink(post('/returns/guest/request', { email: 'anna@' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(location);
  });

  it('does not resend within 60 seconds from the sent page without JavaScript (S-2)', async () => {
    const pending = encodeGuestPending({ email: 'anna@example.test', requestedAt: Date.now() - 10_000, linkValidMinutes: 60 });
    const res = await requestLink(
      post('/returns/guest/request', { email: 'anna@example.test', origin: 'sent' }, `b2b_returns_guest_pending=${pending}`),
    );
    expect(api.requestGuestVerification).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBe('/returns/guest/sent?wait=1');
  });
});

describe('the sent page (S-2)', () => {
  it('shows the address this browser typed, the link’s lifetime and Send again', async () => {
    pendingCookie = encodeGuestPending({ email: 'anna@example.test', requestedAt: Date.now() - 120_000, linkValidMinutes: 60 });
    const out = await renderPage(SentPage, {});
    const text = visibleText(out);
    expect(out).toContain('<strong>anna@example.test</strong>');
    expect(text).toContain('60');
    expect(out).toMatch(/<form[^>]*action="\/returns\/guest\/request"/);
    expect(out).toMatch(/name="email"[^>]*value="anna@example.test"|value="anna@example.test"[^>]*name="email"/);
  });

  it('without the cookie shows the address-free sentence and no Send again', async () => {
    const out = await renderPage(SentPage, {});
    expect(visibleText(out)).toContain(en('returns.guest.sent.bodyNoAddress'));
    expect(out).not.toContain('action="/returns/guest/request"');
  });
});

describe('GET /returns/guest/verify (S-3, F-5)', () => {
  it('shows Continue, posting the token, and redeems nothing', async () => {
    const out = await renderPage(VerifyPage, { token: 'sealed-token' });
    expect(api.redeemGuestLink).not.toHaveBeenCalled();
    expect(out).toMatch(/<form(?=[^>]*method="post")[^>]*action="\/returns\/guest\/verify\/continue"/);
    expect(out).toMatch(/name="token"[^>]*value="sealed-token"|value="sealed-token"[^>]*name="token"/);
    expect(visibleText(out)).toContain(en('returns.guest.verify.continue'));
    // It never submits itself: no refresh, no autofocus.
    expect(out).not.toMatch(/http-equiv="refresh"/i);
    expect(out).not.toMatch(/autofocus/i);
  });

  it('shows the same Continue page while a guest session is live: the GET never redirects (O-2)', async () => {
    guestSession = 'live';
    api.getGuestFormConfig.mockResolvedValue({ verifiedEmail: 'anna@example.test' });
    const out = await renderPage(VerifyPage, { token: 'sealed-token' });
    expect(out).toContain('action="/returns/guest/verify/continue"');
    expect(redirects).toEqual([]);
  });
});

describe('POST /returns/guest/verify/continue', () => {
  it('redeems, sets b2b_returns_guest (HttpOnly, SameSite=Lax, Path=/, Max-Age) and goes to the form', async () => {
    api.redeemGuestLink.mockResolvedValue({
      sessionToken: 'opaque-session',
      email: 'anna@example.test',
      expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    });
    const res = await continueLink(post('/returns/guest/verify/continue', { token: 'sealed-token' }));
    expect(api.redeemGuestLink.mock.calls[0]![0]).toBe('sealed-token');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/returns/guest/new');
    const cookie = cookieNamed(res, 'b2b_returns_guest')!;
    expect(cookie).toMatch(/^b2b_returns_guest=opaque-session;/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/(;|$)/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)![1]);
    expect(maxAge).toBeGreaterThan(86_000);
    expect(maxAge).toBeLessThanOrEqual(86_400);
  });

  it('answers a refused link (410, or the second POST of a double click) with the invalid state, not an error page (F-3)', async () => {
    api.redeemGuestLink.mockRejectedValue(new StorefrontApiError(410, 'RETURN_GUEST_LINK_INVALID', 'gone'));
    const res = await continueLink(post('/returns/guest/verify/continue', { token: 'used' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/returns/guest/verify?state=invalid');
    expect(cookieNamed(res, 'b2b_returns_guest')).toBeUndefined();
  });

  it('answers the setting off with the entry’s disabled notice', async () => {
    api.redeemGuestLink.mockRejectedValue(new StorefrontApiError(403, 'RETURN_GUEST_COMPLAINTS_DISABLED', 'off'));
    const res = await continueLink(post('/returns/guest/verify/continue', { token: 't' }));
    expect(res.headers.get('location')).toBe('/returns/guest?error=disabled');
  });
});

describe('the invalid state, /returns/guest/verify?state=invalid (S-4, O-2, O-3)', () => {
  it('continues to the form while this browser holds any live guest session', async () => {
    guestSession = 'live';
    api.getGuestFormConfig.mockResolvedValue({ verifiedEmail: 'anna@example.test' });
    await expect(renderPage(VerifyPage, { state: 'invalid' })).rejects.toThrow();
    expect(redirects).toEqual(['/returns/guest/new']);
  });

  it('shows "this link no longer works" with a new-link form, empty when this browser did not ask', async () => {
    guestSession = 'expired';
    api.getGuestFormConfig.mockRejectedValue(new StorefrontApiError(401, 'RETURN_GUEST_SESSION_REQUIRED', 'no'));
    const out = await renderPage(VerifyPage, { state: 'invalid' });
    expect(visibleText(out)).toContain(en('returns.guest.invalid.heading'));
    expect(out).toMatch(/<form[^>]*action="\/returns\/guest\/request"/);
    expect(out).toMatch(/name="email"/);
    expect(out).not.toMatch(/name="email"[^>]*value="[^"]+"/);
  });

  it('prefills the address only when this browser asked for the link (O-3)', async () => {
    pendingCookie = encodeGuestPending({ email: 'anna@example.test', requestedAt: Date.now() - 3_600_000, linkValidMinutes: 60 });
    const out = await renderPage(VerifyPage, { state: 'invalid' });
    expect(out).toMatch(/name="email"[^>]*value="anna@example.test"|value="anna@example.test"[^>]*name="email"/);
  });

  it('shows the same page for a link with no token', async () => {
    const out = await renderPage(VerifyPage, {});
    expect(visibleText(out)).toContain(en('returns.guest.invalid.heading'));
  });

  it('replaces the new-link form with the disabled notice while guest complaints are off', async () => {
    api.getGuestAvailability.mockResolvedValue(false);
    const text = visibleText(await renderPage(VerifyPage, { state: 'invalid' }));
    expect(text).toContain(en('returns.guest.disabled'));
    expect(text).not.toContain(en('returns.guest.invalid.send'));
  });
});

describe('POST /returns/guest/leave', () => {
  it('ends the session at the backend with the guest cookie and deletes both cookies', async () => {
    const res = await leave(post('/returns/guest/leave', {}, 'b2b_returns_guest=live; b2b_session=customer'));
    expect(api.leaveGuestSession.mock.calls[0]![0]).toBe('live');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/returns/guest');
    expect(cookieNamed(res, 'b2b_returns_guest')).toMatch(/Max-Age=0/);
    expect(cookieNamed(res, 'b2b_returns_guest_pending')).toMatch(/Max-Age=0/);
  });

  it('still deletes the cookies when the backend cannot be reached', async () => {
    api.leaveGuestSession.mockRejectedValue(new Error('down'));
    const res = await leave(post('/returns/guest/leave', {}, 'b2b_returns_guest=live'));
    expect(cookieNamed(res, 'b2b_returns_guest')).toMatch(/Max-Age=0/);
  });
});
