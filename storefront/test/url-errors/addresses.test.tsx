import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StorefrontApiError } from '../../lib/api/client';
import { visibleText } from '../account/i18n/text';
import { actionsOf, form, redirectOf } from './actions';

/**
 * Issue #745 — `/addresses` and `/organization/addresses` carried the API's
 * sentence in `?error=` and rendered it as given.
 *
 * `/addresses` carries a code now. `/organization/addresses` — whose create
 * refusals are mostly `VALIDATION_FAILED` with field-level detail — answers a
 * refused create as action state instead (`useActionState`, as the role form
 * does): the refusal's code and the names of the fields at fault, never the
 * API's sentence, and the form keeps what was typed. Its remove still
 * redirects, with a code.
 */

let locale = 'en-US';
let failure: Error | null = null;

const address = {
  id: 'a1',
  kind: 'delivery',
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
  CountryPicker: (props: Record<string, unknown>) => <select id={String(props.id)} name={String(props.name)} {...(props['aria-invalid'] ? { 'aria-invalid': true } : {})} />,
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      id: 'acc-1',
      organizationRole: { id: 'r1', kind: 'administrator', name: 'Administrator' },
      permissions: ['addresses.manage'],
    },
    organization: { id: 'org-1', name: 'Acme', isPersonal: false },
    impersonation: null,
  }),
}));
const refuse = async (): Promise<never> => {
  throw failure ?? new Error('fetch failed');
};
vi.mock('../../lib/api/customers', () => ({
  listMyAddresses: async () => ({ personal: [address], organization: [] }),
  createMyAddress: refuse,
  deleteMyAddress: refuse,
  setMyDefaultAddress: refuse,
}));
vi.mock('../../lib/api/organization', () => ({
  listAddresses: async () => [address],
  // A create succeeds unless a refusal is set, so the success path is reachable too.
  createAddress: async () => {
    if (failure) throw failure;
    return address;
  },
  deleteAddress: refuse,
}));

const { default: MyAddressesPage } = await import('../../app/(account)/addresses/page');
const { default: OrganizationAddressesPage } = await import('../../app/(account)/organization/addresses/page');
const { OrganizationAddressForm } = await import('../../components/account/OrganizationAddressForm');

async function mine(sp: Record<string, string> = {}): Promise<unknown> {
  return MyAddressesPage({ searchParams: Promise.resolve(sp) });
}
async function org(sp: Record<string, string> = {}): Promise<unknown> {
  return OrganizationAddressesPage({ searchParams: Promise.resolve(sp) });
}
async function text(tree: unknown): Promise<string> {
  return visibleText(renderToString(<>{(await tree) as React.ReactNode}</>));
}

const CREATE = {
  kind: 'delivery',
  recipientName: 'Acme',
  street: 'Main 1',
  city: 'Warsaw',
  postalCode: 'not-a-code',
  country: 'PL',
};

beforeEach(() => {
  locale = 'en-US';
  failure = null;
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

describe('each known code reads in English and Polish', () => {
  it.each([
    ['REMOVE_FAILED', 'Could not remove the address.', 'Nie udało się usunąć adresu.'],
    [
      'VALIDATION_FAILED',
      'Some of the address details are not valid. Check them and try again.',
      'Część danych adresu jest nieprawidłowa. Sprawdź je i spróbuj ponownie.',
    ],
    [
      'ORGANIZATION_PERMISSION_REQUIRED',
      'Your role does not allow this. Ask an administrator of your organization for this permission.',
      'Twoja rola na to nie pozwala. Poproś administratora swojej organizacji o to uprawnienie.',
    ],
  ])('%s', async (code, en, pl) => {
    expect(await text(mine({ error: code }))).toContain(en);
    expect(await text(org({ error: code }))).toContain(en);
    locale = 'pl-PL';
    expect(await text(mine({ error: code }))).toContain(pl);
  });
});

describe('/addresses — the actions redirect with a code, never a sentence', () => {
  it.each([
    ['createAction', 'SAVE_FAILED'],
    ['removeAction', 'REMOVE_FAILED'],
    ['setDefaultAction', 'DEFAULT_FAILED'],
  ])('%s carries %s for a refusal it cannot name', async (name, code) => {
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    const action = actionsOf(await mine()).get(name)!;
    expect(await redirectOf(() => action(form({ ...CREATE, addressId: 'a1' }) as never))).toBe(`/addresses?error=${code}`);
  });

  it('a validation refusal carries VALIDATION_FAILED', async () => {
    failure = new StorefrontApiError(400, 'VALIDATION_FAILED', 'Request failed validation.', undefined, [
      { path: 'postalCode', issue: 'Invalid string' },
    ]);
    const action = actionsOf(await mine()).get('createAction')!;
    expect(await redirectOf(() => action(form(CREATE) as never))).toBe('/addresses?error=VALIDATION_FAILED');
  });
});

describe('/organization/addresses — a refused create answers as action state', () => {
  async function create(): Promise<unknown> {
    const action = actionsOf(await org()).get('createAddressAction');
    if (!action) throw new Error('the page hands no createAddressAction');
    return (action as (state: unknown, data: FormData) => Promise<unknown>)({ error: null, fields: [] }, form(CREATE));
  }

  it('names the code and the fields at fault, never the API’s sentence', async () => {
    failure = new StorefrontApiError(400, 'VALIDATION_FAILED', 'body/postalCode must match pattern', undefined, [
      { path: 'postalCode', issue: 'must match pattern "^[0-9-]+$"' },
      { path: 'country', issue: 'Invalid enum value' },
      { path: 'body.__proto__', issue: 'x' },
    ]);
    const state = await create();
    expect(state).toEqual({ error: 'VALIDATION_FAILED', fields: ['postalCode', 'country'] });
    expect(JSON.stringify(state)).not.toContain('must match');
  });

  it('carries SAVE_FAILED for a refusal it cannot name, and no fields', async () => {
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    expect(await create()).toEqual({ error: 'SAVE_FAILED', fields: [] });
  });

  it('a successful create redirects with ?status=created', async () => {
    expect(await redirectOf(() => create())).toBe('/organization/addresses?status=created');
  });

  it('remove redirects with a code', async () => {
    failure = new StorefrontApiError(404, 'NOT_FOUND', 'Address not found.');
    const action = actionsOf(await org()).get('removeAddressAction')!;
    expect(await redirectOf(() => action(form({ id: 'a1' }) as never))).toBe('/organization/addresses?error=NOT_FOUND');
  });
});

describe('the organization address form words the state in the page’s language', () => {
  const noop = async (): Promise<never> => {
    throw new Error('not submitted');
  };

  function render(state: { error: string | null; fields: string[] }): string {
    return renderToString(
      <OrganizationAddressForm action={noop as never} locale={locale} initialState={state as never} />,
    );
  }

  it('marks each field at fault and says why, in English and Polish', () => {
    const state = { error: 'VALIDATION_FAILED', fields: ['postalCode'] };
    const en = render(state);
    expect(visibleText(en)).toContain('Some of the address details are not valid. Check them and try again.');
    expect(en).toMatch(/id="addr-postal"[^>]*aria-invalid="true"/);
    expect(en).toMatch(/aria-describedby="addr-postal-error"/);
    expect(visibleText(en)).toContain('Check this field.');
    expect(en).not.toMatch(/id="addr-city"[^>]*aria-invalid/);
    locale = 'pl-PL';
    const pl = visibleText(render(state));
    expect(pl).toContain('Część danych adresu jest nieprawidłowa. Sprawdź je i spróbuj ponownie.');
    expect(pl).toContain('Sprawdź to pole.');
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
