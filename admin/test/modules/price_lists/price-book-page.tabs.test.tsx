import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { priceBookSchema, type PriceBook } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BOOKS, PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';

/**
 * Issue #1491 (UX audit 2026-11-17, CAT-16) — the price book's Settings /
 * Prices switcher is the kit's `Tabs` (#1445): the design system's `.b2b-tab`
 * look shared with every other strip, Home/End beside the arrows, the panel
 * labelled by the selected tab, and the tab still in `?tab=`. Both sections stay
 * mounted, so unsaved prices survive a look at the settings.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen, currentParams } = await import('../../helpers/price-book-screen');
const { serveBook, linesOf, mkRow, PRODUCTS } = await import('../../helpers/price-book-grid');

let book: PriceBook;

beforeEach(() => {
  const rows = [mkRow({ product: PRODUCTS.P1, price: { type: 'percent', percent: '-20.00' } })];
  book = priceBookSchema.parse({ ...BOOKS.L2, tierStarts: [1], rowCount: rows.length });
  serveBook(api, { book, lines: linesOf(rows), products: [] });
});

async function open(query = '') {
  const mounted = mountScreen({ path: `/price-lists/${book.id}${query}`, session: PLATFORM_ADMIN });
  await screen.findByRole('heading', { level: 1, name: book.name });
  return mounted;
}

describe('PriceBookPage — the kit tab strip (issue #1491)', () => {
  it('draws the design-system strip, its tabs naming the one panel', async () => {
    const { container } = await open();
    const list = screen.getByRole('tablist', { name: 'Price book sections' });
    expect(list).toHaveClass('b2b-tabs');
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Settings', 'Prices']);
    for (const tab of tabs) expect(tab).toHaveClass('b2b-tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveClass('is-active');
    const panel = screen.getByRole('tabpanel');
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0]!.id);
    await expectNoAxeViolations(container);
  });

  it('moves with the arrows and jumps with Home/End, keeping the tab in the URL', async () => {
    await open();
    const user = userEvent.setup();
    screen.getByRole('tab', { name: 'Settings' }).focus();
    await user.keyboard('{End}');
    const prices = screen.getByRole('tab', { name: 'Prices' });
    expect(prices).toHaveFocus();
    expect(prices).toHaveAttribute('aria-selected', 'true');
    expect(currentParams().get('tab')).toBe('prices');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', prices.id);
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveFocus();
    expect(currentParams().get('tab')).toBeNull();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Prices' })).toHaveFocus();
    expect(currentParams().get('tab')).toBe('prices');
  });

  it('opens the tab the URL names, with the other section still mounted but hidden', async () => {
    await open('?tab=prices');
    expect(await screen.findByRole('grid')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Prices' })).toHaveAttribute('aria-selected', 'true');
    // The settings form is kept (hidden), so switching back loses nothing.
    expect(document.querySelector('[hidden] input')).not.toBeNull();
  });
});
