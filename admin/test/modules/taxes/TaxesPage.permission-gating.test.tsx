import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `taxes` owns its authority — the screen.
 *
 * The module's four admin routes moved from `catalog:write` to
 * `taxes:read` / `taxes:write`, so an operator who can edit a product no longer
 * sets the VAT rate every price, order total and invoice is computed from. Two
 * admin surfaces carried the old code and neither is read by
 * `check:action-route-permissions`, which sees the manifest action and the
 * backend route and nothing in this application — and this module declares no
 * manifest action at all, so the check sees nothing of it either way. The
 * sidebar entry is covered where it is declared, by
 * `test/components/AppShell.permission-gating.test.tsx`. This file is the
 * other: the screen itself, which a denied operator can still navigate to
 * directly, the admin router carrying no permission guard of its own.
 *
 * Denied means **absent**, not disabled and not a 403 panel — the treatment
 * `AppShell.tsx`'s `PALETTE_ITEMS` comment argues for at length.
 *
 * Both axes are exercised, because they are two different refusals over one
 * screen: a permission the role does not hold, and the module not being present
 * (Constitution XVII item 5). For `taxes` the second is the **platform**
 * availability axis and not an operator's switch — the manifest declares
 * `activation.nonDeactivatable`, so no operator can withdraw it, while a
 * deployment that never installs the module is a state the manifest's own
 * comment records as still open. The screen asks the same question either way,
 * through the same predicate every other surface uses; the mocks stop at
 * `useAuth` and `useModulePresence` deliberately, so the real
 * `useSurfaceVisibility` is the thing under test rather than a stub of it.
 *
 * The write half is asserted separately, and it is new: until this change there
 * was no read-only role to have, because reading the table required the write
 * code. Now there is, so the upsert form and the delete buttons are gated on
 * `taxes:write` — hidden, for the same reason the screen is.
 */

const rows = [
  {
    id: '00000000-0000-4000-8000-00000000dd01',
    code: 'tax_gating_row',
    name: 'Gating rule',
    rate: 0.23,
    country: 'PL',
    productType: null,
    appliesToVatStatuses: [],
    isDefault: false,
    priority: 0,
  },
];

const get = vi.fn(async () => ({ data: rows }));
const put = vi.fn(async () => ({ data: rows[0] }));
const del = vi.fn(async () => undefined);

vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  apiClient: {
    get: (...args: unknown[]) => get(...(args as [])),
    put: (...args: unknown[]) => put(...(args as [])),
    delete: (...args: unknown[]) => del(...(args as [])),
  },
}));

/** The codes the signed-in operator holds, per case. */
let permissions: readonly string[] = [];

/** The modules the projection reports present, per case. */
let presentModules: readonly string[] = [];

const KEYS = [
  'taxes.page.title',
  'taxes.page.description',
  'taxes.noPermission',
  'taxes.loading',
  'taxes.empty',
  'taxes.upsert.title',
  'taxes.column.code',
  'taxes.column.name',
  'taxes.column.rate',
  'taxes.column.country',
  'taxes.column.productType',
  'taxes.column.vatStatuses',
  'taxes.column.default',
  'taxes.column.priority',
  'taxes.action.delete',
  'taxes.action.save',
  'taxes.field.code',
  'taxes.field.name',
  'taxes.field.rate',
  'taxes.field.country',
  'taxes.field.productType',
  'taxes.field.priority',
  'taxes.field.vatStatuses',
  'taxes.field.isDefault',
  'taxes.option.any',
];

function mount(): Promise<void> {
  return import('@/modules/taxes/TaxesPage').then(({ TaxesPage }) => {
    renderWithI18n(
      withSession(
        <MemoryRouter initialEntries={['/taxes']}>
          <TaxesPage />
        </MemoryRouter>,
        { session: adminSession({ permissions }), presence: modulePresence({ present: presentModules }) },
      ),
      passthroughBundle('core', KEYS),
    );
  });
}

describe('the taxes screen is gated on the module’s own codes', () => {
  it('renders a refusal instead of the screen for a catalogue editor, and asks the API nothing', async () => {
    get.mockClear();
    presentModules = ['taxes'];
    // The role the old gate handed the whole surface to: `catalog:write` was
    // the code on all four routes, the two reads included.
    permissions = ['catalog:read', 'catalog:write'];

    await mount();

    await waitFor(() => expect(screen.getByText('taxes.noPermission')).toBeInTheDocument());
    expect(screen.queryByText('tax_gating_row')).not.toBeInTheDocument();
    // Absent, not 403: the screen never asks the question it would be refused.
    expect(get).not.toHaveBeenCalled();
  });

  it('renders the screen for a role holding taxes:read', async () => {
    get.mockClear();
    presentModules = ['taxes'];
    permissions = ['taxes:read'];

    await mount();

    await waitFor(() => expect(screen.getByText('tax_gating_row')).toBeInTheDocument());
    expect(screen.queryByText('taxes.noPermission')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalled();
  });

  it('offers no editing affordance to a role holding taxes:read alone', async () => {
    // The capability the pair creates: a rate can now be shown to someone who
    // may not change it. Hidden rather than disabled, and hidden rather than
    // left to 403 on submit.
    get.mockClear();
    presentModules = ['taxes'];
    permissions = ['taxes:read'];

    await mount();

    await waitFor(() => expect(screen.getByText('tax_gating_row')).toBeInTheDocument());
    expect(screen.queryByText('taxes.upsert.title')).not.toBeInTheDocument();
    expect(screen.queryByText('taxes.action.delete')).not.toBeInTheDocument();
  });

  it('offers the editing affordances to a role holding the pair', async () => {
    get.mockClear();
    presentModules = ['taxes'];
    permissions = ['taxes:read', 'taxes:write'];

    await mount();

    await waitFor(() => expect(screen.getByText('tax_gating_row')).toBeInTheDocument());
    expect(screen.getByText('taxes.upsert.title')).toBeInTheDocument();
    expect(screen.getAllByText('taxes.action.delete').length).toBeGreaterThan(0);
  });

  it('renders no screen when the module itself is not present, whatever the role holds', async () => {
    // The other axis. `taxes` declares `activation.nonDeactivatable`, so this
    // is the platform-availability half — a deployment that never installed the
    // module — rather than an operator's switch. A permission gate alone would
    // leave this page rendering and answering 503 for a role that is perfectly
    // adequate.
    get.mockClear();
    permissions = ['taxes:read', 'taxes:write'];
    presentModules = [];

    await mount();

    await waitFor(() => expect(screen.getByText('taxes.noPermission')).toBeInTheDocument());
    expect(get).not.toHaveBeenCalled();
  });
});
