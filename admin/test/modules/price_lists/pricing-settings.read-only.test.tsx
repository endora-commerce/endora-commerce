import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { expectNoAxeViolations } from '../../helpers/axe';
import { CATALOG, IDS, PLATFORM_ADMIN, PRICING_READER } from '../../helpers/price-book-fixtures';

/**
 * *Pricing settings* for a reader (feature 161, coordinator ruling at the
 * Checkpoint 10 review; FR-028): an operator holding `price_lists:read` and
 * not `price_lists:write` sees every value — the default display modes and
 * each override's mode — and no control that would change one: no select,
 * no *Remove*, no *Add override*. The page used to offer them all and let the
 * server refuse the write. An operator holding both codes keeps every control.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen } = await import('../../helpers/price-book-screen');

const B = '/api/v1/admin/price-books';

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    const [path, query = ''] = url.split('?');
    if (path === '/api/v1/admin/pricing/display-mode-overrides') {
      const scope = new URLSearchParams(query).get('scope');
      return {
        data: {
          items:
            scope === 'organization'
              ? [{ scope: 'organization', targetId: IDS.orgs.Acme, mode: 'net_only', updatedAt: '2026-10-22T10:00:00.000Z' }]
              : [],
        },
      };
    }
    if (path === '/api/v1/admin/settings/pricing.default_display_mode') return { defaultValue: 'both' };
    if (path === '/api/v1/admin/settings/pricing.unauthenticated_display_mode') return { defaultValue: 'none' };
    if (path === `${B}/settings/show-list-price`) return { data: { value: false } };
    if (path === `${B}/precedence`) {
      return {
        data: {
          version: 1,
          preset: 'HY',
          categoryBeforeAttribute: true,
          depthMode: 'within_cell',
          cells: [
            'org.variant', 'org.product', 'org.category_attribute', 'org.category', 'org.attribute',
            'group.variant', 'group.product', 'group.category_attribute', 'group.category', 'group.attribute',
            'org.all', 'group.all',
          ],
        },
      };
    }
    if (path === `${B}/targets/organizations`) return { data: { items: CATALOG.organizations } };
    if (path === `${B}/targets/categories`) return { data: { items: CATALOG.categories } };
    if (path === '/api/v1/admin/catalog/products') return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
});

async function open(session: typeof PLATFORM_ADMIN): Promise<void> {
  mountScreen({ path: '/price-lists/display-modes', session });
  await screen.findByRole('heading', { level: 1, name: 'Pricing settings' });
  await screen.findByText('Acme B2B (demo)');
}

describe('Pricing settings — a reader sees values, never controls (FR-028)', () => {
  it('shows the default display modes as values, with no select', async () => {
    await open(PRICING_READER);
    const defaults = screen.getByRole('region', { name: 'Default display modes' });
    expect(within(defaults).queryAllByRole('combobox')).toEqual([]);
    expect(within(defaults).getByText('Default display mode (signed-in customers)')).toBeInTheDocument();
    expect(within(defaults).getByText('Both columns')).toBeInTheDocument();
    expect(within(defaults).getByText('Unauthenticated display mode (anonymous visitors)')).toBeInTheDocument();
    expect(within(defaults).getByText('None — quote only')).toBeInTheDocument();
  });

  it('shows each override’s mode as a value, with no select, Remove or Add override', async () => {
    await open(PRICING_READER);
    const row = screen.getByText('Acme B2B (demo)').closest('tr')!;
    expect(within(row).getByText('Net only')).toBeInTheDocument();
    expect(within(row).queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add override/ })).toBeNull();
    // Still a reader's page: the scope tabs and the search stay.
    expect(screen.getByRole('button', { name: 'Category' })).toBeInTheDocument();
    expect(screen.queryAllByRole('combobox')).toEqual([]);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('keeps every control for an operator holding price_lists:write', async () => {
    await open(PLATFORM_ADMIN);
    const defaults = screen.getByRole('region', { name: 'Default display modes' });
    expect(within(defaults).getByRole('combobox', { name: 'Default display mode (signed-in customers)' })).toHaveValue('both');
    expect(within(defaults).getByRole('combobox', { name: 'Unauthenticated display mode (anonymous visitors)' })).toHaveValue('none');
    const row = screen.getByText('Acme B2B (demo)').closest('tr')!;
    expect(within(row).getByRole('combobox', { name: 'Mode for Acme B2B (demo)' })).toHaveValue('net_only');
    expect(within(row).getByRole('button', { name: /Remove/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add override/ })).toBeInTheDocument();
  });

  it('has no axe violations for a reader', async () => {
    await open(PRICING_READER);
    await expectNoAxeViolations(document.body);
  });
});
