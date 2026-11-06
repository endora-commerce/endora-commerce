import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StorefrontApiError } from '../../lib/api/client';
import { visibleText } from '../account/i18n/text';

/**
 * Issue #745 — `/addresses` and `/organization/addresses` carried the API's
 * sentence in `?error=` and rendered it as given.
 *
 * Since `specs/173-b2c-address-book-merge/` both pages are the one address book
 * (`components/account/AddressBook.tsx`), and its actions are one
 * implementation (`lib/actions/addresses.ts`). *Remove* and *Make default*
 * redirect with a code; a refused *add* answers as action state — the refusal's
 * code and the fields at fault with why (#792), never the API's sentence — and
 * the form (`components/account/AddressForm.tsx`) keeps what was typed.
 *
 * The two guarantees of #745 hold on both pages: a crafted `?error=` never
 * reaches the screen, and every code the book knows reads in English and
 * Polish.
 */

let locale = 'en-US';
let failure: Error | null = null;
/** A B2C customer reads `/addresses`; a company member `/organization/addresses`. */
let personal = true;

const address = {
  id: 'a1',
  organizationId: 'org-1',
  kind: 'delivery' as const,
  recipientName: 'Acme',
  street: 'Main 1',
  city: 'Warsaw',
  postalCode: '00-001',
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
vi.mock('../../lib/dictionary/pickers/CountryPicker', () => ({
  CountryPicker: (props: Record<string, unknown>) => (
    <select
      id={String(props.id)}
      name={String(props.name)}
      {...(props['aria-invalid'] ? { 'aria-invalid': true } : {})}
    />
  ),
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      id: 'acc-1',
      organizationRole: { id: 'r1', kind: 'administrator', name: 'Administrator' },
      permissions: ['addresses.manage'],
    },
    organization: { id: 'org-1', name: 'Acme', isPersonal: personal },
    impersonation: null,
  }),
}));
const refuse = async (): Promise<never> => {
  throw failure ?? new Error('fetch failed');
};
vi.mock('../../lib/api/organization', () => ({
  listAddresses: async () => [address, { ...address, id: 'a2', isDefault: false }],
  // A create succeeds unless a refusal is set, so the success path is reachable too.
  createAddress: async () => {
    if (failure) throw failure;
    return address;
  },
  updateAddress: refuse,
  deleteAddress: refuse,
}));

const { default: MyAddressesPage } = await import('../../app/(account)/addresses/page');
const { default: OrganizationAddressesPage } = await import('../../app/(account)/organization/addresses/page');
const { AddressForm } = await import('../../components/account/AddressForm');
const { createAddressAction, removeAddressAction, setDefaultAddressAction } = await import(
  '../../lib/actions/addresses'
);

async function mine(sp: Record<string, string> = {}): Promise<unknown> {
  personal = true;
  return MyAddressesPage({ searchParams: Promise.resolve(sp) });
}
async function org(sp: Record<string, string> = {}): Promise<unknown> {
  personal = false;
  return OrganizationAddressesPage({ searchParams: Promise.resolve(sp) });
}
async function text(tree: unknown): Promise<string> {
  return visibleText(renderToString(<>{(await tree) as React.ReactNode}</>));
}

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const message = (err as Error).message;
    if (message.startsWith('redirect ')) return message.slice('redirect '.length);
    throw err;
  }
  throw new Error('the action did not redirect');
}

const CREATE = {
  kind: 'delivery',
  recipientName: 'Acme',
  street: 'Main 1',
  city: 'Warsaw',
  postalCode: '00-001',
  country: 'PL',
};

beforeEach(() => {
  locale = 'en-US';
  failure = null;
  personal = true;
});

describe('a crafted ?error= never reaches either address page', () => {
  it.each(['Adres zablokowany — zadzwoń 555 000 111', 'SOMETHING_ELSE', 'constructor'])('%s', async (crafted) => {
    for (const page of [mine, org]) {
      const out = await text(page({ error: crafted }));
      expect(out).not.toContain(crafted);
      expect(out).toContain('Something went wrong with your addresses. Please try again.');
    }
  });
});

describe('each known code reads in English and Polish, on both pages', () => {
  it.each([
    ['REMOVE_FAILED', 'Could not remove the address.', 'Nie udało się usunąć adresu.'],
    ['DEFAULT_FAILED', 'Could not set the default address.', 'Nie udało się ustawić adresu domyślnego.'],
    ['SAVE_FAILED', 'Could not save the address.', 'Nie udało się zapisać adresu.'],
    [
      'VALIDATION_FAILED',
      'Some fields need your attention. Check the messages below each one.',
      'Niektóre pola wymagają poprawy. Sprawdź komunikaty pod nimi.',
    ],
    [
      'NOT_FOUND',
      'That address no longer exists. The list below is up to date.',
      'Ten adres już nie istnieje. Lista poniżej jest aktualna.',
    ],
    [
      'ORGANIZATION_PERMISSION_REQUIRED',
      'Your role does not allow this. Ask an administrator of your organization for this permission.',
      'Twoja rola na to nie pozwala. Poproś administratora swojej organizacji o to uprawnienie.',
    ],
    [
      'FAILED',
      'Something went wrong with your addresses. Please try again.',
      'Coś poszło nie tak z adresami. Spróbuj ponownie.',
    ],
  ])('%s', async (code, en, pl) => {
    expect(await text(mine({ error: code }))).toContain(en);
    expect(await text(org({ error: code }))).toContain(en);
    locale = 'pl-PL';
    expect(await text(mine({ error: code }))).toContain(pl);
    expect(await text(org({ error: code }))).toContain(pl);
  });
});

describe('remove and make-default redirect with a code, never a sentence', () => {
  it.each([
    ['removeAddressAction', removeAddressAction, 'REMOVE_FAILED'],
    ['setDefaultAddressAction', setDefaultAddressAction, 'DEFAULT_FAILED'],
  ] as const)('%s carries its fallback code for a refusal it cannot name', async (_name, action, code) => {
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    for (const page of ['/addresses', '/organization/addresses'] as const) {
      expect(await redirectOf(() => action(form({ id: 'a1', returnTo: page })))).toBe(`${page}?error=${code}`);
    }
  });

  it('a refusal it can name carries its own code', async () => {
    failure = new StorefrontApiError(404, 'NOT_FOUND', 'Address a1 of Anna Nowak not found.');
    expect(await redirectOf(() => removeAddressAction(form({ id: 'a1', returnTo: '/organization/addresses' })))).toBe(
      '/organization/addresses?error=NOT_FOUND',
    );
  });
});

describe('a refused create answers as action state', () => {
  const create = (values: Record<string, string> = {}) =>
    createAddressAction({ error: null, fields: [] }, form({ ...CREATE, returnTo: '/organization/addresses', ...values }));

  it('names the code and the fields at fault, never the API’s sentence', async () => {
    failure = new StorefrontApiError(400, 'VALIDATION_FAILED', 'body/postalCode must match pattern', undefined, [
      { path: 'postalCode', issue: 'must match pattern "^[0-9-]+$"' },
      { path: 'country', issue: 'Invalid enum value' },
      { path: 'body.__proto__', issue: 'x' },
    ]);
    const state = await create();
    expect(state).toEqual({
      error: 'VALIDATION_FAILED',
      fields: [
        { field: 'postalCode', issue: 'invalid' },
        { field: 'country', issue: 'invalid' },
      ],
    });
    expect(JSON.stringify(state)).not.toContain('must match');
  });

  it('carries SAVE_FAILED for a refusal it cannot name, and no fields', async () => {
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    expect(await create()).toEqual({ error: 'SAVE_FAILED', fields: [] });
  });

  it('a successful create redirects with ?status=created to the page it came from', async () => {
    expect(await redirectOf(() => create())).toBe('/organization/addresses?status=created');
    expect(await redirectOf(() => create({ returnTo: '/addresses' }))).toBe('/addresses?status=created');
  });
});

describe('the address form words the state in the page’s language', () => {
  const noop = async (): Promise<never> => {
    throw new Error('not submitted');
  };

  function render(state: { error: string | null; fields: Array<{ field: string; issue: string }> }): string {
    return renderToString(
      <AddressForm action={noop as never} locale={locale} returnTo="/addresses" initialState={state as never} />,
    );
  }

  it('marks each field at fault and says why, in English and Polish', () => {
    const state = { error: 'VALIDATION_FAILED', fields: [{ field: 'postalCode', issue: 'required' }] };
    const en = render(state);
    expect(visibleText(en)).toContain('Some fields need your attention. Check the messages below each one.');
    expect(en).toMatch(/id="addr-postal"[^>]*aria-invalid="true"/);
    expect(en).toMatch(/aria-describedby="addr-postal-error"/);
    expect(visibleText(en)).toContain('Enter the postal code.');
    expect(en).not.toMatch(/id="addr-city"[^>]*aria-invalid/);
    locale = 'pl-PL';
    const pl = visibleText(render(state));
    expect(pl).toContain('Niektóre pola wymagają poprawy. Sprawdź komunikaty pod nimi.');
    expect(pl).toContain('Wpisz kod pocztowy.');
  });

  it('mounts the announcement region empty before any refusal', () => {
    const idle = render({ error: null, fields: [] });
    expect(idle).toMatch(/<div id="address-form-error"[^>]*role="alert"[^>]*><\/div>/);
    expect(idle).not.toContain('aria-invalid');
  });

  it('reads a code it does not know as the generic failure', () => {
    expect(visibleText(render({ error: 'Pay to IBAN PL00', fields: [] }))).toContain(
      'Something went wrong with your addresses. Please try again.',
    );
  });
});
