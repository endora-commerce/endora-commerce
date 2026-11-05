import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterFormState, RegisterLookupState } from '../../lib/auth/register-form-state';

/**
 * Feature 173 (T033, T043, T047; FR-012 – FR-017) — the registration page with
 * the company registry lookup, rendered on the server as a buyer without
 * JavaScript receives it.
 */

const options = { enabled: true, countries: ['PL', 'DE'] };

vi.mock('../../lib/server-context', () => ({
  getServerContext: vi.fn(async () => ({
    locale: 'en-US',
    anonymousAccess: true,
    ctx: { salesChannelCode: 'trade', locale: 'en-US' },
    modules: { isPresent: () => true },
    urlState: { languages: [], aliases: [], current: 'en-US' },
  })),
}));
vi.mock('../../components/Hook', () => ({ Hook: () => null }));
vi.mock('../../lib/dictionary/pickers/CountryPicker', () => ({
  CountryPicker: (props: { id: string; name: string; value?: string }) => (
    <select id={props.id} name={props.name} value={props.value} onChange={() => undefined}>
      <option value={props.value}>{props.value}</option>
    </select>
  ),
}));
vi.mock('../../lib/api/registry-lookup', () => ({
  REGISTRATION_OPTIONS_TAG: 'organizations:registration-options',
  getRegistrationOptions: vi.fn(async () => options),
  lookupCompany: vi.fn(),
}));
vi.mock('../../lib/api/auth', () => ({ registerOrganization: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const { default: RegisterPage } = await import('../../app/(auth)/register/page');
const { RegisterForm } = await import('../../components/auth/RegisterForm');

async function renderPage(searchParams: Record<string, string> = {}): Promise<string> {
  const element = await RegisterPage({ searchParams: Promise.resolve(searchParams) });
  return renderToString(element as ReactElement).replace(/<!-- -->/g, '');
}

const noop = async (s: RegisterFormState): Promise<RegisterFormState> => s;
const noLookup = async () => ({ lookup: null as unknown as RegisterLookupState, company: null });

function renderForm(state: RegisterFormState, lookupEnabled = true): string {
  return renderToString(
    <RegisterForm locale="en-US" lookupEnabled={lookupEnabled} action={noop} lookupAction={noLookup} initialState={state} />,
  ).replace(/<!-- -->/g, '');
}

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

function lookupState(overrides: Partial<RegisterLookupState>): RegisterLookupState {
  return {
    status: 'found',
    lookupId: 'A'.repeat(43),
    source: 'gus',
    vatStatus: 'active',
    activityStatus: 'active',
    noDetails: false,
    ...overrides,
  };
}

function statusRegion(html: string): string {
  const match = /<div id="org-lookup-status"[^>]*>(.*?)<\/div>/s.exec(html);
  return match?.[1] ?? '';
}

function valueOf(html: string, id: string): string | null {
  const match = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0];
  if (!match) return null;
  return /value="([^"]*)"/.exec(match)?.[1] ?? '';
}

beforeEach(() => {
  options.enabled = true;
});

describe('lookup on (T033)', () => {
  it('country and tax ID first, the fetch button, the hint and an empty status region', async () => {
    const html = await renderPage();
    const order = ['id="addr-country"', 'id="org-tax"', 'id="org-name"', 'id="addr-street"', 'id="addr-postal"', 'id="addr-city"'].map(
      (marker) => html.indexOf(marker),
    );
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const button = /<button[^>]*value="lookup"[^>]*>(.*?)<\/button>/s.exec(html);
    expect(button?.[0]).toContain('name="intent"');
    expect(button?.[0]).toContain('type="submit"');
    expect(button?.[0]).toMatch(/formNoValidate/i);
    expect(button?.[1]).toContain('Fetch company data');
    expect(html).toContain('Enter your NIP or EU VAT number');
    expect(html).toMatch(/<div id="org-lookup-status" role="status" aria-live="polite"[^>]*><\/div>/);
    expect(html).toContain('aria-describedby="org-tax-hint org-lookup-status"');
  });

  it('a found state (the no-JS round trip) is pre-filled, carries the reference, never a password', () => {
    const html = renderForm({
      values: { ...VALUES, organizationName: 'PRZYKŁADOWA SPÓŁKA', street: 'ul. Testowa 1' },
      lookup: lookupState({}),
      error: null,
    });
    expect(valueOf(html, 'org-name')).toBe('PRZYKŁADOWA SPÓŁKA');
    expect(valueOf(html, 'addr-street')).toBe('ul. Testowa 1');
    expect(valueOf(html, 'user-first')).toBe('Anna');
    expect(valueOf(html, 'user-email')).toBe('anna@example.test');
    expect(valueOf(html, 'user-password')).toBe('');
    expect(html).toMatch(new RegExp(`<input type="hidden" name="registryLookupId" value="${'A'.repeat(43)}"/>`));
    const region = statusRegion(html);
    expect(region).toContain('Company details filled in from the GUS REGON registry.');
    expect(region).toContain('VAT status: active VAT payer.');
    expect(html).toContain('Filled from the registry');
  });

  it('without JavaScript an Enter registers: the default button is a hidden "register", not the lookup (T060, research R-10)', async () => {
    const html = await renderPage();
    const form = /<form[^>]*>(.*)<\/form>/s.exec(html)?.[1] ?? '';
    const submits = [...form.matchAll(/<button[^>]*type="submit"[^>]*>/g)].map((match) => match[0]);
    expect(submits.length).toBe(3);
    // The first submit button in tree order is the one implicit submission (Enter) clicks.
    expect(submits[0]).toContain('value="register"');
    expect(submits[0]).toContain('aria-hidden="true"');
    expect(submits[0]).toContain('tabindex="-1"');
    expect(submits[0]).not.toMatch(/formNoValidate/i);
    expect(submits[1]).toContain('value="lookup"');
    expect(submits[2]).toContain('value="register"');
    expect(submits[2]).not.toContain('aria-hidden');
  });

  it('an invalid tax ID marks the field invalid, described by the status region', () => {
    const html = renderForm({
      values: VALUES,
      lookup: lookupState({ status: 'invalid_tax_id', source: null, lookupId: null }),
      error: null,
    });
    const taxInput = /<input[^>]*id="org-tax"[^>]*>/.exec(html)?.[0] ?? '';
    expect(taxInput).toContain('aria-invalid="true"');
    expect(taxInput).toContain('aria-describedby="org-tax-hint org-lookup-status"');
    const found = renderForm({ values: VALUES, lookup: lookupState({}), error: null });
    expect(/<input[^>]*id="org-tax"[^>]*>/.exec(found)?.[0]).not.toContain('aria-invalid');
  });

  it('the page itself puts nothing in a URL and ignores an old ?error=', async () => {
    const html = await renderPage({ error: 'Something old' });
    expect(html).not.toContain('Something old');
    expect(html).not.toMatch(/action="[^"]*\?/);
  });
});

describe('every outcome has its message and leaves the fields as they were (T043)', () => {
  it.each([
    [{ status: 'not_found', source: null }, 'We could not find this tax ID in the registry.'],
    [{ status: 'unavailable', source: null }, 'The registry is not responding right now.'],
    [{ status: 'invalid_tax_id', source: null, lookupId: null }, 'This tax ID does not look valid.'],
    [{ status: 'unsupported_country', source: null, lookupId: null }, 'Automatic lookup is not available for this country.'],
    [{ status: 'rate_limited', source: null, lookupId: null }, 'Too many lookups in a short time.'],
    [{ source: 'vies', noDetails: true }, 'This VAT number is valid, but the registry does not share company details'],
    [{ activityStatus: 'ceased' }, 'The registry reports that this company has ceased its activity.'],
    [{ vatStatus: 'exempt' }, 'VAT status: exempt from VAT.'],
    [{ vatStatus: 'not_registered' }, 'The registry reports this company is not registered for VAT.'],
    [{ vatStatus: 'unknown', source: 'gus' }, 'VAT status not checked.'],
    [{ source: 'mf' }, 'Company details filled in from the Ministry of Finance VAT White List.'],
  ] as const)('%o', (overrides, message) => {
    const html = renderForm({ values: VALUES, lookup: lookupState(overrides as Partial<RegisterLookupState>), error: null });
    expect(statusRegion(html)).toContain(message);
    expect(valueOf(html, 'org-name')).toBe('Typed Name');
    expect(valueOf(html, 'addr-street')).toBe('Typed street 1');
  });

  it('a refused registration shows the error in an alert, keeps every value but the password, and the reference', () => {
    const html = renderForm({
      values: VALUES,
      lookup: lookupState({}),
      error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'An account with this email already exists.' },
    });
    expect(html).toMatch(/role="alert"[^>]*>An account with this email already exists\.<\/div>/);
    expect(html).toContain('class="b2b-auth__error"');
    expect(valueOf(html, 'user-email')).toBe('anna@example.test');
    expect(valueOf(html, 'org-tax')).toBe('5260250995');
    expect(valueOf(html, 'user-password')).toBe('');
    expect(html).toContain(`value="${'A'.repeat(43)}"`);
  });
});

describe('lookup off (T047)', () => {
  it('no button, no hint, no status region; the same field order', async () => {
    options.enabled = false;
    const html = await renderPage();
    expect(html).not.toContain('value="lookup"');
    expect(html).not.toContain('Fetch company data');
    expect(html).not.toContain('org-tax-hint');
    expect(html).not.toContain('org-lookup-status');
    const order = ['id="addr-country"', 'id="org-tax"', 'id="org-name"', 'id="addr-street"'].map((m) => html.indexOf(m));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('Create account');
    // One submit button: no hidden default is needed when nothing precedes "Create account".
    expect(html.match(/type="submit"/g)?.length).toBe(1);
  });
});
