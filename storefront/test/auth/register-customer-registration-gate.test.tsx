import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Issue #756 — `/register-customer` knows whether individual registration is
 * offered before it renders. While
 * `customers.allow_registration_without_organization` is off, the visitor gets
 * the notice and the link to the organization registration, and no form to
 * fill in only to have it refused on submit. Rendered server-side in `en-US`
 * and `pl-PL`, with the setting on and off.
 */

const state = {
  locale: 'en-US',
  customersPresent: true,
  options: { allowRegistrationWithoutOrganization: false } as {
    allowRegistrationWithoutOrganization: boolean;
  } | null,
};

vi.mock('../../lib/server-context', () => ({
  getServerContext: vi.fn(async () => ({
    locale: state.locale,
    anonymousAccess: true,
    ctx: { salesChannelCode: 'trade', locale: state.locale },
    urlState: { languages: [], aliases: [], current: state.locale },
    modules: { isPresent: (id: string) => id !== 'customers' || state.customersPresent },
  })),
}));
vi.mock('../../lib/session', () => ({ setSessionCookie: vi.fn() }));
vi.mock('../../components/newsletter/NewsletterConsent', () => ({ NewsletterConsent: () => null }));
vi.mock('../../lib/api/customer-registration', () => ({
  getCustomerRegistrationOptions: vi.fn(async () => state.options),
}));

const { default: RegisterCustomerPage } = await import('../../app/(auth)/register-customer/page');
const { default: RegisterCustomerLayout } = await import('../../app/(auth)/register-customer/layout');

/** The segment as Next.js renders it: the layout, then the page inside it. */
async function render(searchParams: Record<string, string> = {}): Promise<string> {
  const page = await RegisterCustomerPage({ searchParams: Promise.resolve(searchParams) });
  const tree = await RegisterCustomerLayout({ children: page as ReactElement });
  return renderToString(tree as ReactElement).replace(/<!-- -->/g, '');
}

const COPY = {
  'en-US': {
    heading: 'Create your account',
    notice: 'Registration without an organization is currently disabled.',
    link: 'Register your organization',
    field: 'First name',
  },
  'pl-PL': {
    heading: 'Załóż konto',
    notice: 'Rejestracja bez organizacji jest obecnie wyłączona.',
    link: 'zarejestruj swoją organizację',
    field: 'Imię',
  },
} as const;

beforeEach(() => {
  state.locale = 'en-US';
  state.customersPresent = true;
  state.options = { allowRegistrationWithoutOrganization: false };
});

for (const locale of ['en-US', 'pl-PL'] as const) {
  const copy = COPY[locale];

  describe(`/register-customer in ${locale}`, () => {
    it('shows the notice with the organization-registration link and no form while the setting is off', async () => {
      state.locale = locale;
      state.options = { allowRegistrationWithoutOrganization: false };
      const html = await render();
      expect(html).toContain(copy.heading);
      expect(html).toContain(copy.notice);
      expect(html).toMatch(new RegExp(`<a[^>]*href="/register"[^>]*>${copy.link}</a>`));
      expect(html).toContain('role="status"');
      expect(html).not.toContain('<form');
      expect(html).not.toContain('name="password"');
      expect(html).not.toContain(copy.field);
    });

    it('renders the form while the setting is on', async () => {
      state.locale = locale;
      state.options = { allowRegistrationWithoutOrganization: true };
      const html = await render();
      expect(html).toContain(copy.heading);
      expect(html).toContain('<form');
      expect(html).toContain(copy.field);
      expect(html).not.toContain(copy.notice);
    });

    it('keeps the post-submit refusal as the fallback for a setting switched off mid-visit', async () => {
      state.locale = locale;
      state.options = { allowRegistrationWithoutOrganization: true };
      const html = await render({ orgRequired: '1' });
      expect(html).toContain(copy.notice);
      expect(html).toMatch(new RegExp(`<a[^>]*href="/register"[^>]*>${copy.link}</a>`));
    });

    // Constitution XVII — with `customers` off the page behaves as if it had
    // never been installed: not-found, whatever the setting says.
    it('answers not-found while the customers module is off', async () => {
      state.locale = locale;
      state.customersPresent = false;
      for (const allowed of [true, false]) {
        state.options = { allowRegistrationWithoutOrganization: allowed };
        await expect(render()).rejects.toMatchObject({
          digest: expect.stringContaining('404'),
        });
      }
    });

    it('renders the form when the setting cannot be read, leaving the refusal to the backend', async () => {
      state.locale = locale;
      state.options = null;
      const html = await render();
      expect(html).toContain('<form');
      expect(html).not.toContain(copy.notice);
    });
  });
}
