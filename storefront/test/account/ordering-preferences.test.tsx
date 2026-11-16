import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { MeResult } from '../../lib/api/account';
import type { AddressSummary } from '../../lib/api/organization';
import type { QuickOrderPreference, QuickOrderPreferenceUpsert } from '../../lib/api/quick-order';
import { StorefrontApiError } from '../../lib/api/client';
import { POLISH_DIACRITIC, visibleText } from './i18n/text';

/**
 * Issue #359 — the ordering preferences page.
 *
 *  - An Organization's *Administrator* also sets the **organization** defaults
 *    every member inherits, in a second form on the same page; nobody else is
 *    offered it, nor is the Administrator of a personal (B2C) Organization,
 *    which is not a company (`lib/account/organization-area.ts`).
 *  - The empty choice of the buyer's own defaults names the value it inherits,
 *    read from the Organization's row; when that row cannot be read it says
 *    only "use the organization default".
 *  - Each form saves its own scope.
 */

type Who = 'administrator' | 'member' | 'personal';
let who: Who = 'administrator';
let locale = 'en-US';
let organizationRow: QuickOrderPreference | null = null;
let customerRow: QuickOrderPreference | null = null;
let organizationReadFails = false;
let refuse: StorefrontApiError | null = null;
const reads: Array<[string, string]> = [];
const upserts: QuickOrderPreferenceUpsert[] = [];

function me(): MeResult {
  const administrator = who !== 'member';
  return {
    customerAccount: {
      id: 'acc-1',
      organizationId: 'org-1',
      email: 'anna@example.com',
      firstName: 'Anna',
      lastName: 'Nowak',
      organizationRole: administrator
        ? { id: '00000000-0000-4000-8000-0000000000a1', kind: 'administrator', name: 'Administrator' }
        : { id: '00000000-0000-4000-8000-0000000000b1', kind: 'member', name: 'Member' },
      permissions: ['carts.create'],
      emailVerifiedAt: '2026-01-01T00:00:00.000Z',
      twoFactorEnabled: false,
      preferredLanguage: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    organization: {
      id: 'org-1',
      name: who === 'personal' ? 'Anna Nowak' : 'Acme',
      taxId: '1234567890',
      status: 'active',
      vatStatus: 'vat_payer',
      isPersonal: who === 'personal',
      registeredAddress: { street: 'Main 1', city: 'Krakow', postalCode: '30-001', country: 'PL' },
      legalName: null,
      version: 1,
      canTransact: true,
      moderationMessage: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    impersonation: null,
  };
}

const billing: AddressSummary = {
  id: 'addr-b',
  organizationId: 'org-1',
  kind: 'billing',
  recipientName: 'Acme HQ',
  street: 'Main 1',
  city: 'Krakow',
  postalCode: '30-001',
  country: 'PL',
  phone: null,
  isDefault: true,
};
const delivery: AddressSummary = { ...billing, id: 'addr-d', kind: 'delivery', recipientName: 'Acme Store' };

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session-cookie',
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
vi.mock('../../lib/api/account', () => ({ getMe: async () => me() }));
vi.mock('../../lib/api/methods', () => ({
  listPaymentMethods: async () => [{ id: 'pay-1', name: { 'en-US': 'Bank transfer', 'pl-PL': 'Przelew' } }],
  listDeliveryMethods: async () => [{ id: 'del-1', name: { 'en-US': 'Courier', 'pl-PL': 'Kurier' } }],
}));
vi.mock('../../lib/api/organization', () => ({
  listAddresses: async (_session: string, kind: string) => (kind === 'billing' ? [billing] : [delivery]),
}));
vi.mock('../../lib/api/quick-order', () => ({
  getQuickOrderPreference: async (_session: string, scope: string, scopeId: string) => {
    reads.push([scope, scopeId]);
    if (scope === 'organization') {
      if (organizationReadFails) throw new StorefrontApiError(403, 'FORBIDDEN', 'Not allowed.');
      return organizationRow;
    }
    return customerRow;
  },
  upsertQuickOrderPreference: async (_session: string, body: QuickOrderPreferenceUpsert) => {
    if (refuse) throw refuse;
    upserts.push(body);
    return body;
  },
}));

const { default: PreferencesPage } = await import('../../app/(account)/preferences/page');
const { saveOrderingPreferencesAction } = await import('../../lib/actions/ordering-preferences');

async function render(searchParams: Record<string, string> = {}): Promise<{ html: string; text: string }> {
  const html = renderToString(
    <>{(await PreferencesPage({ searchParams: Promise.resolve(searchParams) })) as ReactNode}</>,
  );
  return { html, text: visibleText(html) };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  who = 'administrator';
  locale = 'en-US';
  organizationRow = null;
  customerRow = null;
  organizationReadFails = false;
  refuse = null;
  reads.length = 0;
  upserts.length = 0;
});

describe('ordering preferences — the organization defaults (issue #359)', () => {
  it('offers a company Administrator a second form for the organization defaults, in both languages', async () => {
    organizationRow = {
      scope: 'organization',
      scopeId: 'org-1',
      defaultPaymentMethodId: 'pay-1',
      defaultDeliveryMethodId: null,
      defaultBillingAddressId: null,
      defaultShippingAddressId: null,
    };
    const en = await render();
    expect(en.text).toContain('Your defaults');
    expect(en.text).toContain('Organization defaults');
    expect(en.text).toContain('Every member of Acme who has not chosen their own uses these.');
    expect(en.text).toContain('Save organization defaults');
    expect(en.html).toContain('name="scope" value="organization"');
    expect(en.html).toContain('name="scope" value="customer"');
    expect(en.text).not.toMatch(POLISH_DIACRITIC);
    expect(reads).toContainEqual(['organization', 'org-1']);

    locale = 'pl-PL';
    const pl = await render();
    expect(pl.text).toContain('Twoje ustawienia domyślne');
    expect(pl.text).toContain('Ustawienia domyślne organizacji');
    expect(pl.text).toContain('Zapisz ustawienia organizacji');
  });

  it('offers no organization form to a member who is not the Administrator', async () => {
    who = 'member';
    const { html, text } = await render();
    expect(text).not.toContain('Organization defaults');
    expect(html).not.toContain('value="organization"');
  });

  it('offers no organization form in a personal Organization', async () => {
    who = 'personal';
    const { html, text } = await render();
    expect(text).not.toContain('Organization defaults');
    expect(html).not.toContain('value="organization"');
  });
});

describe('ordering preferences — what "use the organization default" stands for (issue #359)', () => {
  it('names the inherited value, and says when the organization has none', async () => {
    who = 'member';
    organizationRow = {
      scope: 'organization',
      scopeId: 'org-1',
      defaultPaymentMethodId: 'pay-1',
      defaultDeliveryMethodId: null,
      defaultBillingAddressId: 'addr-b',
      defaultShippingAddressId: null,
    };
    const en = await render();
    expect(en.text).toContain('Default payment method Organization default: Bank transfer');
    expect(en.text).toContain('Default billing address Organization default: Acme HQ');
    expect(en.text).toContain('Default delivery method No organization default');

    locale = 'pl-PL';
    const pl = await render();
    expect(pl.text).toContain('Domyślna metoda płatności Domyślnie w organizacji: Przelew');
    expect(pl.text).toContain('Domyślna metoda dostawy Brak ustawienia organizacji');
  });

  it('falls back to the plain sentence when the organization row cannot be read', async () => {
    who = 'member';
    organizationReadFails = true;
    const { text } = await render();
    expect(text).toContain('Default payment method (use the organization default)');
  });

  it('confirms the organization save in its own words', async () => {
    const { text } = await render({ saved: 'organization' });
    expect(text).toContain('Organization defaults saved.');
  });
});

describe('ordering preferences — saving (issue #359)', () => {
  it('saves the buyer’s own scope from the first form', async () => {
    await expect(
      saveOrderingPreferencesAction(form({ scope: 'customer', defaultPaymentMethodId: 'pay-1' })),
    ).rejects.toThrow('redirect /preferences?saved=1');
    expect(upserts).toEqual([
      {
        scope: 'customer',
        scopeId: 'acc-1',
        defaultPaymentMethodId: 'pay-1',
        defaultDeliveryMethodId: null,
        defaultBillingAddressId: null,
        defaultShippingAddressId: null,
      },
    ]);
  });

  it('saves the organization scope from the second form', async () => {
    await expect(
      saveOrderingPreferencesAction(form({ scope: 'organization', defaultShippingAddressId: 'addr-d' })),
    ).rejects.toThrow('redirect /preferences?saved=organization');
    expect(upserts[0]).toMatchObject({ scope: 'organization', scopeId: 'org-1', defaultShippingAddressId: 'addr-d' });
  });

  it('lands an address the organization no longer owns on the page as its own sentence', async () => {
    refuse = new StorefrontApiError(403, 'ADDRESS_NOT_OWNED', 'Address does not belong to the target organization.');
    await expect(
      saveOrderingPreferencesAction(form({ scope: 'customer', defaultBillingAddressId: 'addr-x' })),
    ).rejects.toThrow('redirect /preferences?error=ADDRESS_NOT_OWNED');
    const { text } = await render({ error: 'ADDRESS_NOT_OWNED' });
    expect(text).toContain('That address is no longer one of your organization’s. Choose another one.');
  });
});
