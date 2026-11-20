import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `specs/182-related-payers/` T089 (FR-044) — the registration page pre-fills the tax ID from a
 * live invitation to register (`?payerInvitation=<token>`); a token the API does not vouch for —
 * unknown, used up or expired — leaves the form as it always was. Nothing else is pre-filled and
 * nothing is created from the invitation.
 */

const lookups: string[] = [];
let answer: { taxId: string } | null = null;

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
  getRegistrationOptions: vi.fn(async () => ({ enabled: false, countries: [] })),
  lookupCompany: vi.fn(),
}));
vi.mock('../../lib/api/custom-field-input', () => ({ getRegistrationCustomFields: vi.fn(async () => ({ organization: [], customer: [] })) }));
vi.mock('../../lib/api/related-payers', () => ({
  lookupPayerInvitation: vi.fn(async (token: string) => {
    lookups.push(token);
    return answer;
  }),
}));
vi.mock('../../lib/api/auth', () => ({ registerOrganization: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const { default: RegisterPage } = await import('../../app/(auth)/register/page');

async function renderPage(searchParams: Record<string, string> = {}): Promise<string> {
  const element = await RegisterPage({ searchParams: Promise.resolve(searchParams) });
  return renderToString(element as ReactElement).replace(/<!-- -->/g, '');
}

function taxIdValue(html: string): string | null {
  const input = /<input[^>]*id="org-tax"[^>]*>/.exec(html)?.[0];
  if (!input) return null;
  return /value="([^"]*)"/.exec(input)?.[1] ?? '';
}

beforeEach(() => {
  lookups.length = 0;
  answer = null;
});

describe('registration from a payer invitation (T089)', () => {
  it('pre-fills the tax ID a live invitation names', async () => {
    answer = { taxId: 'PL5260250995' };
    const html = await renderPage({ payerInvitation: 'live-token-0123456789abcdef' });
    expect(lookups).toEqual(['live-token-0123456789abcdef']);
    expect(taxIdValue(html)).toBe('PL5260250995');
  });

  it('ignores an expired or unknown invitation: the form starts empty', async () => {
    answer = null;
    const html = await renderPage({ payerInvitation: 'expired-token-0123456789abcdef' });
    expect(lookups).toEqual(['expired-token-0123456789abcdef']);
    expect(taxIdValue(html)).toBe('');
  });

  it('asks nothing without an invitation', async () => {
    const html = await renderPage();
    expect(lookups).toEqual([]);
    expect(taxIdValue(html)).toBe('');
  });
});
