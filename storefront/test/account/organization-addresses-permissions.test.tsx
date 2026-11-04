import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { AddressSummary } from '../../lib/api/organization';
import { mayManageOrganizationAddresses } from '../../lib/account/organization-addresses';
import { visibleText } from './i18n/text';

/**
 * Feature 170 (`specs/170-organization-roles/` WP-16, T157; FR-057, OR-8) — adding and removing an
 * Organization address needs `addresses.manage` (`contracts/storefront-api.md` §4, enforced since
 * WP-03); reading the list stays open. The owner's ruling of 2026-11-04: a member who cannot act
 * is not shown the controls. `/organization/addresses` therefore renders the list for everyone,
 * and the add form and the *Remove* buttons only to a holder — a member without the code reads
 * one line saying why, in place of the form. A session that cannot be read keeps today's page:
 * the server is the gate.
 */

let locale = 'en-US';
let permissions: string[] = ['addresses.manage'];
let meFails = false;

const address: AddressSummary = {
  id: 'a1',
  organizationId: 'org-1',
  kind: 'billing',
  recipientName: 'Acme Billing',
  street: 'Main 1',
  city: 'Krakow',
  postalCode: '30-001',
  country: 'PL',
  phone: null,
  isDefault: true,
};

vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale } }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/dictionary/pickers/CountryPicker', () => ({ CountryPicker: () => null }));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => {
    if (meFails) throw new Error('me unavailable');
    return {
      customerAccount: {
        id: 'member-1',
        organizationRole: { id: 'role-1', kind: 'custom', name: 'Purchasing' },
        permissions,
      },
      organization: { id: 'org-1', name: 'Acme', isPersonal: false },
      impersonation: null,
    };
  },
}));
vi.mock('../../lib/api/organization', () => ({
  listAddresses: async () => [address],
  createAddress: async () => undefined,
  deleteAddress: async () => undefined,
}));

const { default: AddressesPage } = await import('../../app/(account)/organization/addresses/page');

async function html(): Promise<string> {
  const element = await AddressesPage({ searchParams: Promise.resolve({}) });
  return renderToString(<>{element as React.ReactElement}</>).replaceAll('<!-- -->', '');
}

const COPY = {
  'en-US': {
    add: 'Add an address',
    submit: 'Add address',
    remove: 'Remove',
    notice: 'Your role does not allow adding or removing addresses. You can still view them and use them at checkout.',
  },
  'pl-PL': {
    add: 'Dodaj adres',
    submit: 'Dodaj adres',
    remove: 'Usuń',
    notice: 'Twoja rola nie pozwala dodawać ani usuwać adresów. Możesz je przeglądać i używać przy składaniu zamówienia.',
  },
} as const;

beforeEach(() => {
  locale = 'en-US';
  permissions = ['addresses.manage'];
  meFails = false;
});

describe('mayManageOrganizationAddresses', () => {
  it('follows addresses.manage for a member', () => {
    expect(mayManageOrganizationAddresses({ permissions: ['addresses.manage'] })).toBe(true);
    expect(mayManageOrganizationAddresses({ permissions: ['carts.create', 'quote_requests.create'] })).toBe(false);
    expect(mayManageOrganizationAddresses({ permissions: [] })).toBe(false);
  });

  it('keeps today’s page when the session could not be read — the server judges', () => {
    expect(mayManageOrganizationAddresses(null)).toBe(true);
  });
});

describe.each(['en-US', 'pl-PL'] as const)('/organization/addresses by permission (%s)', (lang) => {
  beforeEach(() => {
    locale = lang;
  });

  it('offers the add form and Remove to a holder of addresses.manage', async () => {
    const out = await html();
    const text = visibleText(out);
    expect(text).toContain('Acme Billing');
    expect(text).toContain(COPY[lang].add);
    expect(out).toContain(`>${COPY[lang].remove}</button>`);
    expect(out).toContain('name="recipientName"');
    expect(text).not.toContain(COPY[lang].notice);
  });

  it('keeps the list readable but shows no add form and no Remove to a member without it', async () => {
    permissions = ['carts.create', 'quote_requests.create'];
    const out = await html();
    const text = visibleText(out);
    expect(text).toContain('Acme Billing');
    expect(text).toContain('Main 1, 30-001 Krakow, PL');
    expect(out).not.toContain(`>${COPY[lang].remove}</button>`);
    expect(out).not.toContain('name="recipientName"');
    expect(out).not.toContain(`>${COPY[lang].submit}</button>`);
    expect(text).toContain(COPY[lang].notice);
  });

  it('keeps today’s page when the session could not be read', async () => {
    meFails = true;
    const out = await html();
    expect(out).toContain(`>${COPY[lang].remove}</button>`);
    expect(out).toContain('name="recipientName"');
  });
});
