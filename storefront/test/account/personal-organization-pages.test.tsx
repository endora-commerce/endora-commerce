import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { MeResult } from '../../lib/api/account';
import type { AddressSummary } from '../../lib/api/organization';
import { organizationCompanyTaxId } from '@endora-commerce/contracts';
import { visibleText } from './i18n/text';

/**
 * Issue #757 — a B2C customer's personal Organization is not a company, so the
 * storefront does not present it as one. FR-070a already hid *Members*, *Roles*
 * and *Carts to approve* by the Organization's **kind** (`isPersonal`), never by
 * the role; the same gate (`lib/account/organization-area.ts`) now also covers
 * the account navigation's *Organization* and *Org addresses* links, the two
 * pages behind them, the profile's *Organization* row and the name under the
 * customer's own in the sidebar. `/organization` sends that member to
 * `/account`, `/organization/addresses` to their own address book,
 * `/addresses`. Nothing renders the personal Organization's placeholder tax id.
 *
 * A company Organization keeps all of it, in both languages.
 */

const PLACEHOLDER_TAX_ID = '79963f233e3843bd84e144a8fcdd37f8';

let locale = 'en-US';
let isPersonal = false;
let meFails = false;

function me(): MeResult {
  return {
    customerAccount: {
      id: '79963f23-3e38-43bd-84e1-44a8fcdd37f8',
      organizationId: 'org-1',
      email: 'anna@example.com',
      firstName: 'Anna',
      lastName: 'Nowak',
      organizationRole: { id: '00000000-0000-4000-8000-0000000000a1', kind: 'administrator', name: 'Administrator' },
      permissions: ['carts.create', 'carts.approve', 'addresses.manage'],
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      twoFactorEnabled: false,
    },
    organization: isPersonal
      ? {
          id: 'org-1',
          name: 'Anna Nowak',
          taxId: PLACEHOLDER_TAX_ID,
          status: 'active',
          vatStatus: 'vat_exempt',
          isPersonal: true,
          registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
        }
      : {
          id: 'org-1',
          name: 'Acme',
          taxId: '1234567890',
          status: 'active',
          vatStatus: 'vat_payer',
          isPersonal: false,
          registeredAddress: { street: 'Main 1', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
        },
    impersonation: null,
  };
}

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

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
  getAnonCartCookie: async () => undefined,
  clearSessionCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale,
    ctx: { locale },
    modules: { isPresent: () => true, presentIds: [], absentIds: [] },
  }),
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
    return me();
  },
}));
vi.mock('../../lib/api/auth', () => ({ logoutCustomer: async () => undefined }));
vi.mock('../../lib/api/cart', () => ({
  listOrganizationCarts: async () => ({ data: [], meta: { page: 1, pageSize: 20, totalCount: 0 } }),
}));
vi.mock('../../lib/api/credit-limit', () => ({ getMyCreditLimit: async () => null }));
vi.mock('../../lib/api/pwa-server', () => ({
  fetchPwaConfig: async () => ({ pushEnabled: false }),
  getPushPreferences: async () => null,
  updatePushPreferences: async () => undefined,
}));
vi.mock('../../lib/api/organization', () => ({
  listAddresses: async () => [address],
  createAddress: async () => undefined,
  deleteAddress: async () => undefined,
  getMyRole: async () => ({
    role: { id: '00000000-0000-4000-8000-0000000000a1', kind: 'administrator', name: 'Administrator' },
    permissions: [],
  }),
}));

const { default: AccountLayout } = await import('../../app/(account)/layout');
const { default: ProfilePage } = await import('../../app/(account)/account/page');
const { default: OrganizationPage } = await import('../../app/(account)/organization/page');
const { default: OrganizationAddressesPage } = await import('../../app/(account)/organization/addresses/page');

async function render(element: unknown): Promise<string> {
  return renderToString(<>{(await element) as ReactNode}</>);
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as Error).message;
  }
  return 'resolved';
}

const layout = () => AccountLayout({ children: null });
const profile = () => ProfilePage({ searchParams: Promise.resolve({}) });
const summary = () => OrganizationPage();
const orgAddresses = () => OrganizationAddressesPage({ searchParams: Promise.resolve({}) });

const LOCALES = [
  { code: 'en-US', organization: 'Organization', orgAddresses: 'Org addresses', profileRow: 'Organization Acme' },
  { code: 'pl-PL', organization: 'Organizacja', orgAddresses: 'Adresy organizacji', profileRow: 'Organizacja Acme' },
] as const;

beforeEach(() => {
  locale = 'en-US';
  isPersonal = false;
  meFails = false;
});

describe.each(LOCALES)('a personal Organization is not shown as a company ($code, issue #757)', (l) => {
  beforeEach(() => {
    locale = l.code;
    isPersonal = true;
  });

  it('the account navigation offers neither the Organization nor its addresses', async () => {
    const html = await render(layout());
    expect(html).not.toContain('href="/organization"');
    expect(html).not.toContain('href="/organization/addresses"');
    const text = visibleText(html);
    expect(text).not.toContain(l.organization);
    expect(text).not.toContain(l.orgAddresses);
    // The buyer's own address book and orders stay.
    expect(html).toContain('href="/addresses"');
    expect(html).toContain('href="/orders"');
  });

  it('the sidebar does not repeat the personal Organization’s name under the customer’s', async () => {
    const text = visibleText(await render(layout()));
    expect(text.match(/Anna Nowak/g)).toHaveLength(1);
  });

  it('the profile has no Organization row', async () => {
    const text = visibleText(await render(profile()));
    expect(text).not.toContain(`${l.organization} Anna Nowak`);
    expect(text).not.toMatch(new RegExp(`${l.organization} —`));
  });

  it('/organization sends the member to the account page', async () => {
    expect(await rejection(summary())).toBe('redirect /account');
  });

  it('/organization/addresses sends the member to their own address book', async () => {
    expect(await rejection(orgAddresses())).toBe('redirect /addresses');
  });

  it('never renders the placeholder tax id', async () => {
    for (const page of [layout, profile]) {
      expect(await render(page())).not.toContain(PLACEHOLDER_TAX_ID);
    }
  });
});

describe.each(LOCALES)('a company Organization keeps its pages ($code, issue #757)', (l) => {
  beforeEach(() => {
    locale = l.code;
  });

  it('the account navigation offers the Organization and its addresses', async () => {
    const html = await render(layout());
    expect(html).toContain('href="/organization"');
    expect(html).toContain('href="/organization/addresses"');
    const text = visibleText(html);
    expect(text).toContain(`${l.organization}${l.orgAddresses}`);
    expect(text).toContain('Acme');
  });

  it('the profile names the Organization', async () => {
    expect(visibleText(await render(profile()))).toContain(l.profileRow);
  });

  it('/organization renders the summary with the tax id', async () => {
    const text = visibleText(await render(summary()));
    expect(text).toContain('Acme');
    expect(text).toContain('1234567890');
  });

  it('/organization/addresses renders the list', async () => {
    expect(visibleText(await render(orgAddresses()))).toContain('Acme Billing');
  });
});

describe('/organization/addresses when the session cannot be read (issue #757)', () => {
  it('keeps the page: the API is the gate', async () => {
    meFails = true;
    expect(visibleText(await render(orgAddresses()))).toContain('Acme Billing');
  });
});

/**
 * The checkout's *Billing company details* block (`components/checkout/AddressSection.tsx`)
 * pre-fills its tax-id field from the session's Organization. A personal
 * Organization's tax id is an internal placeholder derived from the account id,
 * so the field starts empty there and the buyer may still type a real one.
 *
 * Issue #767 (owner ruling of 2026-11-05): the rule is the platform's one
 * `organizationCompanyTaxId` from `@endora-commerce/contracts`, not a copy of it
 * kept here.
 */
describe('the checkout billing tax-id default (issues #757, #767)', () => {
  it('is the tax id of a company Organization', () => {
    expect(organizationCompanyTaxId(me().organization!)).toBe('1234567890');
  });

  it('is empty for a personal Organization', () => {
    isPersonal = true;
    expect(organizationCompanyTaxId(me().organization!)).toBeNull();
  });

  it('is not a storefront copy of the rule', async () => {
    const area = await import('../../lib/account/organization-area');
    expect('companyTaxId' in area).toBe(false);
  });
});
