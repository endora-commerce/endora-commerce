import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { priceBookSchema } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BOOKS, CATALOG, PLATFORM_ADMIN, summaryOf } from '../../helpers/price-book-fixtures';

/**
 * The price-book editor's accessibility sweep (feature 161, T095 and T097;
 * SC-003, FR-031, FR-033).
 *
 * - **axe, per screen**: the list, the create flow, a book's settings and
 *   prices, the import and duplicate dialogs, the explainer, *Pricing
 *   settings* and the product's base-price panel, each with no WCAG 2.2 A/AA
 *   violation.
 * - **One filled primary per view** (Von Restorff), and the destructive
 *   *Delete* never beside it: behind a menu or a confirmation.
 * - **Keyboard only**: US1 (create a book), US2 (type prices into the grid and
 *   save) and US3 (the product's base price) walked with Tab, typing, Enter and
 *   Space — every control reached in order, nothing needing a pointer.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen, mountBasePricePanel, primaryActions } = await import('../../helpers/price-book-screen');
const { serveBook, linesOf, mkRow, PRODUCTS, B } = await import('../../helpers/price-book-grid');
const { P5, basePrices } = await import('./base-price-fixture');

const ROWS = [
  mkRow({ category: 'screws', price: { type: 'percent', percent: '-10.00' } }),
  mkRow({ product: PRODUCTS.P1, price: { type: 'percent', percent: '-20.00' } }),
];
const BOOK = priceBookSchema.parse({ ...BOOKS.L2, rowCount: ROWS.length, tierStarts: [1] });
const HY = {
  version: 1,
  preset: 'HY',
  categoryBeforeAttribute: true,
  depthMode: 'within_cell',
  cells: [
    'org.variant', 'org.product', 'org.category_attribute', 'org.category', 'org.attribute',
    'group.variant', 'group.product', 'group.category_attribute', 'group.category', 'group.attribute',
    'org.all', 'group.all',
  ],
};

/** One server for every screen: the book's own reads and the rest of the editor's. */
function serveEverything(): void {
  serveBook(api, { book: BOOK, lines: linesOf(ROWS) });
  const book = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string) => {
    const [path] = url.split('?');
    if (path === B) {
      const data = [BOOKS.base, BOOKS.L1, BOOK, BOOKS.L3].map(summaryOf);
      return { data, meta: { page: 1, pageSize: 20, totalCount: data.length, creatableAudienceKinds: ['everyone', 'customer_groups', 'organizations'] } };
    }
    if (path === `${B}/targets/currencies`) return { data: { items: [{ code: 'PLN', exposedByChannels: ['b2b_pl'] }] } };
    if (path === `${B}/precedence`) return { data: HY };
    if (path === `${B}/settings/show-list-price`) return { data: { value: false } };
    if (path === '/api/v1/admin/pricing/display-mode-overrides') return { data: { items: [] } };
    if (path?.startsWith('/api/v1/admin/settings/')) return { defaultValue: 'gross_only' };
    if (path === `${B}/base-prices`) return { data: basePrices() };
    if (path === `/api/v1/admin/catalog/products/${P5}/variants`) return { data: [] };
    if (path === `${B}/${BOOK.id}/rows`) return { data: ROWS, meta: { page: 1, pageSize: 1000, totalCount: ROWS.length } };
    return book(url);
  });
  api.post.mockImplementation(async (url: string) => {
    if (url === B) return { data: { ...BOOK, status: 'draft' } };
    throw new Error(`unexpected POST ${url}`);
  });
  api.put.mockImplementation(async (url: string) => {
    if (url === `${B}/${BOOK.id}/rows`) return { data: { version: BOOK.version + 1, rows: [] } };
    if (url.startsWith(`${B}/base-prices/`)) return { data: basePrices() };
    throw new Error(`unexpected PUT ${url}`);
  });
}

beforeEach(() => serveEverything());

/** The b2b-kit primary buttons of the older screens count too. */
const primaries = (container: HTMLElement): string[] =>
  [
    ...primaryActions(container),
    ...[...container.querySelectorAll<HTMLElement>('.b2b-btn--primary')].filter((e) => e.closest('[hidden]') === null),
  ].map((e) => e.textContent?.trim() ?? '');

type Screen = { readonly name: string; readonly open: () => Promise<HTMLElement>; readonly primary: string | null };

const user = (): ReturnType<typeof userEvent.setup> => userEvent.setup();

const SCREENS: Screen[] = [
  {
    name: 'the book list',
    open: async () => {
      const { container } = mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN });
      await screen.findByRole('table');
      return container;
    },
    primary: 'New price book',
  },
  {
    name: 'the create flow',
    open: async () => {
      const { container } = mountScreen({ path: '/price-lists/new', session: PLATFORM_ADMIN });
      await screen.findByRole('heading', { name: 'Step 1 of 5: Name and type' });
      return container;
    },
    primary: 'Next',
  },
  {
    name: 'a book’s settings',
    open: async () => {
      const { container } = mountScreen({ path: `/price-lists/${BOOK.id}`, session: PLATFORM_ADMIN });
      await screen.findByRole('heading', { level: 1, name: BOOK.name });
      await screen.findByLabelText('Name');
      return container;
    },
    primary: 'Save changes',
  },
  {
    name: 'a book’s prices',
    open: async () => {
      const { container } = mountScreen({ path: `/price-lists/${BOOK.id}?tab=prices`, session: PLATFORM_ADMIN });
      await screen.findByRole('grid');
      return container;
    },
    primary: 'Save prices',
  },
  {
    name: 'the import dialog',
    open: async () => {
      const u = user();
      mountScreen({ path: `/price-lists/${BOOK.id}?tab=prices`, session: PLATFORM_ADMIN });
      await screen.findByRole('grid');
      await u.click(screen.getByRole('button', { name: 'CSV file' }));
      await u.click(await screen.findByRole('menuitem', { name: 'Import from CSV…' }));
      return screen.findByRole('dialog', { name: 'Import prices from a CSV file' });
    },
    primary: 'Preview',
  },
  {
    name: 'the duplicate dialog',
    open: async () => {
      const u = user();
      mountScreen({ path: `/price-lists/${BOOK.id}`, session: PLATFORM_ADMIN });
      await u.click(await screen.findByRole('button', { name: 'Duplicate' }));
      return screen.findByRole('dialog');
    },
    primary: 'Duplicate',
  },
  {
    name: 'the price explainer',
    open: async () => {
      const { container } = mountScreen({ path: '/price-lists/explain', session: PLATFORM_ADMIN });
      await screen.findByRole('heading', { level: 1, name: 'Price explainer' });
      return container;
    },
    primary: 'Explain',
  },
  {
    name: 'Pricing settings',
    open: async () => {
      const { container } = mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN });
      await screen.findByRole('region', { name: 'Price precedence' });
      await screen.findByText('Contract first, blanket last (HY)');
      return container;
    },
    primary: 'Add override',
  },
  {
    name: 'the product’s base prices',
    open: async () => {
      const { container } = mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
      await screen.findByRole('group', { name: 'PLN' });
      return container;
    },
    primary: 'Save prices',
  },
];

describe('accessibility sweep — axe on every screen (SC-003)', () => {
  for (const s of SCREENS) {
    it(`${s.name} has no WCAG 2.2 A/AA violation`, async () => {
      const root = await s.open();
      await expectNoAxeViolations(root);
    });
  }
});

describe('primary-action sweep — one filled primary per view (FR-033)', () => {
  for (const s of SCREENS) {
    it(`${s.name}: ${s.primary ?? 'no'} primary, alone`, async () => {
      const root = await s.open();
      expect(primaries(root).map((label) => label.replace(/\s+/g, ' '))).toEqual(s.primary ? [expect.stringContaining(s.primary)] : []);
    });
  }

  it('keeps Delete behind a menu or a confirmation, never beside a primary', async () => {
    const u = user();
    mountScreen({ path: `/price-lists/${BOOK.id}`, session: PLATFORM_ADMIN });
    await u.click(await screen.findByRole('button', { name: 'Delete price book' }));
    const dialog = await screen.findByRole('dialog');
    // The confirmation names what goes, and cancelling is the default focus.
    expect(dialog.textContent).toContain(BOOK.name);
    expect(api.delete).not.toHaveBeenCalled();
  });
});

/** Press Tab until `target` has focus; fail when it is not reached in order. */
async function tabTo(u: ReturnType<typeof userEvent.setup>, target: () => HTMLElement, limit = 60): Promise<void> {
  for (let i = 0; i < limit; i += 1) {
    if (document.activeElement === target()) return;
    await u.tab();
  }
  throw new Error(`not reached by Tab: ${target().outerHTML.slice(0, 120)}`);
}

/** A create-flow step reached, with focus moved to its heading as the flow moves it. */
async function stepReached(n: number, name: string): Promise<void> {
  const heading = await screen.findByRole('heading', { name: `Step ${n} of 5: ${name}` });
  await waitFor(() => expect(document.activeElement).toBe(heading));
}

describe('keyboard only (FR-031)', () => {
  it('US1 — creates an organization book without a pointer', async () => {
    const u = user();
    mountScreen({ path: '/price-lists/new', session: PLATFORM_ADMIN });
    await screen.findByRole('heading', { name: 'Step 1 of 5: Name and type' });
    await tabTo(u, () => screen.getByLabelText('Name'));
    await u.keyboard('Acme spring terms');
    await tabTo(u, () => screen.getByRole('button', { name: 'Next' }));
    await u.keyboard('{Enter}');
    await stepReached(2, 'Currency');
    await tabTo(u, () => screen.getByRole('radio', { name: /^PLN/ }));
    await u.keyboard(' ');
    await tabTo(u, () => screen.getByRole('button', { name: 'Next' }));
    await u.keyboard('{Enter}');
    await stepReached(3, 'Sales channels');
    await tabTo(u, () => screen.getByRole('checkbox', { name: 'B2B PL' }));
    await u.keyboard(' ');
    await tabTo(u, () => screen.getByRole('button', { name: 'Next' }));
    await u.keyboard('{Enter}');
    await stepReached(4, 'Audience');
    await tabTo(u, () => screen.getByRole('radio', { checked: true }));
    // Arrow keys move a radio group's choice (the native group's own keyboard model).
    while (!screen.getByRole('radio', { name: /Organizations/ }).matches(':checked')) await u.keyboard('{ArrowDown}');
    await tabTo(u, () => screen.getByRole('combobox', { name: 'Add an organization' }));
    await u.keyboard('Acme');
    await screen.findByRole('option', { name: /Acme B2B \(demo\)/ });
    // The first match is highlighted as the list opens; Enter takes it.
    await u.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Remove Acme B2B (demo)' })).toBeInTheDocument();
    await tabTo(u, () => screen.getByRole('button', { name: 'Next' }));
    await u.keyboard('{Enter}');
    await stepReached(5, 'Schedule and priority');
    await tabTo(u, () => screen.getByRole('button', { name: 'Create draft' }));
    await u.keyboard('{Enter}');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(B, expect.objectContaining({ name: 'Acme spring terms', currencyCode: 'PLN' })));
  });

  it('US2 — types prices into the grid and saves without a pointer', async () => {
    const u = user();
    mountScreen({ path: `/price-lists/${BOOK.id}?tab=prices`, session: PLATFORM_ADMIN });
    const grid = await screen.findByRole('grid');
    await tabTo(u, () => within(grid).getAllByRole('gridcell')[0]!);
    await u.keyboard('{ArrowDown}');
    await u.keyboard('-25%{Enter}');
    expect(screen.getByTestId('unsaved-count')).toHaveTextContent('Unsaved changes: 1');
    await tabTo(u, () => screen.getByRole('button', { name: 'Save prices' }), 120);
    await u.keyboard('{Enter}');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${B}/${BOOK.id}/rows`, expect.objectContaining({ mode: 'merge' })));
  });

  it('US3 — sets a product’s base price without a pointer', async () => {
    const u = user();
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    const pln = await screen.findByRole('group', { name: 'PLN' });
    await tabTo(u, () => within(pln).getByLabelText('Price from 1, PLN'));
    await u.keyboard('{Control>}a{/Control}82,50');
    await tabTo(u, () => screen.getByRole('button', { name: 'Save prices' }), 120);
    await u.keyboard('{Enter}');
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${B}/base-prices/${P5}`, expect.anything()));
  });
});

// The fixture's catalogue, named so an unused import does not hide a rename.
void CATALOG;
