import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * Individual self-registration is not offered on a store closed to anonymous
 * visitors (`specs/154-sales-channel-access/contracts/storefront-ux.md` §2,
 * spec Q2): it signs the new account in at once, which would be a way into a
 * store that serves signed-in business customers only. The middleware sends an
 * anonymous visitor to the sign-in page; the page itself sends anybody else.
 */

const state = { anonymousAccess: false };

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    // Feature 167 — no URL languages known: paths stay as written.
    urlState: { languages: [], aliases: [], current: 'en-US' },
    ctx: { locale: 'en-US', salesChannelCode: 'trade' },
    locale: 'en-US',
    anonymousAccess: state.anonymousAccess,
  }),
}));
vi.mock('../../lib/session', () => ({ setSessionCookie: vi.fn() }));
vi.mock('../../components/newsletter/NewsletterConsent', () => ({ NewsletterConsent: () => null }));
vi.mock('../../lib/api/customer-registration', () => ({
  getCustomerRegistrationOptions: async () => ({ allowRegistrationWithoutOrganization: true }),
}));

const { default: RegisterCustomerPage } = await import('../../app/(auth)/register-customer/page');

describe('/register-customer', () => {
  it('redirects to the sign-in page on a closed store', async () => {
    state.anonymousAccess = false;
    const rendered = RegisterCustomerPage({ searchParams: Promise.resolve({}) });
    await expect(rendered).rejects.toMatchObject({ digest: expect.stringContaining(';/login;') });
  });

  it('renders the form on an open store', async () => {
    state.anonymousAccess = true;
    const html = renderToString(await RegisterCustomerPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Create your account');
  });
});
