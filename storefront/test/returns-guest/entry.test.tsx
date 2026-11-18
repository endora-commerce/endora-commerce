import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { tForLocale } from '../../lib/i18n/messages';
import { visibleText } from '../account/i18n/text';

/**
 * `specs/181-guest-complaints/` T062 (FR-010, FR-011; design review S-1, F-1, F-7, F-14,
 * F-22): the way in for a visitor without a session.
 *
 * - A signed-out visit to the returns area or the no-order form goes to the guest entry
 *   while guest complaints are in effect, and to sign-in otherwise — path and query kept,
 *   whether the page or the `(account)` layout answers first (F-1).
 * - The entry offers *Sign in* (`next` = `from`) and *Continue without an account*, with
 *   the e-mail field inline.
 */
const en = tForLocale('en-US');

let session: string | null = null;
let guestEnabled = true;
let pendingCookie: string | undefined;
let requestHeaders: Record<string, string> = {};
const redirects: string[] = [];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'b2b_returns_guest_pending' && pendingCookie ? { value: pendingCookie } : undefined),
  }),
  headers: async () => new Headers(requestHeaders),
}));
vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => session,
  clearSessionCookie: async () => undefined,
  getReturnsGuestSession: async () => null,
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
vi.mock('../../lib/api/returns-guest', () => ({
  getGuestAvailability: async () => guestEnabled,
}));
vi.mock('../../lib/api/returns', () => ({
  listMyReturns: async () => [],
  getReturnFormConfig: async () => ({ offPlatformComplaintsEnabled: true }),
}));
vi.mock('../../lib/api/account', () => ({ getMe: async () => null }));

const { signedOutReturnsTarget } = await import('../../lib/returns/guest');
const { sanitiseNext } = await import('../../lib/auth/next-path');
const { default: NewReturnPage } = await import('../../app/(account)/returns/new/page');
const { default: ReturnsListPage } = await import('../../app/(account)/returns/page');
const { default: AccountLayout } = await import('../../app/(account)/layout');
const { default: GuestEntryPage } = await import('../../app/returns/guest/page');
const { encodeGuestPending } = await import('../../lib/returns/guest');

const renderEntry = async (searchParams: Record<string, string> = {}): Promise<string> =>
  renderToString(<>{(await GuestEntryPage({ searchParams: Promise.resolve(searchParams) })) as React.ReactElement}</>);

const FROM = '/returns/new?origin=elsewhere';

beforeEach(() => {
  session = null;
  guestEnabled = true;
  pendingCookie = undefined;
  requestHeaders = {};
  redirects.length = 0;
});

describe('signedOutReturnsTarget', () => {
  it('sends to the guest entry while guest complaints are in effect, to sign-in otherwise, path and query kept', () => {
    expect(signedOutReturnsTarget(FROM, true)).toBe(`/returns/guest?from=${encodeURIComponent(FROM)}`);
    expect(signedOutReturnsTarget(FROM, false)).toBe(`/login?next=${encodeURIComponent(FROM)}`);
  });
});

describe('sanitiseNext (F-22: one rule, shared with sign-in)', () => {
  it('keeps a same-origin path and refuses anything that could leave the shop', () => {
    expect(sanitiseNext(FROM)).toBe(FROM);
    expect(sanitiseNext(undefined)).toBe('/account');
    expect(sanitiseNext('//evil.example/x')).toBe('/account');
    expect(sanitiseNext('/\\evil.example')).toBe('/account');
    expect(sanitiseNext('https://evil.example')).toBe('/account');
    expect(sanitiseNext('//evil', '/returns/new?origin=elsewhere')).toBe('/returns/new?origin=elsewhere');
  });
});

describe('the signed-out redirect of the two account entry pages (T072)', () => {
  it('sends /returns/new?origin=elsewhere to the guest entry while guest complaints are on', async () => {
    await expect(NewReturnPage({ searchParams: Promise.resolve({ origin: 'elsewhere' }) })).rejects.toThrow();
    expect(redirects).toEqual([`/returns/guest?from=${encodeURIComponent(FROM)}`]);
  });

  it('keeps today’s sign-in redirect, query included, while they are off (180 D-14)', async () => {
    guestEnabled = false;
    await expect(NewReturnPage({ searchParams: Promise.resolve({ origin: 'elsewhere' }) })).rejects.toThrow();
    expect(redirects).toEqual([`/login?next=${encodeURIComponent(FROM)}`]);
  });

  it('applies the same rule to the returns list', async () => {
    await expect(ReturnsListPage()).rejects.toThrow();
    expect(redirects).toEqual([`/returns/guest?from=${encodeURIComponent('/returns')}`]);
    redirects.length = 0;
    guestEnabled = false;
    await expect(ReturnsListPage()).rejects.toThrow();
    expect(redirects).toEqual([`/login?next=${encodeURIComponent('/returns')}`]);
  });
});

describe('the (account) layout signed out (F-1)', () => {
  const layout = (): Promise<unknown> => AccountLayout({ children: null });

  it('answers the returns pages as the pages do, so neither the guest choice nor D-14 is pre-empted', async () => {
    requestHeaders = { 'x-pathname': '/returns/new', 'x-search': '?origin=elsewhere' };
    await expect(layout()).rejects.toThrow();
    expect(redirects).toEqual([`/returns/guest?from=${encodeURIComponent(FROM)}`]);

    redirects.length = 0;
    guestEnabled = false;
    await expect(layout()).rejects.toThrow();
    expect(redirects).toEqual([`/login?next=${encodeURIComponent(FROM)}`]);
  });

  it('keeps /login?next=/account for every other account page', async () => {
    requestHeaders = { 'x-pathname': '/orders', 'x-search': '?page=2' };
    await expect(layout()).rejects.toThrow();
    expect(redirects).toEqual(['/login?next=/account']);
  });
});

describe('the guest entry, /returns/guest (S-1)', () => {
  it('offers Sign in with next = from, and Continue without an account with the e-mail inline', async () => {
    const out = await renderEntry({ from: FROM });
    expect(out).toContain(`href="/login?next=${encodeURIComponent(FROM)}"`);
    expect(out).toMatch(/<form(?=[^>]*method="post")[^>]*action="\/returns\/guest\/request"/);
    expect(out).toMatch(/<input[^>]*type="email"[^>]*name="email"|name="email"[^>]*type="email"/);
    expect(out).toMatch(/name="from"[^>]*value="\/returns\/new\?origin=elsewhere"|value="\/returns\/new\?origin=elsewhere"[^>]*name="from"/);
    // The honeypot: off-screen, out of the tab order, never display:none.
    expect(out).toMatch(/aria-hidden="true"[^>]*>.*name="hp"/s);
    expect(out).toMatch(/name="hp"[^>]*tabindex="-1"|tabindex="-1"[^>]*name="hp"/i);
    const text = visibleText(out);
    expect(text).toContain(en('returns.guest.entry.signInHeading'));
    expect(text).toContain(en('returns.guest.entry.guestHeading'));
    // Sign-in first: a purchase from this shop is directed there (FR-010).
    expect(text.indexOf(en('returns.guest.entry.signInHeading'))).toBeLessThan(text.indexOf(en('returns.guest.entry.guestHeading')));
    // No address goes in the URL, and the page is not indexed.
    expect(out).not.toContain('email=');
  });

  it('never offers a next that leaves the shop', async () => {
    const out = await renderEntry({ from: '//evil.example' });
    expect(out).not.toContain('evil.example');
    expect(out).toContain(`href="/login?next=${encodeURIComponent(FROM)}"`);
  });

  it('sends a signed-in visitor on to where they were going', async () => {
    session = 'customer';
    await expect(renderEntry({ from: '/returns' })).rejects.toThrow();
    expect(redirects).toEqual(['/returns']);
  });

  it('keeps sign-in as the only way while guest complaints are off (FR-010)', async () => {
    guestEnabled = false;
    await expect(renderEntry({ from: FROM })).rejects.toThrow();
    expect(redirects).toEqual([`/login?next=${encodeURIComponent(FROM)}`]);
  });

  it('says so when guest complaints were switched off mid-flow (FR-002)', async () => {
    guestEnabled = false;
    const text = visibleText(await renderEntry({ error: 'disabled' }));
    expect(text).toContain(en('returns.guest.disabled'));
    expect(text).not.toContain(en('returns.guest.entry.send'));
  });

  it('words a malformed address and a throttle, and prefills the address this browser asked with', async () => {
    pendingCookie = encodeGuestPending({ email: 'anna@example', requestedAt: 0, linkValidMinutes: 60 });
    const out = await renderEntry({ error: 'email' });
    expect(visibleText(out)).toContain(en('returns.guest.errors.email'));
    expect(out).toMatch(/aria-invalid="true"/);
    expect(out).toMatch(/value="anna@example"/);
    expect(visibleText(await renderEntry({ error: 'rate_limited' }))).toContain(en('returns.guest.errors.rate_limited'));
  });

  it('explains an expired form session and that files need adding again (F-14)', async () => {
    const text = visibleText(await renderEntry({ reason: 'session_expired', from: '/returns/guest/new' }));
    expect(text).toContain(en('returns.guest.entry.sessionExpired'));
  });
});
