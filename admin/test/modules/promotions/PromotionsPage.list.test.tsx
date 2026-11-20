import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { setMobileViewport } from '../../setup';

/**
 * Issue #1664 (UX audit SALES-24, #1500) — the promotions list read the whole
 * array into a plain table, with an Edit, a Statistics and a red Delete button
 * on every row, and English built in code ("10% off cart", "Free delivery") and
 * raw codes (`percentage_off_cart`) in its cells. It is the kit `ListPage` now,
 * server-paged through the endpoint's `page` / `pageSize`.
 */
installOffsetParentShim();

const api = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => api.get(...a),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: (...a: unknown[]) => api.delete(...a),
    },
  };
});

const { PromotionsPage } = await import('../../../../packages/modules/promotions/src/admin/pages/PromotionsPage');

const BUNDLE = { ...shippedCoreBundle('en'), ...shippedModuleBundle('promotions', 'en') };
const core = BUNDLE.core!;
const promo = BUNDLE.promotions!;

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

const promotion = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  code: null,
  name: `Promo ${n}`,
  kind: null,
  value: null,
  currency: null,
  minCartSubtotal: null,
  validFrom: null,
  validUntil: null,
  criteria: [],
  isActive: true,
  createdAt: '2026-11-01T10:00:00.000Z',
  action: { type: 'percentage_off_cart', percent: 10 },
  ...overrides,
});

function answer(rows: ReturnType<typeof promotion>[], total = rows.length): void {
  api.get.mockImplementation(async (path: string) => {
    const query = new URLSearchParams(path.split('?')[1] ?? '');
    return {
      data: rows,
      meta: { page: Number(query.get('page')), pageSize: Number(query.get('pageSize')), total },
    };
  });
}

const listCalls = (): URLSearchParams[] =>
  api.get.mock.calls
    .map((c) => c[0] as string)
    .filter((p) => p.startsWith('/api/v1/admin/promotions'))
    .map((p) => new URLSearchParams(p.split('?')[1] ?? ''));

function render(permissions: string[] = ['*']): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <PromotionsPage />
      </MemoryRouter>,
      { session: adminSession({ permissions }) },
    ),
    BUNDLE,
  );
}

beforeEach(() => {
  setMobileViewport(false);
  api.get.mockReset();
  api.delete.mockReset();
});
afterEach(() => cleanup());

describe('PromotionsPage (issue #1664)', () => {
  it('asks the endpoint for one page and draws the kit pager over its total', async () => {
    answer([promotion(1), promotion(2)], 45);
    render();
    expect(await screen.findByText('Showing 1–20 of 45')).toBeInTheDocument();
    expect(listCalls()[0]!.get('page')).toBe('1');
    expect(listCalls()[0]!.get('pageSize')).toBe('20');
    expect(screen.getByRole('status')).toHaveTextContent(fill(promo['list.count']!, { count: 45 }));
    await userEvent.click(screen.getByRole('button', { name: core['common.pagination.next']! }));
    await waitFor(() => expect(listCalls().at(-1)!.get('page')).toBe('2'));
  });

  it('says what a promotion does in the admin language, never as a code', async () => {
    answer([
      promotion(1),
      promotion(2, { action: { type: 'free_delivery' } }),
      promotion(3, {
        action: null,
        kind: 'percentage_off',
        value: 15,
        criteria: [
          { type: 'attribute', attributeKey: 'brand', op: 'in', values: ['Acme', 'Bolt'] },
          { type: 'category', categoryIds: ['00000000-0000-4000-8000-0000000000c1'] },
        ],
      }),
    ]);
    render();
    await screen.findByText('Promo 1');
    expect(screen.queryByText('percentage_off_cart')).toBeNull();
    expect(screen.queryByText(/off cart/)).toBeNull();
    expect(screen.getAllByText(promo['action.percentage_off_cart']!)).toHaveLength(1);
    expect(screen.getByText(promo['action.free_delivery']!)).toBeInTheDocument();
    expect(screen.getByText(promo['list.kind.percentage_off']!)).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText('15%')).toBeInTheDocument();
    // Every criterion kind is drawn, not only the attribute one.
    expect(
      screen.getByText(
        `${fill(promo['list.criterion.attribute']!, { attribute: 'brand', op: promo['list.criterion.op.in']!, values: 'Acme, Bolt' })}; ${fill(promo['list.criterion.category']!, { count: 1 })}`,
      ),
    ).toBeInTheDocument();
  });

  it('puts New promotion in the header, the name as the link, and Delete last in the row menu, confirmed', async () => {
    answer([promotion(1)]);
    api.delete.mockResolvedValue(undefined);
    render();
    const header = screen.getByRole('heading', { level: 1, name: core['promotions.page.title']! }).closest('header')!;
    expect(within(header).getByRole('link', { name: promo['list.new']! })).toHaveAttribute('href', '/promotions/new');
    expect(await screen.findByRole('link', { name: 'Promo 1' })).toHaveAttribute(
      'href',
      '/promotions/00000000-0000-4000-8000-000000000001',
    );
    expect(screen.queryByRole('button', { name: core['promotions.action.delete']! })).toBeNull();

    fireEvent.pointerDown(screen.getByRole('button', { name: fill(promo['list.rowMenu.label']!, { name: 'Promo 1' }) }), {
      button: 0,
      ctrlKey: false,
    });
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.at(-1)).toHaveTextContent(core['promotions.action.delete']!);
    await userEvent.click(items.at(-1)!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: core['common.action.delete']! }));
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith('/api/v1/admin/promotions/00000000-0000-4000-8000-000000000001'),
    );
  });

  it('offers neither New promotion nor Delete to a reader', async () => {
    answer([promotion(1)]);
    render(['promotions:read']);
    expect(await screen.findByText('Promo 1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: promo['list.new']! })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Promo 1' })).toBeNull();
  });

  it('shows the empty state for no promotions, and a translated error with Retry', async () => {
    answer([]);
    render();
    expect(await screen.findByText(promo['list.emptyTitle']!)).toBeInTheDocument();
    cleanup();
    api.get.mockReset();
    api.get.mockRejectedValueOnce(new Error('network'));
    answer([promotion(1)]);
    render();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(core['common.list.loadError']!);
    await userEvent.click(within(alert).getByRole('button', { name: core['common.action.retry']! }));
    expect(await screen.findByText('Promo 1')).toBeInTheDocument();
  });
});
