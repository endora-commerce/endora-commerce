import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StorefrontApiError } from '../../lib/api/client';
import { tForLocale } from '../../lib/i18n/messages';
import { visibleText } from '../account/i18n/text';

/**
 * `specs/181-guest-complaints/` T064, the form half (US1 scenario 5; FR-030, FR-031; edge
 * case *A signed-in customer opens a verification link*; design review S-5, S-6, F-4, F-8,
 * F-10, F-16).
 *
 * - The form is 180's no-order form (`OffPlatformForm`) in guest mode: the verified e-mail
 *   is text, not an input, nothing is prefilled, and it posts to the guest handler.
 * - A browser that is signed in is told the complaint will be a guest's.
 * - The success page shows the reference as its heading and the tracking link once, only
 *   to the browser that filed it.
 */
const en = tForLocale('en-US');

let guestSession: string | null = 'guest-session';
let customerSession: string | null = null;
let flashCookie: string | undefined;
let attemptCookie: string | undefined;
const redirects: string[] = [];
const getGuestFormConfig = vi.fn();

const CONFIG = {
  offPlatformComplaintsEnabled: true,
  proofOfPurchaseRequired: true,
  confirmationEmailEnabled: true,
  today: '2026-11-16',
  clauses: [{ id: 'c1', revision: 1, mode: 'must_accept', label: 'Complaint terms', text: 'We inspect first.', linkUrl: null }],
  attachmentLimits: { maxFileBytes: 10485760, maxSubmissionBytes: 31457280, maxFilesPerCase: 10, acceptedMimeTypes: ['image/jpeg', 'application/pdf'] },
  reasons: [{ id: 'r-complaint', label: { en: 'Defective' }, appliesTo: 'complaint', isActive: true, weight: 1 }],
  verifiedEmail: 'anna@example.test',
  sessionExpiresAt: '2026-11-17T10:00:00.000Z',
};

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value =
        name === 'b2b_returns_guest' ? guestSession : name === 'b2b_returns_guest_filed' ? flashCookie : name === 'returns_attempt' ? attemptCookie : undefined;
      return value ? { value } : undefined;
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => customerSession,
  getReturnsGuestSession: async () => guestSession,
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
vi.mock('../../lib/dictionary/pickers/CountryPicker', () => ({
  CountryPicker: (props: Record<string, unknown>) => <select {...props} />,
}));
vi.mock('../../lib/api/returns-guest', () => ({
  getGuestFormConfig: (...a: unknown[]) => getGuestFormConfig(...a),
  getGuestAvailability: async () => true,
}));

const { default: GuestFormPage } = await import('../../app/returns/guest/new/page');
const { default: SubmittedPage } = await import('../../app/returns/guest/submitted/[ref]/page');
const { encodeGuestFiled } = await import('../../lib/returns/guest');

const renderForm = async (searchParams: Record<string, string> = {}): Promise<string> =>
  renderToString(<>{(await GuestFormPage({ searchParams: Promise.resolve(searchParams) })) as React.ReactElement}</>);
const renderSubmitted = async (ref: string): Promise<string> =>
  renderToString(<>{(await SubmittedPage({ params: Promise.resolve({ ref }) })) as React.ReactElement}</>);

beforeEach(() => {
  guestSession = 'guest-session';
  customerSession = null;
  flashCookie = undefined;
  attemptCookie = undefined;
  redirects.length = 0;
  getGuestFormConfig.mockReset();
  getGuestFormConfig.mockResolvedValue(CONFIG);
});

describe('the guest form, /returns/guest/new (S-5)', () => {
  it('is 180’s no-order form posting to the guest handler, with the session forwarded for its config', async () => {
    const out = await renderForm();
    expect(getGuestFormConfig.mock.calls[0]![0]).toBe('guest-session');
    expect(out).toMatch(/<form[^>]*action="\/returns\/guest\/submit"[^>]*enctype="multipart\/form-data"|<form[^>]*enctype="multipart\/form-data"[^>]*action="\/returns\/guest\/submit"/i);
    expect(out).toMatch(/name="submissionKey" value="[0-9a-f-]{36}"/);
    expect(out).toContain('name="lines.0.modelName"');
    expect(out).toContain('name="purchase.date"');
    expect(out).toMatch(/name="lines\.0\.reasonId" value="r-complaint"/);
    expect(visibleText(out)).toContain(en('returns.elsewhere.heading'));
  });

  it('shows the verified e-mail as locked text, never as an input, and posts no contact.email (FR-031, F-4)', async () => {
    const out = await renderForm();
    expect(out).not.toContain('name="contact.email"');
    expect(out).toContain('anna@example.test');
    expect(visibleText(out)).toContain(en('returns.guest.form.verified'));
    expect(visibleText(out)).toContain(en('returns.guest.form.emailLocked'));
  });

  it('prefills nothing: name, phone and the return address are the guest’s to type', async () => {
    const out = await renderForm();
    expect(out).toMatch(/name="contact.name"(?![^>]*value="[^"]+")/);
    expect(out).toMatch(/name="returnAddress.street"(?![^>]*value="[^"]+")/);
    expect(out).not.toContain(en('returns.elsewhere.changesStayHere'));
    // A guest has no orders to choose instead, and no account page to cancel to.
    expect(out).not.toContain(en('returns.elsewhere.backToOrders'));
    expect(out).not.toContain('href="/returns"');
  });

  it('offers Use a different address through a leave form outside the main form (F-16)', async () => {
    const out = await renderForm();
    expect(out).toMatch(/<form[^>]*id="guest-leave"[^>]*action="\/returns\/guest\/leave"|<form[^>]*action="\/returns\/guest\/leave"[^>]*id="guest-leave"/);
    expect(out).toMatch(/<button[^>]*form="guest-leave"/);
    // The leave form is not nested in the complaint form.
    const main = out.indexOf('action="/returns/guest/submit"');
    expect(out.indexOf('id="guest-leave"')).toBeLessThan(main);
  });

  it('tells a signed-in browser that the complaint will be a guest’s, and offers the account instead', async () => {
    expect(visibleText(await renderForm())).not.toContain(en('returns.guest.form.signedInLink'));
    customerSession = 'customer';
    const out = await renderForm();
    expect(visibleText(out)).toContain(en('returns.guest.form.signedInLink'));
    expect(out).toContain('href="/returns/new?origin=elsewhere"');
  });

  it('sends a browser with no guest session, or an expired one, to the entry', async () => {
    guestSession = null;
    await expect(renderForm()).rejects.toThrow();
    guestSession = 'stale';
    getGuestFormConfig.mockRejectedValue(new StorefrontApiError(401, 'RETURN_GUEST_SESSION_REQUIRED', 'no'));
    await expect(renderForm()).rejects.toThrow();
    expect(redirects).toEqual(['/returns/guest', '/returns/guest']);
  });

  it('replaces the form with the disabled notice while guest complaints are off (FR-002)', async () => {
    getGuestFormConfig.mockRejectedValue(new StorefrontApiError(403, 'RETURN_GUEST_COMPLAINTS_DISABLED', 'off'));
    const out = await renderForm();
    expect(visibleText(out)).toContain(en('returns.guest.disabled'));
    expect(out).not.toContain('action="/returns/guest/submit"');
  });

  it('says which guest limit was reached, never the raw code (F-17)', async () => {
    attemptCookie = Buffer.from(JSON.stringify({ answers: {}, errors: ['guest_limit_cases_per_session'], uploads: [] })).toString('base64url');
    const text = visibleText(await renderForm({ error: 'refused' }));
    expect(text).toContain(en('returns.guest.errors.cases_per_session'));
    expect(text).not.toContain('guest_limit_cases_per_session');
  });
});

describe('the success page, /returns/guest/submitted/[ref] (S-6, F-8)', () => {
  const filed = { ref: '#3F9A21C0', trackingToken: 'tok_abc', email: 'anna@example.test' };

  it('shows the reference as the heading, the tracking link to keep, and Copy link', async () => {
    flashCookie = encodeGuestFiled(filed);
    const out = await renderSubmitted(encodeURIComponent(filed.ref));
    expect(out).toMatch(/<h1[^>]*>[^<]*#3F9A21C0/);
    expect(out).toMatch(/<input[^>]*readOnly=""[^>]*value="[^"]*\/returns\/track\/tok_abc"|<input[^>]*value="[^"]*\/returns\/track\/tok_abc"[^>]*readOnly=""/i);
    // A plain link, so the tracking page loads as a document (F-2), and no referrer leaves.
    expect(out).toMatch(/<a[^>]*href="\/returns\/track\/tok_abc"[^>]*rel="noreferrer"|<a[^>]*rel="noreferrer"[^>]*href="\/returns\/track\/tok_abc"/);
    const text = visibleText(out);
    expect(text).toContain('anna@example.test');
    expect(text).toContain(en('returns.guest.submitted.keep'));
    expect(text).toContain(en('returns.guest.submitted.anyone'));
    // The end of the session, last.
    expect(out).toContain('action="/returns/guest/leave"');
  });

  it('shows nothing to a browser that did not file it: no cookie, or another reference', async () => {
    await expect(renderSubmitted('%233F9A21C0')).rejects.toThrow();
    flashCookie = encodeGuestFiled({ ...filed, ref: '#00000000' });
    await expect(renderSubmitted('%233F9A21C0')).rejects.toThrow();
    expect(redirects).toEqual(['/returns/guest', '/returns/guest']);
  });

  it('offers File another complaint only while the guest session lives', async () => {
    flashCookie = encodeGuestFiled(filed);
    expect(await renderSubmitted('%233F9A21C0')).toContain('href="/returns/guest/new"');
    guestSession = null;
    expect(await renderSubmitted('%233F9A21C0')).not.toContain('href="/returns/guest/new"');
  });
});
