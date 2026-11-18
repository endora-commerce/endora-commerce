import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1491 (UX audit 2026-11-17, CAT-16) — the products list's status strip
 * (All / Active / Inactive / Archived) is the kit's `Tabs` (#1445): a named
 * tablist whose tabs control the list below it, a roving tab stop with
 * arrows and Home/End, and a count that is spoken with what it counts. The tab
 * still opens from `?status=`.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    usePageSizePreference: () => ({ pageSize: 25 as const, setPageSize: vi.fn() }),
  };
});

const { ProductsList } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductsList');

const LIST = '/api/v1/admin/catalog/products?';
const BUNDLE = { ...shippedCoreBundle('en'), ...shippedModuleBundle('catalog', 'en') };
const CATALOG_EN = shippedModuleBundle('catalog', 'en').catalog!;

beforeEach(() => {
  getSpy.mockReset().mockImplementation(async (path: string) =>
    path.startsWith(LIST)
      ? {
          data: [
            {
              id: '00000000-0000-4000-8000-000000000a01',
              sku: 'OAK-1',
              slug: 'oak-1',
              type: 'simple',
              status: 'active',
              name: 'Oak chair',
              visibility: 'public',
              attributeValues: {},
              updatedAt: '2026-05-15T10:00:00.000Z',
            },
          ],
          pagination: { page: 0, pageSize: 25, total: 1 },
          counts: { all: 3, active: 2, inactive: 1, archived: 0 },
        }
      : { data: [] },
  );
});

function renderList(url = '/catalog/products'): ReturnType<typeof renderWithI18n> {
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[url]}>
        <ProductsList />
      </MemoryRouter>,
      { presence: modulePresence({ present: ['catalog'] }), session: adminSession({ permissions: ['*'] }) },
    ),
    BUNDLE,
  );
}

function statusRequests(): Array<string | null> {
  return getSpy.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path.startsWith(LIST))
    .map((path) => new URLSearchParams(path.slice(LIST.length)).get('status'));
}

describe('ProductsList — the kit status tabs (issue #1491)', () => {
  it('renders a named tablist whose tabs control the list panel', async () => {
    renderList();
    await screen.findByText('Oak chair');
    const list = screen.getByRole('tablist', { name: CATALOG_EN['productsList.tabs.label']! });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel');
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0]!.id);
    expect(within(panel).getByText('Oak chair')).toBeInTheDocument();
    // The count says what it counts; an empty tab carries no number.
    expect(tabs[1]).toHaveAccessibleName('Active, items: 2');
    expect(tabs[3]).toHaveAccessibleName('Archived');
    // The strip only: the table's row checkboxes are another finding's (CAT-02 / DS-06).
    await expectNoAxeViolations(list);
  });

  it('moves between statuses with the arrow keys and Home/End', async () => {
    renderList();
    await screen.findByText('Oak chair');
    const user = userEvent.setup();
    const [all, active, inactive] = within(screen.getByRole('tablist')).getAllByRole('tab');
    all!.focus();
    await user.keyboard('{ArrowRight}');
    expect(active).toHaveFocus();
    expect(active).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(statusRequests()).toContain('active'));
    await user.keyboard('{ArrowRight}');
    expect(inactive).toHaveFocus();
    await waitFor(() => expect(statusRequests()).toContain('inactive'));
    await user.keyboard('{Home}');
    expect(all).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', all!.id);
  });

  it('opens on the tab the URL names', async () => {
    renderList('/catalog/products?status=inactive');
    await screen.findByText('Oak chair');
    expect(screen.getByRole('tab', { name: /^Inactive/ })).toHaveAttribute('aria-selected', 'true');
    expect(statusRequests()[0]).toBe('inactive');
  });
});
