import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { RelatedPayerLink } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * `specs/182-related-payers/` T015 (FR-020, FR-022, FR-101) — the *Payers* section the
 * module contributes to the organization card's `organization.detail.after` stack
 * (RP-12): both lists, the immediate-action marking, no part in the card's Save, actions
 * only for `related_payers:manage`, enum labels from the module's own label map, and no
 * string that is not a translation key.
 */

const X = '00000000-0000-4000-8000-0000000000b1';
const Y = '00000000-0000-4000-8000-0000000000b2';
const Z = '00000000-0000-4000-8000-0000000000b3';

function link(over: Partial<RelatedPayerLink>): RelatedPayerLink {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    buyerOrganizationId: X,
    buyerName: 'Buyer X',
    payerOrganizationId: Y,
    payerName: 'Payer Y',
    payerTaxId: 'PL1234567890',
    buyerTaxId: null,
    state: 'active',
    addressScope: 'all',
    billingAddressId: null,
    validFrom: null,
    validTo: null,
    commercialTerms: 'buyer',
    notifyPayerOnOrders: false,
    origin: 'operator',
    originSource: null,
    revokedAt: null,
    revokedByKind: null,
    version: 1,
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    ...over,
  };
}

const AS_BUYER = [link({})];
const AS_PAYER = [
  link({
    id: '00000000-0000-4000-8000-0000000000c2',
    buyerOrganizationId: Z,
    buyerName: 'Buyer Z',
    payerOrganizationId: X,
    payerName: 'Buyer X',
    state: 'inactive',
    commercialTerms: 'payer',
  }),
];

const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';
const D1 = '00000000-0000-4000-8000-0000000000d1';

/** The payer's address book as `GET /api/v1/admin/organizations/:id/addresses` answers it. */
function address(id: string, kind: 'billing' | 'delivery', street: string) {
  return {
    id,
    organizationId: Y,
    kind,
    recipientName: 'Payer Y',
    street,
    city: 'Kraków',
    postalCode: '30-001',
    country: 'PL',
    phone: null,
    isDefault: false,
  };
}
const PAYER_ADDRESSES = [address(A1, 'billing', 'Billing 1'), address(D1, 'delivery', 'Delivery 1'), address(A2, 'billing', 'Billing 2')];

const calls: Array<{ method: string; url: string; body?: unknown; headers?: Record<string, string> | undefined }> = [];
let permissions = new Set<string>();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    useAuth: () => ({ hasPermission: (code: string) => permissions.has(code) }),
    apiClient: {
      ...actual.apiClient,
      get: async (url: string) => {
        calls.push({ method: 'GET', url });
        if (url.endsWith('/addresses')) return { data: PAYER_ADDRESSES };
        return { data: { asBuyer: AS_BUYER, asPayer: AS_PAYER } };
      },
      post: async (url: string, body?: unknown) => {
        calls.push({ method: 'POST', url, body });
        return { data: link({ state: 'revoked' }) };
      },
      patch: async (url: string, body?: unknown, options?: { headers?: Record<string, string> }) => {
        calls.push({ method: 'PATCH', url, body, headers: options?.headers });
        return { data: link({ state: 'inactive', version: 2 }) };
      },
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    OrganizationPicker: (props: { id?: string; onChange: (id: string | null) => void }) => (
      <button type="button" id={props.id} data-testid="org-picker" onClick={() => props.onChange(Y)} />
    ),
  };
});

const { PayersPanel } = await import('../../../../packages/modules/related_payers/src/admin/panels/PayersPanel');
const { relatedPayerLinkStateLabels, payerCommercialTermsLabels } = await import(
  '../../../../packages/modules/related_payers/src/admin/lib/labels'
);
const contributions = (await import('../../../../packages/modules/related_payers/src/admin/index')).contributions;
const enBundle = (await import('../../../../packages/modules/related_payers/i18n/en.json')).default as Record<string, string>;

function renderPanel() {
  const register = vi.fn();
  const saveSession = { register } as never;
  renderWithI18n(<PayersPanel organizationId={X} saveSession={saveSession} />);
  return { register };
}

describe('PayersPanel', () => {
  beforeEach(() => {
    calls.length = 0;
    permissions = new Set(['related_payers:read']);
  });

  it('is contributed to organization.detail.after, behind related_payers:read', () => {
    const zone = (contributions.zones ?? []).find((z) => z.zone === 'organization.detail.after');
    expect(zone).toBeDefined();
    expect(zone?.requiredPermission).toBe('related_payers:read');
  });

  it('renders both lists and the immediate-action marking, and joins no Save', async () => {
    const { register } = renderPanel();
    const asBuyer = await screen.findByRole('region', { name: 'related_payers.panel.asBuyer.title' });
    const asPayer = screen.getByRole('region', { name: 'related_payers.panel.asPayer.title' });
    expect(within(asBuyer).getByText('Payer Y')).toBeTruthy();
    expect(within(asPayer).getByText('Buyer Z')).toBeTruthy();
    expect(screen.getByText('core.saveSession.immediateBadge')).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
    expect(calls).toEqual([{ method: 'GET', url: `/api/v1/admin/organizations/${X}/related-payers` }]);
  });

  it('labels states and terms through the module label map', async () => {
    renderPanel();
    await screen.findByText('Payer Y');
    expect(screen.getAllByText(relatedPayerLinkStateLabels.label((k) => `related_payers.${k}`, 'active')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`related_payers.${'enums.linkState.inactive'}`).length).toBeGreaterThan(0);
    expect(payerCommercialTermsLabels.values).toEqual(['buyer', 'payer']);
  });

  it('shows no action without related_payers:manage', async () => {
    renderPanel();
    await screen.findByText('Payer Y');
    expect(screen.queryByRole('button', { name: 'related_payers.panel.actions.add' })).toBeNull();
    expect(screen.queryByRole('button', { name: /related_payers\.panel\.actions\.revoke/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /related_payers\.panel\.actions\.deactivate/ })).toBeNull();
  });

  it('with related_payers:manage, deactivates with If-Match and revokes after confirming', async () => {
    permissions.add('related_payers:manage');
    renderPanel();
    const asBuyer = await screen.findByRole('region', { name: 'related_payers.panel.asBuyer.title' });
    expect(screen.getByRole('button', { name: 'related_payers.panel.actions.add' })).toBeTruthy();

    fireEvent.click(within(asBuyer).getByRole('button', { name: 'related_payers.panel.actions.deactivate' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: `/api/v1/admin/related-payers/links/${AS_BUYER[0]!.id}`,
      body: { state: 'inactive' },
    });

    fireEvent.click(within(asBuyer).getByRole('button', { name: 'related_payers.panel.actions.revoke' }));
    fireEvent.click(await screen.findByRole('button', { name: 'related_payers.panel.revoke.confirm' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/revoke'))).toBe(true),
    );
  });

  it('shows whether the payer gets order e-mails, read-only without related_payers:manage', async () => {
    renderPanel();
    const asBuyer = await screen.findByRole('region', { name: 'related_payers.panel.asBuyer.title' });
    expect(within(asBuyer).getByText('related_payers.panel.notify.off')).toBeTruthy();
    expect(within(asBuyer).queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'related_payers.panel.actions.editAddress' })).toBeNull();
  });

  // FR-021 (owner, 2026-11-19) — the payer e-mails switch is an immediate audited write.
  it("with related_payers:manage, switches the link's payer e-mails at once, with If-Match", async () => {
    permissions.add('related_payers:manage');
    renderPanel();
    const asBuyer = await screen.findByRole('region', { name: 'related_payers.panel.asBuyer.title' });
    const toggle = within(asBuyer).getByRole('switch', { name: 'related_payers.panel.field.notifyPayerOnOrders' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: `/api/v1/admin/related-payers/links/${AS_BUYER[0]!.id}`,
      body: { notifyPayerOnOrders: true },
      headers: { 'If-Match': '"1"' },
    });
  });

  // FR-021 — the address restriction: one of the payer's billing addresses, or all of them.
  it("limits a link to one of the payer's billing addresses, and back to all", async () => {
    permissions.add('related_payers:manage');
    renderPanel();
    const asBuyer = await screen.findByRole('region', { name: 'related_payers.panel.asBuyer.title' });
    fireEvent.click(within(asBuyer).getByRole('button', { name: 'related_payers.panel.actions.editAddress' }));
    const select = await within(asBuyer).findByRole('combobox', { name: 'related_payers.panel.field.billingAddress' });
    expect(calls).toContainEqual({ method: 'GET', url: `/api/v1/admin/organizations/${Y}/addresses` });
    const options = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['all', A1, A2]);

    fireEvent.change(select, { target: { value: A2 } });
    fireEvent.click(within(asBuyer).getByRole('button', { name: 'related_payers.panel.address.save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: `/api/v1/admin/related-payers/links/${AS_BUYER[0]!.id}`,
      body: { addressScope: { kind: 'one', billingAddressId: A2 } },
      headers: { 'If-Match': '"1"' },
    });
  });

  it('adds a payer limited to one billing address, with payer e-mails on', async () => {
    permissions.add('related_payers:manage');
    renderPanel();
    await screen.findByText('Payer Y');
    fireEvent.click(screen.getByRole('button', { name: 'related_payers.panel.actions.add' }));
    const form = screen.getByRole('form', { name: 'related_payers.panel.add.title' });
    fireEvent.click(within(form).getByTestId('org-picker'));
    const select = await within(form).findByRole('combobox', { name: 'related_payers.panel.field.billingAddress' });
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3));
    fireEvent.change(select, { target: { value: A1 } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'related_payers.panel.field.notifyPayerOnOrders' }));
    fireEvent.click(within(form).getByRole('button', { name: 'related_payers.panel.add.submit' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      method: 'POST',
      url: `/api/v1/admin/organizations/${X}/related-payers`,
      body: {
        payerOrganizationId: Y,
        commercialTerms: 'buyer',
        addressScope: { kind: 'one', billingAddressId: A1 },
        notifyPayerOnOrders: true,
        validFrom: null,
        validTo: null,
      },
    });
  });

  it('creates a payer organization with payer e-mails on', async () => {
    permissions.add('related_payers:manage');
    permissions.add('customers:manage');
    renderPanel();
    await screen.findByText('Payer Y');
    fireEvent.click(screen.getByRole('button', { name: 'related_payers.panel.actions.create' }));
    const form = screen.getByRole('form', { name: 'related_payers.panel.create.title' });
    // A new Organization has no billing address yet: the link allows all of them.
    expect(within(form).queryByRole('combobox', { name: 'related_payers.panel.field.billingAddress' })).toBeNull();
    expect(within(form).getByText('related_payers.panel.create.addressHint')).toBeTruthy();
    fireEvent.click(within(form).getByRole('checkbox', { name: 'related_payers.panel.field.notifyPayerOnOrders' }));
    fireEvent.submit(form);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(`/api/v1/admin/organizations/${X}/related-payers/new-organization`);
    expect((post.body as { link: unknown }).link).toMatchObject({ commercialTerms: 'buyer', notifyPayerOnOrders: true });
  });

  it('writes no English: every rendered word is a key or data', async () => {
    permissions.add('related_payers:manage');
    const { container } = (() => {
      renderPanel();
      return { container: document.body };
    })();
    await screen.findByText('Payer Y');
    // A rendered key (`related_payers.panel.actions.editAddress`) is not English: the module's keys
    // are cut first, longest first, so a key's own letters ("Add" in "editAddress") never count.
    const keys = Object.keys(enBundle)
      .map((key) => `related_payers.${key}`)
      .sort((a, b) => b.length - a.length);
    const text = keys.reduce((rest, key) => rest.split(key).join(' '), container.textContent ?? '');
    for (const word of ['Payers', 'Add', 'Revoke', 'Active', 'Inactive', 'Deactivate', 'Buyer terms', 'All addresses', 'Billing address', 'e-mail']) {
      expect(text.includes(word) && !text.includes(`Buyer ${word}`), word).toBe(false);
    }
  });
});
