import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { MeResult } from '../../../lib/api/account';
import type { AddressSummary } from '../../../lib/api/organization';
import type { CreditLimitView } from '../../../lib/api/credit-limit';
import { CreditLimitWidget } from '../../../components/CreditLimitWidget';
import { POLISH_DIACRITIC, visibleText } from './text';

/**
 * Issue #85 — the account shell and the organization pages render the shop's
 * language: the sidebar, the profile (role and organization status were codes
 * until now), the password, preferences and newsletter pages, both address
 * books, the members and carts pages, and the credit-limit widget's counted
 * sentence, in `en-US` and `pl-PL`.
 *
 * Feature 170 (FR-056, FR-058) — the role is the member's organization role,
 * named by the API in the page's language, and the profile lists what it
 * allows. The cart-approval policy page is gone (OR-3): approval follows the
 * role.
 */

let locale = 'en-US';
let ownPermissions: Array<{ code: string; label: string; description: string }> = [];
let ownRoleReads = 0;

const me: MeResult = {
  customerAccount: {
    id: 'acc-1',
    organizationId: 'org-1',
    email: 'anna@example.com',
    firstName: 'Anna',
    lastName: 'Nowak',
    organizationRole: { id: '00000000-0000-4000-8000-0000000000a1', kind: 'administrator', name: 'Administrator' },
    // The Administrator holds every code; these are the ones the pages read.
    permissions: ['carts.create', 'carts.approve', 'addresses.manage'],
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    twoFactorEnabled: false,
  },
  organization: {
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

const address: AddressSummary = {
  id: 'a1',
  organizationId: 'org-1',
  kind: 'billing',
  recipientName: 'Acme',
  street: 'Main 1',
  city: 'Krakow',
  postalCode: '30-001',
  country: 'PL',
  phone: null,
  isDefault: true,
};

vi.mock('../../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
  getAnonCartCookie: async () => undefined,
  clearSessionCookie: async () => undefined,
}));
vi.mock('../../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale,
    ctx: { locale },
    modules: { isPresent: () => true, presentIds: [], absentIds: [] },
  }),
}));
vi.mock('../../../lib/api/account', () => ({
  getMe: async () => me,
  changePassword: async () => undefined,
}));
// The country picker reads the dictionary provider the root layout mounts; its own copy is not this area's.
vi.mock('../../../lib/dictionary/pickers/CountryPicker', () => ({ CountryPicker: () => null }));
vi.mock('../../../lib/api/auth', () => ({ logoutCustomer: async () => undefined }));
vi.mock('../../../lib/api/credit-limit', () => ({ getMyCreditLimit: async () => null }));
vi.mock('../../../lib/api/pwa-server', () => ({
  fetchPwaConfig: async () => ({ pushEnabled: false }),
  getPushPreferences: async () => null,
  updatePushPreferences: async () => undefined,
}));
vi.mock('../../../lib/api/customers', () => ({
  listMyAddresses: async () => ({ personal: [address], organization: [{ ...address, kind: 'delivery' }] }),
  createMyAddress: async () => undefined,
  deleteMyAddress: async () => undefined,
  setMyDefaultAddress: async () => undefined,
}));
vi.mock('../../../lib/api/organization', () => ({
  listAddresses: async () => [address],
  createAddress: async () => undefined,
  deleteAddress: async () => undefined,
  listMembers: async () => [
    {
      id: 'acc-2',
      firstName: 'Jan',
      lastName: 'Kowalski',
      email: 'jan@example.com',
      organizationRole: { id: '00000000-0000-4000-8000-0000000000b1', kind: 'member', name: locale === 'pl-PL' ? 'Członek' : 'Member' },
    },
  ],
  listRoles: async () => [
    { id: '00000000-0000-4000-8000-0000000000a1', kind: 'administrator', name: 'Administrator', permissions: [] },
    { id: '00000000-0000-4000-8000-0000000000b1', kind: 'member', name: locale === 'pl-PL' ? 'Członek' : 'Member', permissions: [] },
  ],
  getMyRole: async () => (ownRoleReads++, {
    role: { id: '00000000-0000-4000-8000-0000000000a1', kind: 'administrator', name: 'Administrator' },
    permissions: ownPermissions,
  }),
  listPendingInvitations: async () => [
    {
      id: 'inv-1',
      organizationId: 'org-1',
      email: 'ola@example.com',
      organizationRole: { id: '00000000-0000-4000-8000-0000000000a1', kind: 'administrator', name: 'Administrator' },
      invitedByCustomerAccountId: null,
      expiresAt: '2026-11-10T00:00:00.000Z',
      createdAt: '2026-11-01T00:00:00.000Z',
    },
  ],
  inviteMember: async () => undefined,
  changeMemberRole: async () => undefined,
  removeMember: async () => undefined,
  revokeInvitation: async () => undefined,
}));
vi.mock('../../../lib/api/cart', () => ({
  listOrganizationCarts: async () => ({
    data: [
      {
        id: 'c1',
        ownerCustomerAccountId: 'acc-2',
        ownerDisplayName: 'Jan Kowalski',
        ownerEmail: 'jan@acme.example',
        orderId: null,
        status: 'active',
        approvalStatus: 'pending',
        itemCount: 3,
        total: { amount: 100, currency: 'EUR' },
        lastActivityAt: '2026-11-01T00:00:00.000Z',
        submittedForApprovalAt: null,
      },
    ],
    meta: { page: 1, pageSize: 20, totalCount: 1 },
  }),
}));
vi.mock('../../../lib/api/methods', () => ({
  listPaymentMethods: async () => [],
  listDeliveryMethods: async () => [],
}));
vi.mock('../../../lib/api/quick-order', () => ({
  getQuickOrderPreference: async () => null,
  upsertQuickOrderPreference: async () => undefined,
}));
vi.mock('../../../lib/api/newsletter', () => ({
  getSelfNewsletter: async () => ({ subscribed: true, tags: [{ name: 'B2B' }] }),
  selfSubscribeNewsletter: async () => undefined,
  selfUnsubscribeNewsletter: async () => undefined,
}));

async function render(element: unknown): Promise<string> {
  return visibleText(renderToString(<>{(await element) as React.ReactNode}</>));
}

/** Render a page in English and in Polish. */
async function both(page: () => unknown): Promise<{ en: string; pl: string }> {
  locale = 'en-US';
  const en = await render(page());
  locale = 'pl-PL';
  const pl = await render(page());
  return { en, pl };
}

describe('account shell — the shop language (issue #85)', () => {
  it('renders the sidebar in both languages', async () => {
    const { default: Layout } = await import('../../../app/(account)/layout');
    const { en, pl } = await both(() => Layout({ children: null }));
    // The links sit side by side with no text between them.
    expect(en).toContain('ProfileMy addressesChange passwordOrdersReturnsQuote requestsShopping lists');
    expect(en).toContain('OrganizationOrg addressesMembersRolesCarts to approve (1)');
    expect(en).not.toMatch(POLISH_DIACRITIC);
    expect(pl).toContain('ProfilMoje adresyZmień hasłoZamówieniaZwrotyZapytania ofertoweListy zakupów');
    expect(pl).toContain('OrganizacjaAdresy organizacjiCzłonkowieRoleKoszyki do akceptacji (1)');
    expect(en).toContain('Sign out');
    expect(pl).toContain('Wyloguj się');
  });

  it('renders the profile, with the role and the two-factor state as words', async () => {
    ownPermissions = [
      { code: 'carts.create', label: 'Create and edit carts', description: 'Add products to a cart.' },
      { code: 'carts.approve', label: "Approve and reject colleagues' carts", description: 'Answer carts sent for approval.' },
    ];
    const { default: Page } = await import('../../../app/(account)/account/page');
    const { en, pl } = await both(() => Page({ searchParams: Promise.resolve({}) }));
    expect(en).toContain('Your profile');
    expect(en).toContain('Role Administrator');
    expect(en).toContain('What your role allows');
    expect(en).toContain('Create and edit carts — Add products to a cart.');
    expect(en).toContain("Approve and reject colleagues' carts — Answer carts sent for approval.");
    expect(en).toContain('Two-step verification Disabled');
    expect(en).toContain('(verified)');
    expect(en).not.toMatch(POLISH_DIACRITIC);
    expect(pl).toContain('Twój profil');
    expect(pl).toContain('Rola Administrator');
    expect(pl).toContain('Na co pozwala Twoja rola');
    expect(pl).toContain('Weryfikacja dwuetapowa Wyłączone');
    expect(pl).toContain('(zweryfikowany)');
  });

  it('says so when the role allows none of the organization’s actions (FR-058)', async () => {
    ownPermissions = [];
    const { default: Page } = await import('../../../app/(account)/account/page');
    const { en, pl } = await both(() => Page({ searchParams: Promise.resolve({}) }));
    expect(en).toContain('Your role does not allow any of the actions an organization can grant.');
    expect(pl).toContain('Twoja rola nie pozwala na żadne z działań, które organizacja może przyznać.');
  });

  it('shows a personal Organization’s member no role and no list, and does not read it (owner ruling, PR #715)', async () => {
    ownPermissions = [{ code: 'carts.create', label: 'Create and edit carts', description: 'Add products to a cart.' }];
    ownRoleReads = 0;
    me.organization!.isPersonal = true;
    try {
      const { default: Page } = await import('../../../app/(account)/account/page');
      const { en, pl } = await both(() => Page({ searchParams: Promise.resolve({}) }));
      expect(en).toContain('Your profile');
      expect(en).not.toContain('Role Administrator');
      expect(en).not.toContain('What your role allows');
      expect(en).not.toContain('Create and edit carts');
      expect(pl).not.toContain('Na co pozwala Twoja rola');
      expect(ownRoleReads).toBe(0);
    } finally {
      me.organization!.isPersonal = false;
    }
  });

  it('renders the password page in both languages', async () => {
    const { default: Page } = await import('../../../app/(account)/account/password/page');
    const { en, pl } = await both(() => Page({ searchParams: Promise.resolve({ status: 'updated' }) }));
    expect(en).toContain('Your password has been updated.');
    expect(en).toContain('New password (at least 12 characters)');
    expect(en).toContain('Update password');
    expect(pl).toContain('Hasło zostało zmienione.');
    expect(pl).toContain('Nowe hasło (co najmniej 12 znaków)');
    expect(pl).toContain('Zmień hasło');
  });

  it('renders the ordering preferences in both languages', async () => {
    const { default: Page } = await import('../../../app/(account)/preferences/page');
    const { en, pl } = await both(() => Page({ searchParams: Promise.resolve({ saved: '1' }) }));
    expect(en).toContain('Default ordering preferences');
    expect(en).toContain('Preferences saved.');
    expect(en).toContain('Default payment method (use the organization default)');
    expect(en).not.toMatch(POLISH_DIACRITIC);
    expect(pl).toContain('Domyślne ustawienia zamówień');
    expect(pl).toContain('Ustawienia zostały zapisane.');
    expect(pl).toContain('Domyślna metoda płatności (ustawienie domyślne organizacji)');
  });

  it('renders the newsletter page in both languages', async () => {
    const { default: Page } = await import('../../../app/(account)/newsletter/page');
    const { en, pl } = await both(() => Page());
    expect(en).toContain('You are subscribed to our newsletter.');
    expect(en).toContain('Tags: B2B');
    expect(en).toContain('Unsubscribe');
    expect(pl).toContain('Subskrybujesz nasz newsletter.');
    expect(pl).toContain('Tagi: B2B');
    expect(pl).toContain('Wypisz się');
  });
});

describe('address books — the shop language (issue #85)', () => {
  it('renders my addresses, with the address type as a word', async () => {
    const { default: Page } = await import('../../../app/(account)/addresses/page');
    const { en, pl } = await both(() => Page({ searchParams: Promise.resolve({ status: 'default' }) }));
    expect(en).toContain('My addresses');
    expect(en).toContain('Default address updated.');
    expect(en).toContain('Type Recipient Address Default');
    expect(en).toContain('Billing Acme');
    expect(en).toContain('Organization addresses');
    expect(en).toContain('Make this the default address of its type');
    expect(en).not.toMatch(POLISH_DIACRITIC);
    expect(pl).toContain('Moje adresy');
    expect(pl).toContain('Zmieniono adres domyślny.');
    expect(pl).toContain('Rodzaj Odbiorca Adres Domyślny');
    expect(pl).toContain('Do faktury Acme');
    expect(pl).toContain('Do dostawy Acme');
    expect(pl).toContain('Telefon (opcjonalnie)');
  });

  it('renders the organization addresses in both languages', async () => {
    const { default: Page } = await import('../../../app/(account)/organization/addresses/page');
    const { en, pl } = await both(() => Page({ searchParams: Promise.resolve({ status: 'created' }) }));
    expect(en).toContain('Address added.');
    expect(en).toContain('Billing Acme');
    expect(en).toContain('Yes');
    expect(en).toContain('Add address');
    expect(pl).toContain('Adres został dodany.');
    expect(pl).toContain('Tak');
    expect(pl).toContain('Dodaj adres');
  });
});

describe('organization pages — the shop language (issue #85)', () => {
  it('renders the summary, with the statuses as words', async () => {
    const { default: Page } = await import('../../../app/(account)/organization/page');
    const { en, pl } = await both(() => Page());
    expect(en).toContain('Tax ID 1234567890');
    expect(en).toContain('Status Active');
    expect(en).toContain('VAT status VAT payer');
    expect(en).toContain('Registered address');
    expect(pl).toContain('NIP 1234567890');
    expect(pl).toContain('Status Aktywna');
    expect(pl).toContain('Status VAT Czynny podatnik VAT');
    expect(pl).toContain('Adres siedziby');
  });

  it('renders the members in both languages', async () => {
    const { default: Page } = await import('../../../app/(account)/organization/members/page');
    const { en, pl } = await both(() =>
      Page({ searchParams: Promise.resolve({ status: 'invited', email: 'ola@example.com' }) }),
    );
    expect(en).toContain('Invitation sent.');
    expect(en).toContain('Name Email Role Actions');
    expect(en).toContain('Pending invitations');
    expect(en).toContain('Send invitation');
    expect(en).not.toMatch(POLISH_DIACRITIC);
    expect(pl).toContain('Zaproszenie zostało wysłane.');
    expect(pl).toContain('Imię i nazwisko E-mail Rola Działania');
    expect(pl).toContain('Członek');
    expect(pl).toContain('Oczekujące zaproszenia');
    expect(pl).toContain('Wyślij zaproszenie');
  });

  it('renders the organization carts, with the statuses as words', async () => {
    const { default: Page } = await import('../../../app/(account)/organization/carts/page');
    const { en, pl } = await both(() => Page({ searchParams: Promise.resolve({}) }));
    expect(en).toContain('Every cart in the Acme organization');
    expect(en).toContain('Owner Status Approval Items Total Last activity Submitted Cart');
    expect(en).toContain('All carts');
    expect(en).toContain('Active Awaiting approval');
    expect(en).not.toMatch(POLISH_DIACRITIC);
    expect(pl).toContain('Wszystkie koszyki organizacji Acme');
    expect(pl).toContain('Aktywny Oczekuje na akceptację');
    expect(pl).toContain('Oczekujące na akceptację');
  });
});

describe('credit-limit widget — the shop language (issue #85)', () => {
  const limit = (reservations: number): CreditLimitView => ({
    organizationId: 'org-1',
    grantedAmount: 1000,
    availableAmount: 400,
    currency: 'EUR',
    grantedAt: '2026-01-01T00:00:00.000Z',
    activeReservationCount: reservations,
    activeReservations: Array.from({ length: reservations }, (_, i) => ({
      orderId: `order-${i}-0000`,
      amount: 600 / reservations,
      createdAt: '2026-10-01T00:00:00.000Z',
    })) as CreditLimitView['activeReservations'],
  });

  it('counts the reserving orders in English', () => {
    const one = visibleText(renderToString(<CreditLimitWidget limit={limit(1)} locale="en-US" />));
    expect(one).toContain('Credit limit');
    expect(one).toContain('€400.00 available of €1,000.00');
    expect(one).toContain('€600.00 reserved across 1 order');
    expect(one).not.toContain('order(s)');
    const three = visibleText(renderToString(<CreditLimitWidget limit={limit(3)} locale="en-US" showReservations />));
    expect(three).toContain('€600.00 reserved across 3 orders');
    expect(three).toContain('Order Reserved Since');
  });

  it('lists only the reservations the API returned, and counts the Organization’s (issue #748)', () => {
    const own: CreditLimitView = {
      ...limit(3),
      activeReservations: [
        { orderId: 'aaaaaaaa-0000-4000-8000-000000000001', amount: 200, createdAt: '2026-10-01T00:00:00.000Z' },
      ],
    };
    const text = visibleText(renderToString(<CreditLimitWidget limit={own} locale="en-US" showReservations />));
    expect(text).toContain('€600.00 reserved across 3 orders');
    expect(text).toContain('aaaaaaaa');
    expect(text).toContain('€200.00');
    expect(text).not.toContain('order-0');
    expect(text).not.toContain('order-1');
    expect(text).not.toContain('order-2');
  });

  it('counts the reserving orders in Polish, in its plural forms', () => {
    const one = visibleText(renderToString(<CreditLimitWidget limit={limit(1)} locale="pl-PL" />));
    expect(one).toContain('Limit kredytowy');
    expect(one).toMatch(/Dostępne 400,00\s€ z 1000,00\s€/);
    expect(one).toMatch(/W 1 zamówieniu zarezerwowano 600,00\s€/);
    const five = visibleText(renderToString(<CreditLimitWidget limit={limit(5)} locale="pl-PL" showReservations />));
    expect(five).toMatch(/W 5 zamówieniach zarezerwowano 600,00\s€/);
    expect(five).toContain('Zamówienie Zarezerwowano Od');
  });
});
