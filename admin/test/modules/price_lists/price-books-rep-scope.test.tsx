import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { priceBookSchema, type PriceBook } from '@endora-commerce/contracts';
import { asSeenByAcmeRep, BOOKS, CATALOG, IDS, SALES_REP_ACME, summaryOf } from '../../helpers/price-book-fixtures';

/**
 * A sales representative scoped to {Acme} on every screen of the editor
 * (feature 161, T087; US8; FR-027, FR-028, SC-006; vectors A3.1–A3.3 of
 * `specs/pricing/worked-examples.md` §10.11).
 *
 * All visibility is the server's (P1): a book naming an organization outside
 * the scope never arrives, its address answers `404` exactly as an unknown id
 * does, and the targets offer only the organizations in scope. Writability is
 * the server's `writable` (G11) and `creatableAudienceKinds`; what the screens
 * owe is to render **no** control the representative may not use — absent,
 * not disabled — and to add nothing that names what the server withheld.
 *
 * The server here answers as P1 answers this representative.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen, mountBasePricePanel, apiError } = await import('../../helpers/price-book-screen');
const { P5, basePrices } = await import('./base-price-fixture');

const B = '/api/v1/admin/price-books';

/** A3.2 — a book of Acme **and Beta**: outside the representative's scope. */
const ACME_AND_BETA: PriceBook = priceBookSchema.parse({
  ...BOOKS.L4,
  id: '00000000-0000-4000-8000-000000161da2',
  name: 'Acme and Beta joint terms',
  audience: { kind: 'organizations', memberIds: [IDS.orgs.Acme, IDS.orgs.Beta] },
});
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000404ff';

/** What the representative may read, each as P1 marks it for them. */
const VISIBLE: readonly PriceBook[] = [BOOKS.base, BOOKS.L1, BOOKS.L2, BOOKS.L3, BOOKS.L4].map(asSeenByAcmeRep);
const IN_SCOPE = CATALOG.organizations.filter((o) => o.id === IDS.orgs.Acme);

function lines(book: PriceBook): unknown {
  return { data: [], meta: { page: 1, pageSize: 50, totalCount: 0, totalRows: book.rowCount } };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    const [path, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    if (path === B) {
      return {
        data: VISIBLE.map(summaryOf),
        meta: { page: 1, pageSize: 20, totalCount: VISIBLE.length, creatableAudienceKinds: ['organizations'] },
      };
    }
    if (path === `${B}/targets/currencies`) return { data: { items: [{ code: 'PLN', exposedByChannels: ['b2b_pl'] }] } };
    if (path === `${B}/targets/sales-channels`) return { data: { items: [CATALOG.channel] } };
    if (path === `${B}/targets/customer-groups`) return { data: { items: CATALOG.customerGroups } };
    if (path === `${B}/targets/organizations`) {
      const ids = params.get('ids')?.split(',');
      const search = (params.get('search') ?? '').toLowerCase();
      return { data: { items: IN_SCOPE.filter((o) => (ids ? ids.includes(o.id) : o.name.toLowerCase().includes(search))) } };
    }
    if (path === `${B}/targets/categories`) return { data: { items: CATALOG.categories } };
    if (path === `${B}/targets/attributes`) return { data: { items: CATALOG.attributes } };
    if (path === `${B}/base-prices`) return { data: basePrices({ writable: false }) };
    if (path === `/api/v1/admin/catalog/products/${P5}/variants`) return { data: [] };
    for (const book of VISIBLE) {
      if (path === `${B}/${book.id}`) return { data: book };
      if (path === `${B}/${book.id}/lines`) return lines(book);
    }
    // A3.2 and an unknown id: one answer, the same answer.
    if (path === `${B}/${ACME_AND_BETA.id}` || path === `${B}/${UNKNOWN_ID}` || path?.startsWith(`${B}/${ACME_AND_BETA.id}/`)) {
      throw await apiError(404, 'NOT_FOUND', 'Price book not found.');
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

/** Every control that would change a book, by its accessible name. */
const EDIT_CONTROLS = [
  /^Save changes$/,
  /^Save prices$/,
  /^Activate$/,
  /^Move to draft$/,
  /^Delete/,
  /^Duplicate$/,
  /^Add lines$/,
  /^Change selected/,
  /^Import/,
  /^Discard changes$/,
];

function expectNoEditControl(): void {
  for (const name of EDIT_CONTROLS) {
    expect(screen.queryAllByRole('button', { name }), String(name)).toEqual([]);
    expect(screen.queryAllByRole('menuitem', { name }), String(name)).toEqual([]);
  }
}

describe('a representative scoped to Acme — the list (A3.2, FR-027)', () => {
  it('lists the books in scope and never the book of Acme and Beta', async () => {
    mountScreen({ path: '/price-lists', session: SALES_REP_ACME });
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: 'Acme contract' })).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'VIP prices' })).toBeInTheDocument();
    expect(screen.queryByText('Acme and Beta joint terms')).toBeNull();
  });

  it('offers row actions only on the Acme books, and New price book because organizations may be created', async () => {
    mountScreen({ path: '/price-lists', session: SALES_REP_ACME });
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('button', { name: 'Actions for Acme contract' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Actions for Acme screws' })).toBeInTheDocument();
    for (const name of ['VIP prices', 'Screws red for everyone', 'Base prices PLN']) {
      expect(within(table).queryByRole('button', { name: `Actions for ${name}` }), name).toBeNull();
    }
    expect(screen.getByRole('link', { name: 'New price book' })).toHaveAttribute('href', '/price-lists/new');
  });

  it('offers only organizations in scope to the member filter', async () => {
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists?audienceKind=organizations', session: SALES_REP_ACME });
    await screen.findByRole('table');
    await user.click(await screen.findByRole('combobox', { name: 'Member' }));
    const options = await within(await screen.findByRole('listbox')).findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('Acme B2B (demo)')]);
  });

  it('does not name an organization outside the scope a filter address carries', async () => {
    mountScreen({ path: `/price-lists?audienceKind=organizations&memberId=${IDS.orgs.Beta}`, session: SALES_REP_ACME });
    await screen.findByRole('table');
    expect(await screen.findByText('Not available to you')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).toBeNull();
  });
});

describe('a representative scoped to Acme — a book (A3.1–A3.3, SC-006)', () => {
  it('A3.1 — edits an organization book of Acme', async () => {
    mountScreen({ path: `/price-lists/${IDS.books.L4}`, session: SALES_REP_ACME });
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme contract' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete price book' })).toBeInTheDocument();
    expect(screen.queryByText('You can view this book but not change it.')).toBeNull();
  });

  it('A3.2 — the address of the book of Acme and Beta shows the same page as an unknown id', async () => {
    const hidden = mountScreen({ path: `/price-lists/${ACME_AND_BETA.id}`, session: SALES_REP_ACME });
    await screen.findByRole('heading', { name: 'Price book not found' });
    const hiddenPage = hidden.container.innerHTML.replaceAll(ACME_AND_BETA.id, 'ID');
    hidden.unmount();
    const unknown = mountScreen({ path: `/price-lists/${UNKNOWN_ID}`, session: SALES_REP_ACME });
    await screen.findByRole('heading', { name: 'Price book not found' });
    expect(unknown.container.innerHTML.replaceAll(UNKNOWN_ID, 'ID')).toBe(hiddenPage);
    expect(screen.queryByText(/Acme and Beta/)).toBeNull();
  });

  it('A3.2 — its prices address answers the same way', async () => {
    mountScreen({ path: `/price-lists/${ACME_AND_BETA.id}?tab=prices`, session: SALES_REP_ACME });
    expect(await screen.findByRole('heading', { name: 'Price book not found' })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('A3.3 — opens the VIP group book read-only, every edit control absent, and says why', async () => {
    mountScreen({ path: `/price-lists/${IDS.books.L3}`, session: SALES_REP_ACME });
    expect(await screen.findByRole('heading', { level: 1, name: 'VIP prices' })).toBeInTheDocument();
    expect(screen.getByText('You can view this book but not change it.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expectNoEditControl();
    // The reads stay.
    expect(screen.getByRole('link', { name: 'Explain a price' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View history' })).toBeInTheDocument();
  });

  it('A3.3 — its prices tab has no edit control either', async () => {
    mountScreen({ path: `/price-lists/${IDS.books.L3}?tab=prices`, session: SALES_REP_ACME });
    await screen.findByRole('heading', { level: 1, name: 'VIP prices' });
    expect(await screen.findByText('You can view these prices but not change them.')).toBeInTheDocument();
    expectNoEditControl();
  });

  it('opens an everyone book and the base book read-only too', async () => {
    for (const book of [BOOKS.L1, BOOKS.base]) {
      const mounted = mountScreen({ path: `/price-lists/${book.id}`, session: SALES_REP_ACME });
      expect(await screen.findByRole('heading', { level: 1, name: book.name })).toBeInTheDocument();
      expectNoEditControl();
      mounted.unmount();
    }
  });
});

describe('a representative scoped to Acme — create, explain, base prices (FR-027, FR-028)', () => {
  it('creates only organization books, for organizations in scope', async () => {
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists/new', session: SALES_REP_ACME });
    await screen.findByRole('heading', { name: 'Step 1 of 5: Name and type' });
    await user.type(screen.getByLabelText('Name'), 'Acme spring terms');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Step 2 of 5: Currency' });
    await user.click(screen.getByRole('radio', { name: /^PLN/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Step 3 of 5: Sales channels' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Step 4 of 5: Audience' });
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([expect.stringContaining('Organizations')]);
    await user.click(screen.getByRole('combobox', { name: 'Add an organization' }));
    const options = await within(await screen.findByRole('listbox')).findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('Acme B2B (demo)')]);
  });

  it('offers only organizations in scope to the explainer', async () => {
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists/explain', session: SALES_REP_ACME });
    await user.click(await screen.findByRole('radio', { name: 'Organization' }));
    await user.click(screen.getByRole('combobox', { name: 'Organization' }));
    const options = await within(await screen.findByRole('listbox')).findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('Acme B2B (demo)')]);
  });

  it('does not name an organization outside the scope the explainer address carries, nor read a hidden book', async () => {
    mountScreen({
      path: `/price-lists/explain?organizationId=${IDS.orgs.Beta}&bookId=${ACME_AND_BETA.id}`,
      session: SALES_REP_ACME,
    });
    expect(await screen.findByText('Not available to you')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).toBeNull();
    expect(screen.queryByText(/Acme and Beta/)).toBeNull();
  });

  it('shows the product’s base prices read-only', async () => {
    mountBasePricePanel({ productId: P5, session: SALES_REP_ACME });
    const pln = await screen.findByRole('group', { name: 'PLN' });
    expect(within(pln).getByText('From 1: 80.00')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save prices' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add tier/ })).toBeNull();
    await waitFor(() => expect(api.put).not.toHaveBeenCalled());
  });
});
