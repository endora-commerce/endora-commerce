import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PriceBook } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BOOKS, CATALOG, IDS, PLATFORM_ADMIN, PRICING_READER } from '../../helpers/price-book-fixtures';

/**
 * The book's header (feature 161, T052; US1 scenarios 3–6; FR-003, FR-004,
 * FR-005): currency and — once active — audience kind read-only, dormant
 * bindings in words, member names, a save against the version it started
 * from, a refused activation mapped to the field that fixes it, a delete that
 * names the book and its rows, and the history link (G13).
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: api };
});

const { mountScreen, currentLocation, primaryActions, apiError } = await import('../../helpers/price-book-screen');

const B = '/api/v1/admin/price-books';
const CH_EU = { id: '00000000-0000-4000-8000-000000161c02', code: 'b2b_eu', name: { 'en-US': 'B2B EU' }, currencies: ['EUR'], defaultCurrency: 'EUR' };

let book: PriceBook = BOOKS.L2;

function route(url: string): unknown {
  const [path, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  if (path === `${B}/${book.id}`) return { data: book };
  if (path === `${B}/targets/sales-channels`) return { data: { items: [CATALOG.channel, CH_EU] } };
  if (path === `${B}/targets/customer-groups`) return { data: { items: CATALOG.customerGroups } };
  if (path === `${B}/targets/organizations`) {
    const ids = params.get('ids')?.split(',');
    const search = (params.get('search') ?? '').toLowerCase();
    return { data: { items: CATALOG.organizations.filter((o) => (ids ? ids.includes(o.id) : o.name.toLowerCase().includes(search))) } };
  }
  throw new Error(`unexpected GET ${url}`);
}

beforeEach(() => {
  book = BOOKS.L2;
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith(`${B}/00000000-0000-4000-8000-0000000404ff`)) throw await apiError(404, 'NOT_FOUND', 'Price book not found.');
    return route(url);
  });
});

const open = async (session = PLATFORM_ADMIN, language: 'en' | 'pl' = 'en') => {
  const mounted = mountScreen({ path: `/price-lists/${book.id}`, session, language });
  await screen.findByRole('heading', { level: 1, name: book.name });
  return mounted;
};

describe('book header — what can and cannot change', () => {
  it('shows the currency and, once active, the audience kind without letting them change', async () => {
    await open();
    expect(screen.getByText('The currency never changes. Duplicate the book to price in another currency.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Currency' })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Everyone/ })).toBeNull();
    expect(screen.getByText('Fixed once the book has been active.')).toBeInTheDocument();
  });

  it('lets a never-activated draft change its audience kind', async () => {
    book = { ...BOOKS.L3, status: 'draft', everActivated: false };
    await open();
    expect(screen.getByRole('radio', { name: /Customer groups/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Organizations/ })).toBeInTheDocument();
  });

  it('names the members and says which channel binding is dormant, and why', async () => {
    book = { ...BOOKS.L2, channels: [{ channelId: IDS.channel, dormant: false }, { channelId: CH_EU.id, dormant: true }] };
    await open();
    expect(await screen.findByText('Acme B2B (demo)')).toBeInTheDocument();
    const channels = screen.getByRole('group', { name: 'Sales channels' });
    expect(within(channels).getByRole('checkbox', { name: /B2B EU/ })).toBeChecked();
    expect(within(channels).getByText('Inactive — the channel no longer offers PLN')).toBeInTheDocument();
  });

  it('links the book’s history to the audit log filtered to it', async () => {
    await open();
    expect(screen.getByRole('link', { name: 'View history' })).toHaveAttribute(
      'href',
      `/audit-log?objectType=price_list&objectId=${book.id}`,
    );
  });
});

describe('book header — saving', () => {
  it('saves only what changed, against the version it was opened at', async () => {
    const user = userEvent.setup();
    api.patch.mockResolvedValue({ data: { ...book, name: 'Acme screws 2027', version: 2 } });
    const { container } = await open();
    expect(primaryActions(container).map((e) => e.textContent)).toEqual(['Save changes']);
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Acme screws 2027');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`${B}/${book.id}`, { name: 'Acme screws 2027', expectedVersion: 1 }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
  });

  it('keeps the edits when the book changed meanwhile, and offers to reload', async () => {
    const user = userEvent.setup();
    api.patch.mockRejectedValue(await apiError(409, 'PRICE_BOOK_STALE', 'This price book changed since you opened it.'));
    await open();
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Mine');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This price book changed since you opened it.');
    expect(screen.getByLabelText('Name')).toHaveValue('Mine');
    book = { ...BOOKS.L2, name: 'Theirs', version: 2 };
    api.get.mockClear();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await screen.findByRole('heading', { level: 1, name: 'Theirs' });
    expect(api.get).toHaveBeenCalledWith(`${B}/${book.id}`);
  });
});

describe('book header — activation, draft and delete', () => {
  it('names what an activation is missing and takes the operator to the field that fixes it', async () => {
    const user = userEvent.setup();
    book = { ...BOOKS.L3, status: 'draft', everActivated: false, channels: [], audience: { kind: 'customer_groups', memberIds: [] } };
    api.post.mockRejectedValue(
      await apiError(409, 'PRICE_BOOK_NOT_APPLICABLE', 'The price book cannot be activated.', [
        { path: 'channelIds', issue: 'no channel' },
        { path: 'audience.memberIds', issue: 'no member' },
      ]),
    );
    await open();
    await user.click(screen.getByRole('button', { name: 'Activate' }));
    expect(api.post).toHaveBeenCalledWith(`${B}/${book.id}/activate`, undefined);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('It is bound to no sales channel that offers PLN, so it would apply nowhere.');
    expect(alert).toHaveTextContent('It has no audience member, so it would apply to no one.');
    await user.click(within(alert).getByRole('button', { name: 'Add a sales channel' }));
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Sales channels' }));
    await user.click(within(alert).getByRole('button', { name: 'Add a member' }));
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'Who the prices are for' }));
  });

  it('activates a draft and moves an active book back to draft', async () => {
    const user = userEvent.setup();
    book = { ...BOOKS.L2, status: 'draft' };
    api.post.mockImplementation(async (url: string) => ({
      data: { ...book, status: url.endsWith('/activate') ? 'active' : 'draft', version: book.version + 1 },
    }));
    await open();
    await user.click(screen.getByRole('button', { name: 'Activate' }));
    expect(await screen.findByRole('button', { name: 'Move to draft' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move to draft' }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith(`${B}/${book.id}/draftify`, undefined));
  });

  it('asks before deleting, naming the book and its row count, then returns to the list', async () => {
    const user = userEvent.setup();
    api.delete.mockResolvedValue(undefined);
    await open();
    await user.click(screen.getByRole('button', { name: 'Delete price book' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete price book?' });
    expect(dialog).toHaveTextContent('“Acme screws” and its 2 price rows will be deleted.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete price book' }));
    expect(api.delete).toHaveBeenCalledWith(`${B}/${book.id}`);
    await waitFor(() => expect(currentLocation()).toBe('/price-lists'));
  });

  it('offers a base book no rename, schedule, activation or delete', async () => {
    book = BOOKS.base;
    await open();
    expect(screen.getByText('Base prices apply to every buyer in PLN. They are always active and cannot be renamed, scheduled or deleted.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByLabelText('Starts')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete price book' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
  });

  it('offers a reader no control at all, and says so', async () => {
    book = { ...BOOKS.L2, writable: false };
    await open(PRICING_READER);
    expect(screen.getByText('You can view this book but not change it.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    for (const name of ['Save changes', 'Activate', 'Move to draft', 'Delete price book']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
});

describe('book header — not found, accessibility, Polish', () => {
  it('answers an unknown or hidden book with the not-found page', async () => {
    mountScreen({ path: '/price-lists/00000000-0000-4000-8000-0000000404ff', session: PLATFORM_ADMIN });
    expect(await screen.findByRole('heading', { name: 'Price book not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to price books' })).toHaveAttribute('href', '/price-lists');
  });

  it('has no axe violations', async () => {
    const { container } = await open();
    await screen.findByText('Acme B2B (demo)');
    await expectNoAxeViolations(container);
  });

  it('speaks Polish', async () => {
    await open(PLATFORM_ADMIN, 'pl');
    expect(screen.getByRole('button', { name: 'Zapisz zmiany' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zobacz historię' })).toBeInTheDocument();
  });
});
