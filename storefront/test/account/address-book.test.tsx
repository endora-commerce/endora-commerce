import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { MeResult } from '../../lib/api/account';
import type { AddressPayload, AddressSummary } from '../../lib/api/organization';
import type { CartSummary } from '../../lib/api/cart';
import { StorefrontApiError } from '../../lib/api/client';
import { visibleText } from './i18n/text';

/**
 * `specs/173-b2c-address-book-merge/` release 1 — one address book for every
 * customer, the Organization's.
 *
 *  - **T-S1** a B2C customer's `/addresses` ("My addresses" / "Moje adresy")
 *    shows one list, read from the Organization API, with no
 *    "Organization addresses" section; add, remove and make-default all go to
 *    the Organization API (FR-001, FR-002).
 *  - **T-S2** a company member is offered one address entry, the company's, and
 *    `/addresses` sends them there (FR-004, OD-11); an org-less customer has no
 *    address page.
 *  - **T-S3** the round trip, against one shared fake of
 *    `/organizations/mine/addresses`: an address added on `/addresses` is
 *    offered at checkout, and one typed at checkout is listed on `/addresses`
 *    (FR-002, FR-003, SC-001). In English and in Polish.
 */

type Kind = 'personal' | 'company' | 'none';
let kind: Kind = 'personal';
let locale = 'en-US';

function me(): MeResult {
  return {
    customerAccount: {
      id: 'acc-1',
      organizationId: 'org-1',
      email: 'anna@example.com',
      firstName: 'Anna',
      lastName: 'Nowak',
      organizationRole: { id: '00000000-0000-4000-8000-0000000000a1', kind: 'administrator', name: 'Administrator' },
      permissions: ['carts.create', 'carts.approve', 'carts.order_without_approval', 'addresses.manage'],
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      twoFactorEnabled: false,
    },
    organization:
      kind === 'none'
        ? null
        : {
            id: 'org-1',
            name: kind === 'personal' ? 'Anna Nowak' : 'Acme',
            taxId: kind === 'personal' ? '79963f233e3843bd84e144a8fcdd37f8' : '1234567890',
            status: 'active',
            vatStatus: 'vat_payer',
            isPersonal: kind === 'personal',
            registeredAddress: { street: 'Main 1', city: 'Gdańsk', postalCode: '80-001', country: 'PL' },
          },
    impersonation: null,
  };
}

/** The one shared fake of `/api/v1/organizations/mine/addresses`. */
let book: AddressSummary[] = [];
const calls: Array<[string, ...unknown[]]> = [];
let refuseNext: StorefrontApiError | null = null;
let nextId = 1;

function store(payload: AddressPayload): AddressSummary {
  const created: AddressSummary = {
    id: `addr-${nextId++}`,
    organizationId: 'org-1',
    kind: payload.kind,
    recipientName: payload.recipientName,
    street: payload.street,
    city: payload.city,
    postalCode: payload.postalCode,
    country: payload.country,
    phone: payload.phone ?? null,
    isDefault: false,
  };
  if (payload.isDefault) setDefault(created);
  book.push(created);
  return created;
}

function setDefault(address: AddressSummary): void {
  for (const other of book) if (other.kind === address.kind) other.isDefault = false;
  address.isDefault = true;
}

vi.mock('../../lib/api/organization', () => ({
  listAddresses: async (_session: string) => {
    calls.push(['listAddresses']);
    return book.map((a) => ({ ...a }));
  },
  createAddress: async (_session: string, payload: AddressPayload) => {
    calls.push(['createAddress', payload]);
    if (refuseNext) {
      const error = refuseNext;
      refuseNext = null;
      throw error;
    }
    return store(payload);
  },
  updateAddress: async (_session: string, id: string, patch: Partial<AddressPayload>) => {
    calls.push(['updateAddress', id, patch]);
    if (refuseNext) {
      const error = refuseNext;
      refuseNext = null;
      throw error;
    }
    const found = book.find((a) => a.id === id);
    if (!found) throw new StorefrontApiError(404, 'NOT_FOUND', 'Address not found.');
    if (patch.isDefault) setDefault(found);
    return { ...found };
  },
  deleteAddress: async (_session: string, id: string) => {
    calls.push(['deleteAddress', id]);
    if (refuseNext) {
      const error = refuseNext;
      refuseNext = null;
      throw error;
    }
    book = book.filter((a) => a.id !== id);
  },
  getMyRole: async () => ({
    role: { id: '00000000-0000-4000-8000-0000000000a1', kind: 'administrator', name: 'Administrator' },
    permissions: [],
  }),
}));
vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
  getAnonCartCookie: async () => undefined,
  setAnonCartCookie: async () => undefined,
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
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/dictionary/pickers/CountryPicker', () => ({ CountryPicker: () => null }));
vi.mock('../../lib/api/account', () => ({ getMe: async () => me() }));
vi.mock('../../lib/api/auth', () => ({ logoutCustomer: async () => undefined }));
// The retired personal-book client must not be what any address page reads.
vi.mock('../../lib/api/customers', () => ({}));

// Checkout's own reads, as `test/checkout/checkout-page-locale.test.tsx` stubs them.
const LINE: CartSummary['items'][number] = {
  id: 'l1',
  productId: 'p1',
  variantId: null,
  quantity: 1,
  unitPrice: { amount: 10, currency: 'PLN' },
  productName: 'Bolt',
};
const cart: CartSummary = {
  id: 'c1',
  customerAccountId: 'acc-1',
  organizationId: 'org-1',
  anonymousCartToken: null,
  items: [LINE],
  itemCount: 1,
  subtotal: { amount: 10, currency: 'PLN' },
  discount: null,
  grandTotal: { amount: 10, currency: 'PLN' },
} as CartSummary;
vi.mock('../../lib/api/cart', () => ({
  CART_UNAVAILABLE: 'cart-unavailable',
  getCart: async () => ({ cart }),
  applyCartCoupon: async () => ({}),
  clearCartCoupon: async () => undefined,
  listOrganizationCarts: async () => ({ data: [], meta: { page: 1, pageSize: 20, totalCount: 0 } }),
}));
vi.mock('../../lib/api/methods', () => ({
  listDeliveryMethods: async () => [],
  listPaymentMethods: async () => [],
}));
vi.mock('../../lib/api/dictionary', () => ({ listCountries: async () => [] }));
const placed: unknown[] = [];
vi.mock('../../lib/api/orders', () => ({
  placeOrder: async (_session: string, payload: unknown) => {
    placed.push(payload);
    return { id: 'order-1', nextAction: null };
  },
  previewOrderTotal: async () => null,
}));
vi.mock('../../lib/api/credit-limit', () => ({ getMyCreditLimit: async () => null }));
vi.mock('../../lib/api/quick-order', () => ({ getResolvedQuickOrderDefaults: async () => null }));
vi.mock('../../components/CreditLimitWidget', () => ({ CreditLimitWidget: () => null }));

const { default: MyAddressesPage } = await import('../../app/(account)/addresses/page');
const { default: OrganizationAddressesPage } = await import('../../app/(account)/organization/addresses/page');
const { default: AccountLayout } = await import('../../app/(account)/layout');
const { default: CheckoutPage } = await import('../../app/(commerce)/checkout/page');
const { CheckoutForm } = await import('../../components/checkout/CheckoutForm');
const actions = await import('../../lib/actions/addresses');
const { IDLE_ADDRESS_FORM } = await import('../../lib/account/address-errors');

async function render(element: unknown): Promise<string> {
  return renderToString(<>{(await element) as ReactNode}</>).replaceAll('<!-- -->', '');
}

async function outcome(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as Error).message;
  }
  return 'resolved';
}

const myAddresses = (params: Record<string, string> = {}) => MyAddressesPage({ searchParams: Promise.resolve(params) });
const orgAddresses = (params: Record<string, string> = {}) =>
  OrganizationAddressesPage({ searchParams: Promise.resolve(params) });

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const TYPED = {
  kind: 'delivery',
  recipientName: 'Anna Nowak',
  street: 'ul. Długa 5',
  city: 'Gdańsk',
  postalCode: '80-001',
  country: 'pl',
  phone: '',
} as const;

const LOCALES = [
  {
    code: 'en-US',
    heading: 'My addresses',
    orgEntry: 'Organization addresses',
    ownEntry: 'My addresses',
    makeDefault: 'Make default',
    remove: 'Remove',
    add: 'Add address',
  },
  {
    code: 'pl-PL',
    heading: 'Moje adresy',
    orgEntry: 'Adresy organizacji',
    ownEntry: 'Moje adresy',
    makeDefault: 'Ustaw jako domyślny',
    remove: 'Usuń',
    add: 'Dodaj adres',
  },
] as const;

beforeEach(() => {
  kind = 'personal';
  locale = 'en-US';
  book = [];
  calls.length = 0;
  placed.length = 0;
  refuseNext = null;
  nextId = 1;
});

describe.each(LOCALES)('T-S1 — a B2C customer has one address book ($code)', (l) => {
  beforeEach(() => {
    locale = l.code;
    store({ ...TYPED, country: 'PL', street: 'ul. Krótka 2', isDefault: true });
    store({ ...TYPED, country: 'PL', kind: 'billing' });
  });

  it('shows one list, read from the Organization API, with no Organization section', async () => {
    const html = await render(myAddresses());
    const text = visibleText(html);
    expect(html).toContain(`<h2>${l.heading}</h2>`);
    expect(text).toContain('ul. Krótka 2');
    expect(text).toContain('ul. Długa 5');
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(text).not.toContain(LOCALES[0].orgEntry);
    expect(text).not.toContain(LOCALES[1].orgEntry);
    expect(calls.filter(([name]) => name === 'listAddresses')).toHaveLength(1);
    // The default reads as the default; the other offers to become it, and both can go.
    expect(text).toContain(l.makeDefault);
    expect(text).toContain(l.remove);
    expect(text).toContain(l.add);
  });

  it('renders Make default and Remove as design-system buttons, Remove marked apart (issue #663)', async () => {
    const html = await render(myAddresses());
    const table = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    const buttons = table.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? [];
    // One "Make default" (the other address is the default) and two "Remove".
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(button).toMatch(/class="btn btn--outline btn--sm min-h-11\b/);
    const destructive = buttons.filter((b) => b.includes('text-bad')).map((b) => b.replace(/<[^>]+>/g, ''));
    expect(destructive).toEqual([l.remove, l.remove]);
  });

  it('adds an address through the Organization API', async () => {
    const result = await outcome(
      actions.createAddressAction(IDLE_ADDRESS_FORM, form({ ...TYPED, returnTo: '/addresses', isDefault: 'true' })),
    );
    expect(result).toBe('redirect /addresses?status=created');
    expect(calls.find(([name]) => name === 'createAddress')?.[1]).toEqual({
      kind: 'delivery',
      recipientName: 'Anna Nowak',
      street: 'ul. Długa 5',
      city: 'Gdańsk',
      postalCode: '80-001',
      country: 'PL',
      isDefault: true,
    });
  });

  it('makes an address the default through the Organization API', async () => {
    const billing = book.find((a) => a.kind === 'billing')!;
    const result = await outcome(actions.setDefaultAddressAction(form({ id: billing.id, returnTo: '/addresses' })));
    expect(result).toBe('redirect /addresses?status=default');
    expect(calls).toContainEqual(['updateAddress', billing.id, { isDefault: true }]);
  });

  it('removes an address through the Organization API', async () => {
    const id = book[0]!.id;
    const result = await outcome(actions.removeAddressAction(form({ id, returnTo: '/addresses' })));
    expect(result).toBe('redirect /addresses?status=removed');
    expect(calls).toContainEqual(['deleteAddress', id]);
    expect(book.map((a) => a.id)).not.toContain(id);
  });

  it('a refused remove or make-default comes back as a code, never a sentence', async () => {
    refuseNext = new StorefrontApiError(404, 'NOT_FOUND', 'Address 123 of Anna Nowak not found.');
    expect(await outcome(actions.removeAddressAction(form({ id: 'x', returnTo: '/addresses' })))).toBe(
      'redirect /addresses?error=NOT_FOUND',
    );
    refuseNext = new Error('socket hang up') as StorefrontApiError;
    expect(await outcome(actions.setDefaultAddressAction(form({ id: 'x', returnTo: '/addresses' })))).toBe(
      'redirect /addresses?error=DEFAULT_FAILED',
    );
  });

  it('lands on a page it knows whatever the form claims', async () => {
    const id = book[0]!.id;
    expect(await outcome(actions.removeAddressAction(form({ id, returnTo: 'https://evil.example/' })))).toBe(
      'redirect /addresses?status=removed',
    );
  });

  it('/organization/addresses sends the B2C customer to /addresses (issue #757)', async () => {
    expect(await outcome(orgAddresses())).toBe('redirect /addresses');
  });

  it('the account navigation offers one address entry, "My addresses"', async () => {
    const html = await render(AccountLayout({ children: null }));
    expect(html).toContain('href="/addresses"');
    expect(html).not.toContain('href="/organization/addresses"');
    expect(visibleText(html).split(l.ownEntry)).toHaveLength(2);
  });
});

describe.each(LOCALES)('T-S2 — a company member has one address entry ($code)', (l) => {
  beforeEach(() => {
    locale = l.code;
    kind = 'company';
  });

  it('the navigation offers only the Organization addresses', async () => {
    const html = await render(AccountLayout({ children: null }));
    expect(html).toContain('href="/organization/addresses"');
    expect(html).not.toContain('href="/addresses"');
    const text = visibleText(html);
    expect(text).toContain(l.orgEntry);
    expect(text).not.toContain(l.ownEntry);
  });

  it('/addresses redirects to /organization/addresses', async () => {
    expect(await outcome(myAddresses())).toBe('redirect /organization/addresses');
  });

  it('/organization/addresses renders the same book, under its own heading', async () => {
    store({ ...TYPED, country: 'PL', recipientName: 'Acme Warehouse' });
    const html = await render(orgAddresses());
    expect(visibleText(html)).toContain('Acme Warehouse');
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(visibleText(html)).toContain(l.add);
  });

  it('an org-less customer has no address page and no address entry', async () => {
    kind = 'none';
    expect(await outcome(myAddresses())).toBe('redirect /account');
    const html = await render(AccountLayout({ children: null }));
    expect(html).not.toContain('href="/addresses"');
    expect(html).not.toContain('href="/organization/addresses"');
  });
});

/** The checkout form's action, found in the element tree the page returns. */
function checkoutAction(tree: unknown): (data: FormData) => Promise<void> {
  const stack: unknown[] = [tree];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    if (!isValidElement(node)) continue;
    const element = node as ReactElement<{ action?: unknown; children?: unknown }>;
    if (element.type === CheckoutForm && typeof element.props.action === 'function') {
      return element.props.action as (data: FormData) => Promise<void>;
    }
    stack.push(element.props.children);
  }
  throw new Error('the checkout page renders no CheckoutForm');
}

describe.each(LOCALES)('T-S3 — /addresses and checkout read and write one book ($code)', (l) => {
  beforeEach(() => {
    locale = l.code;
  });

  it('an address added on /addresses is offered at checkout', async () => {
    await outcome(
      actions.createAddressAction(
        IDLE_ADDRESS_FORM,
        form({ ...TYPED, recipientName: 'Anna Home', street: 'ul. Domowa 1', returnTo: '/addresses' }),
      ),
    );
    const checkout = await render(CheckoutPage({ searchParams: Promise.resolve({}) }));
    expect(checkout).toContain('Anna Home — ul. Domowa 1, 80-001 Gdańsk, PL');
  });

  it('an address typed at checkout is listed on /addresses', async () => {
    const tree = await CheckoutPage({ searchParams: Promise.resolve({}) });
    const submit = checkoutAction(tree);
    const result = await outcome(
      submit(
        form({
          delivery_recipientName: 'Anna Office',
          delivery_street: 'ul. Biurowa 9',
          delivery_city: 'Sopot',
          delivery_postalCode: '81-001',
          delivery_country: 'PL',
          billingSameAsShipping: 'on',
          deliveryMethodId: 'dm-1',
          paymentMethodId: 'pm-1',
        }),
      ),
    );
    expect(result).toBe('redirect /checkout/success?id=order-1');
    expect(placed).toHaveLength(1);

    const html = await render(myAddresses());
    expect(visibleText(html)).toContain('ul. Biurowa 9');
    expect(html).toContain(`<h2>${l.heading}</h2>`);
  });
});
