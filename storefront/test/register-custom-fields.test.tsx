import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputSurfaceField } from '@endora-commerce/contracts';
import type { RegisterFormState, RegisterLookupState } from '../lib/auth/register-form-state';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` FR-031 – FR-033, research
 * R-10) — the reference registration form renders the custom fields open on
 * `organization.register` generically: each value type with an accessible label
 * and a required marker, Organization fields in the company section and the
 * person's in the personal one. An unticked boolean is sent as `false`; a field
 * read that fails renders the plain form; a refused registration comes back as
 * state — every value but the password, both groups included, each refusal
 * beside its field — and nothing travels in a URL.
 */

const apiGet = vi.fn();
const registerOrganization = vi.fn();
const localeRedirect = vi.fn(async (_path: string): Promise<never> => {
  throw new Error('redirected');
});

vi.mock('../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/client')>('../lib/api/client');
  return { ...actual, apiGet: (...args: unknown[]) => apiGet(...args) };
});
vi.mock('../lib/api/auth', () => ({ registerOrganization: (...args: unknown[]) => registerOrganization(...args) }));
vi.mock('../lib/i18n/navigation', () => ({ localeRedirect: (path: string) => localeRedirect(path) }));
vi.mock('../lib/server-context', () => ({
  getServerContext: vi.fn(async () => ({
    locale: 'en-US',
    anonymousAccess: true,
    ctx: { salesChannelCode: 'trade', locale: 'en-US' },
    modules: { isPresent: () => true },
    urlState: { languages: [], aliases: [], current: 'en-US' },
  })),
}));
vi.mock('../components/Hook', () => ({ Hook: () => null }));
vi.mock('../lib/dictionary/pickers/CountryPicker', () => ({
  CountryPicker: (props: { id: string; name: string; value?: string }) => (
    <select id={props.id} name={props.name} value={props.value} onChange={() => undefined}>
      <option value={props.value}>{props.value}</option>
    </select>
  ),
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const { StorefrontApiError } = await import('../lib/api/client');
const { getRegistrationCustomFields, REGISTRATION_CUSTOM_FIELDS_TAG } = await import('../lib/api/custom-field-input');
const { default: RegisterPage } = await import('../app/(auth)/register/page');
const { registerFormAction } = await import('../app/(auth)/register/actions');
const { RegisterForm } = await import('../components/auth/RegisterForm');
const { INITIAL_REGISTER_FORM_STATE } = await import('../lib/auth/register-form-state');

const SURFACE_URL = '/api/v1/custom-fields/input-surfaces/organization.register';

function field(overrides: Partial<InputSurfaceField> & Pick<InputSurfaceField, 'key' | 'valueType' | 'label'>): InputSurfaceField {
  return { required: false, options: [], sortOrder: 0, ...overrides };
}

const ORGANIZATION_FIELDS: InputSurfaceField[] = [
  field({
    key: 'source',
    valueType: 'select',
    label: 'How did you hear about us?',
    required: true,
    options: [
      { value: 'trade_fair', label: 'Trade fair' },
      { value: 'web', label: 'Internet' },
    ],
  }),
  field({
    key: 'region',
    valueType: 'select',
    label: 'Region',
    options: ['north', 'south', 'east', 'west', 'centre'].map((value) => ({ value, label: `Region ${value}` })),
  }),
  field({ key: 'employees', valueType: 'number', label: 'Employees' }),
  field({ key: 'founded', valueType: 'date', label: 'Founded' }),
  field({ key: 'newsletter', valueType: 'boolean', label: 'Send me news' }),
];
const CUSTOMER_FIELDS: InputSurfaceField[] = [
  field({ key: 'phone', valueType: 'text', label: 'Phone', required: true }),
  field({
    key: 'interests',
    valueType: 'multiselect',
    label: 'Interests',
    options: [
      { value: 'tools', label: 'Tools' },
      { value: 'paint', label: 'Paint' },
      { value: 'wood', label: 'Wood' },
    ],
  }),
];
const FIELDS = { organization: ORGANIZATION_FIELDS, customer: CUSTOMER_FIELDS };

const VALUES = {
  organizationName: 'Typed Name',
  taxId: '5260250995',
  country: 'PL',
  street: 'Typed street 1',
  postalCode: '11-111',
  city: 'Typed city',
  firstName: 'Anna',
  lastName: 'Nowak',
  email: 'anna@example.test',
};

const PASSWORD = 'a-very-secret-password-175';

function surfaceAnswer(entities: Record<string, InputSurfaceField[]>) {
  return { data: { surface: 'organization.register', entities } };
}

function routeApiGet(answer: () => Promise<unknown>): void {
  apiGet.mockImplementation(async (path: string) => {
    if (path === SURFACE_URL) return await answer();
    if (path === '/api/v1/organizations/registration-options') {
      return { data: { registryLookup: { enabled: false, countries: [] } } };
    }
    throw new Error(`unexpected read: ${path}`);
  });
}

async function renderPage(): Promise<string> {
  const element = await RegisterPage({ searchParams: Promise.resolve({}) });
  return renderToString(element as ReactElement).replace(/<!-- -->/g, '');
}

const noop = async (s: RegisterFormState): Promise<RegisterFormState> => s;
const noLookup = async () => ({ lookup: null as unknown as RegisterLookupState, company: null });

function renderForm(state: RegisterFormState, fields = FIELDS): string {
  return renderToString(
    <RegisterForm locale="en-US" lookupEnabled={false} action={noop} lookupAction={noLookup} initialState={state} customFields={fields} />,
  ).replace(/<!-- -->/g, '');
}

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

function typedForm(extra: Array<[string, string]> = []): FormData {
  return form([
    ...Object.entries(VALUES),
    ['password', PASSWORD],
    ['acceptedTermsVersion', '2025-01'],
    ['intent', 'register'],
    ...extra,
  ]);
}

/** The opening tag of the element with `id`. */
function tagOf(html: string, id: string): string {
  return new RegExp(`<(?:input|select|textarea)[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? '';
}

/** The text of the `<label for=id>`. */
function labelOf(html: string, id: string): string {
  return new RegExp(`<label[^>]*for="${id}"[^>]*>(.*?)</label>`, 's').exec(html)?.[1] ?? '';
}

beforeEach(() => {
  apiGet.mockReset();
  registerOrganization.mockReset();
  localeRedirect.mockClear();
  routeApiGet(async () => surfaceAnswer(FIELDS));
});

describe('the open-field read (T069)', () => {
  it('reads the surface in the page language, cached for 300 s under the surface tag', async () => {
    expect(REGISTRATION_CUSTOM_FIELDS_TAG).toBe('custom-fields:input-surface:organization.register');
    expect(await getRegistrationCustomFields({ locale: 'pl-PL' })).toEqual(FIELDS);
    expect(apiGet).toHaveBeenCalledWith(SURFACE_URL, { locale: 'pl-PL' }, {
      revalidate: 300,
      tags: ['custom-fields:input-surface:organization.register'],
    });
  });

  it.each([
    ['a failed read', async () => Promise.reject(new Error('backend down'))],
    ['a 404 (custom_fields not composed)', async () => Promise.reject(new StorefrontApiError(404, 'NOT_FOUND', 'Not found'))],
    ['an answer of another shape', async () => ({ data: { fields: [] } })],
  ])('%s is no extra field', async (_name, answer) => {
    routeApiGet(answer);
    expect(await getRegistrationCustomFields()).toEqual({ organization: [], customer: [] });
  });

  it('an entity type with no open field is an empty list', async () => {
    routeApiGet(async () => surfaceAnswer({ customer: CUSTOMER_FIELDS }));
    expect(await getRegistrationCustomFields()).toEqual({ organization: [], customer: CUSTOMER_FIELDS });
  });
});

describe('the form renders the open fields (T070, FR-031)', () => {
  it('each value type, with an accessible label and a required marker, in its own section', async () => {
    const html = await renderPage();
    // Organization fields sit in the company section, the person's in the personal one.
    const ownerLegend = html.indexOf('Account owner');
    expect(ownerLegend).toBeGreaterThan(0);
    for (const key of ['source', 'region', 'employees', 'founded', 'newsletter']) {
      const at = html.indexOf(`name="cf.organization.${key}"`);
      expect(at, key).toBeGreaterThan(0);
      expect(at, key).toBeLessThan(ownerLegend);
    }
    for (const key of ['phone', 'interests']) {
      expect(html.indexOf(`name="cf.customer.${key}"`), key).toBeGreaterThan(ownerLegend);
    }

    // text — a labelled, required input.
    expect(labelOf(html, 'cf-customer-phone')).toContain('Phone');
    expect(labelOf(html, 'cf-customer-phone')).toContain('*');
    expect(tagOf(html, 'cf-customer-phone')).toMatch(/required/);
    expect(tagOf(html, 'cf-customer-phone')).toContain('type="text"');
    // number — a decimal keypad, not a spinner.
    expect(labelOf(html, 'cf-organization-employees')).toContain('Employees');
    expect(labelOf(html, 'cf-organization-employees')).not.toContain('*');
    expect(tagOf(html, 'cf-organization-employees')).toMatch(/inputMode="decimal"/i);
    expect(tagOf(html, 'cf-organization-employees')).not.toMatch(/required/);
    // date.
    expect(labelOf(html, 'cf-organization-founded')).toContain('Founded');
    expect(tagOf(html, 'cf-organization-founded')).toContain('type="date"');
    // boolean — a checkbox with a hidden `false` companion before it.
    expect(labelOf(html, 'cf-organization-newsletter')).toContain('Send me news');
    expect(tagOf(html, 'cf-organization-newsletter')).toContain('type="checkbox"');
    expect(html).toMatch(/<input type="hidden" name="cf\.organization\.newsletter" value="false"\/>/);
    // select with more than four options — a <select>.
    expect(labelOf(html, 'cf-organization-region')).toContain('Region');
    expect(html).toMatch(/<select[^>]*id="cf-organization-region"[^>]*name="cf\.organization\.region"/);
    // select with up to four options — a radio group named by its legend, required.
    const legendAt = html.lastIndexOf('<legend', html.indexOf('How did you hear about us?'));
    const radioGroup = /^<legend[^>]*>(.*?)<\/legend>(.*?)<\/fieldset>/s.exec(html.slice(legendAt));
    expect(radioGroup?.[1]).toContain('How did you hear about us?');
    expect(radioGroup?.[1]).toContain('*');
    const radio = tagOf(radioGroup?.[2] ?? '', 'cf-organization-source-trade_fair');
    for (const part of ['type="radio"', 'name="cf.organization.source"', 'value="trade_fair"', 'required']) {
      expect(radio).toContain(part);
    }
    expect(labelOf(html, 'cf-organization-source-trade_fair')).toContain('Trade fair');
    // multiselect — a checkbox group named by its legend.
    expect(html).toMatch(/<legend[^>]*>Interests<\/legend>/);
    expect(labelOf(html, 'cf-customer-interests-paint')).toContain('Paint');
    expect(tagOf(html, 'cf-customer-interests-paint')).toContain('name="cf.customer.interests"');
  });

  it('a failed field read renders the plain form (FR-033)', async () => {
    routeApiGet(async () => Promise.reject(new Error('backend down')));
    const html = await renderPage();
    expect(html).not.toContain('name="cf.');
    expect(html).toContain('Create account');
    expect(html).toContain('id="user-email"');
  });
});

describe('submitting (T071)', () => {
  it('sends both groups, an unticked boolean as false, empty fields not at all', async () => {
    registerOrganization.mockResolvedValue({});
    await expect(
      registerFormAction(
        INITIAL_REGISTER_FORM_STATE,
        typedForm([
          ['cf.organization.source', 'web'],
          ['cf.organization.employees', '12,5'],
          ['cf.organization.founded', ''],
          ['cf.organization.newsletter', 'false'],
          ['cf.customer.phone', '  +48 600 000 000 '],
          ['cf.customer.interests', 'tools'],
          ['cf.customer.interests', 'wood'],
        ]),
      ),
    ).rejects.toThrow('redirected');
    const payload = registerOrganization.mock.calls[0]?.[0] as {
      organization: { customFieldValues?: Record<string, unknown> };
      firstUser: { customFieldValues?: Record<string, unknown> };
    };
    expect(payload.organization.customFieldValues).toEqual({ source: 'web', employees: 12.5, newsletter: false });
    expect(payload.firstUser.customFieldValues).toEqual({ phone: '+48 600 000 000', interests: ['tools', 'wood'] });
  });

  it('a ticked boolean is true', async () => {
    registerOrganization.mockResolvedValue({});
    await expect(
      registerFormAction(
        INITIAL_REGISTER_FORM_STATE,
        typedForm([
          ['cf.organization.newsletter', 'false'],
          ['cf.organization.newsletter', 'true'],
        ]),
      ),
    ).rejects.toThrow('redirected');
    const payload = registerOrganization.mock.calls[0]?.[0] as { organization: { customFieldValues?: Record<string, unknown> } };
    expect(payload.organization.customFieldValues).toEqual({ newsletter: true });
  });

  it('without open fields the request is the one it always was', async () => {
    routeApiGet(async () => surfaceAnswer({}));
    registerOrganization.mockResolvedValue({});
    await expect(registerFormAction(INITIAL_REGISTER_FORM_STATE, typedForm())).rejects.toThrow('redirected');
    const payload = registerOrganization.mock.calls[0]?.[0] as { organization: object; firstUser: object };
    expect(payload.organization).not.toHaveProperty('customFieldValues');
    expect(payload.firstUser).not.toHaveProperty('customFieldValues');
  });

  it('a refusal returns every value but the password, both groups included, with each error beside its field and nothing in a URL (FR-032)', async () => {
    registerOrganization.mockRejectedValue(
      new StorefrontApiError(422, 'CUSTOM_FIELD_VALUE_INVALID', 'One or more custom fields are invalid.', 'req-1', [
        { field: 'organization.source', code: 'missing_required', message: 'This field is required.', path: 'organization.source', issue: 'x' },
        { field: 'firstUser.phone', code: 'out_of_range', message: 'This value is too long.', path: 'firstUser.phone', issue: 'x' },
        { field: 'firstUser', code: 'too_many_keys', message: 'Too many additional fields were sent at once.', path: 'firstUser', issue: 'x' },
      ]),
    );
    const state = await registerFormAction(
      INITIAL_REGISTER_FORM_STATE,
      typedForm([
        ['cf.organization.region', 'east'],
        ['cf.organization.employees', '40'],
        ['cf.organization.founded', '2001-05-04'],
        ['cf.organization.newsletter', 'false'],
        ['cf.organization.newsletter', 'true'],
        ['cf.customer.phone', '600 000 000'],
        ['cf.customer.interests', 'paint'],
      ]),
    );

    expect(localeRedirect).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).not.toContain(PASSWORD);
    expect(state.values).toEqual(VALUES);
    expect(state.customFields).toEqual({
      organization: { source: '', region: 'east', employees: '40', founded: '2001-05-04', newsletter: true },
      customer: { phone: '600 000 000', interests: ['paint'] },
    });
    expect(state.fieldErrors).toEqual({
      'organization.source': { code: 'missing_required', message: 'This field is required.' },
      'firstUser.phone': { code: 'out_of_range', message: 'This value is too long.' },
      firstUser: { code: 'too_many_keys', message: 'Too many additional fields were sent at once.' },
    });

    const html = renderForm(state);
    expect(html).not.toContain(PASSWORD);
    expect(html).not.toMatch(/action="[^"]*\?/);
    expect(tagOf(html, 'user-password')).not.toContain('value="');
    // The typed values, back in their fields.
    expect(tagOf(html, 'cf-organization-employees')).toContain('value="40"');
    expect(tagOf(html, 'cf-organization-founded')).toContain('value="2001-05-04"');
    expect(tagOf(html, 'cf-organization-newsletter')).toContain('checked');
    expect(html).toMatch(/<option value="east" selected="">/);
    expect(tagOf(html, 'cf-customer-phone')).toContain('value="600 000 000"');
    expect(tagOf(html, 'cf-customer-interests-paint')).toContain('checked');
    expect(tagOf(html, 'cf-customer-interests-tools')).not.toContain('checked');
    // Each refusal beside its field, in the page language, tied to it.
    const phone = tagOf(html, 'cf-customer-phone');
    expect(phone).toContain('aria-invalid="true"');
    expect(phone).toContain('aria-describedby="cf-customer-phone-error"');
    expect(html).toMatch(/<p id="cf-customer-phone-error"[^>]*>This value is too long\.<\/p>/);
    expect(html).toMatch(/<p id="cf-organization-source-error"[^>]*>This field is required\.<\/p>/);
    // A refusal of the whole group is said at the top of its section.
    expect(html).toContain('Too many additional fields were sent at once.');
    expect(html.indexOf('Too many additional fields were sent at once.')).toBeGreaterThan(html.indexOf('Account owner'));
  });

  it('a refusal for a field the form does not show is said at its section', () => {
    const html = renderForm({
      ...INITIAL_REGISTER_FORM_STATE,
      values: VALUES,
      error: { code: 'CUSTOM_FIELD_VALUE_INVALID', message: 'Some fields are missing or invalid. Correct them and try again.' },
      fieldErrors: { 'organization.retired': { code: 'not_open_for_input', message: 'This field cannot be filled in here.' } },
    });
    expect(html).toContain('This field cannot be filled in here.');
  });

  // `specs/conventions/module-i18n.md`, case 1 — the backend words a refusal in
  // the request's language; the storefront says the sentence it was given and
  // keeps no second catalogue of the value codes.
  it('says the backend\'s sentence for a refusal, whatever the code', () => {
    const html = renderForm({
      ...INITIAL_REGISTER_FORM_STATE,
      values: VALUES,
      error: { code: 'CUSTOM_FIELD_VALUE_INVALID', message: 'Niektóre pola są puste lub niepoprawne.' },
      fieldErrors: {
        'organization.source': { code: 'missing_required', message: 'To pole jest wymagane.' },
        'organization.region': { code: 'a_code_added_later', message: 'Nowy powód odmowy.' },
      },
    });
    expect(html).toMatch(/<p id="cf-organization-source-error"[^>]*>To pole jest wymagane\.<\/p>/);
    expect(html).toContain('Nowy powód odmowy.');
  });

  it('says a generic sentence for a refusal the backend did not word', () => {
    const html = renderForm({
      ...INITIAL_REGISTER_FORM_STATE,
      values: VALUES,
      error: { code: 'CUSTOM_FIELD_VALUE_INVALID', message: '' },
      fieldErrors: { 'organization.source': { code: 'missing_required', message: '' } },
    });
    expect(html).toMatch(/<p id="cf-organization-source-error"[^>]*>Check this field\.<\/p>/);
  });
});
