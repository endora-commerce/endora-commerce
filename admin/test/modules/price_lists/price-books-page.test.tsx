import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PriceBookSummary } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BOOKS, CATALOG, IDS, PLATFORM_ADMIN, PRICING_READER, summaryOf } from '../../helpers/price-book-fixtures';

/**
 * The price-book list (feature 161, T050; US1 scenarios 1, 5 and 6; FR-001,
 * FR-005, FR-032, FR-034 with OQ-2 = B: the filters live in the URL).
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: api };
});

const { mountScreen, currentParams, primaryActions, apiError } = await import('../../helpers/price-book-screen');

const B = '/api/v1/admin/price-books';

const NOWHERE: PriceBookSummary = {
  ...summaryOf(BOOKS.L3),
  id: '00000000-0000-4000-8000-000000161d09',
  name: 'Gold draft',
  status: 'draft',
  channelCount: 0,
  memberCount: 0,
  appliesNowhere: true,
  appliesToNoOne: true,
};

const ALL: PriceBookSummary[] = [summaryOf(BOOKS.base), summaryOf(BOOKS.L1), summaryOf(BOOKS.L2), summaryOf(BOOKS.L4), NOWHERE];

let books: PriceBookSummary[] = ALL;
let failList = false;

function listAnswer(): unknown {
  return {
    data: books,
    meta: { page: 1, pageSize: 20, totalCount: books.length, creatableAudienceKinds: ['everyone', 'customer_groups', 'organizations'] },
  };
}

function route(url: string): unknown {
  const [path] = url.split('?');
  if (path === B) {
    if (failList) throw new Error('unreachable');
    return listAnswer();
  }
  if (path === `${B}/targets/currencies`) return { data: { items: [{ code: 'EUR', exposedByChannels: ['b2b_eu'] }, { code: 'PLN', exposedByChannels: ['b2b_pl'] }] } };
  if (path === `${B}/targets/sales-channels`) return { data: { items: [CATALOG.channel] } };
  if (path === `${B}/targets/customer-groups`) return { data: { items: CATALOG.customerGroups } };
  if (path === `${B}/targets/organizations`) {
    const params = new URLSearchParams(url.split('?')[1] ?? '');
    const ids = params.get('ids')?.split(',') ?? null;
    const search = (params.get('search') ?? '').toLowerCase();
    const items = CATALOG.organizations.filter((o) => (ids ? ids.includes(o.id) : o.name.toLowerCase().includes(search)));
    return { data: { items } };
  }
  throw new Error(`unexpected GET ${url}`);
}

/** The list requests made, as query parameters. */
const listRequests = (): URLSearchParams[] =>
  api.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.split('?')[0] === B)
    .map((url) => new URLSearchParams(url.split('?')[1] ?? ''));

beforeEach(() => {
  books = ALL;
  failList = false;
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (failList && url.split('?')[0] === B) {
      throw await apiError(500, 'INTERNAL', 'boom');
    }
    return route(url);
  });
});

const table = async (): Promise<HTMLElement> => screen.findByRole('table');
const rowOf = async (name: RegExp | string): Promise<HTMLElement> =>
  (await within(await table()).findByRole('link', { name })).closest('tr')!;

describe('price-book list — columns and base books', () => {
  it('lists every book with its type, status, currency, channels, audience, priority, rows and flags', async () => {
    mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN });
    const acme = await rowOf('Acme screws');
    expect(within(acme).getByText('Regular prices')).toBeInTheDocument();
    expect(within(acme).getByText('Active')).toBeInTheDocument();
    expect(within(acme).getByText('PLN')).toBeInTheDocument();
    expect(within(acme).getByText('Organizations · 1')).toBeInTheDocument();
    expect(within(acme).getByRole('link', { name: 'Acme screws' })).toHaveAttribute('href', `/price-lists/${IDS.books.L2}`);
    const draft = await rowOf('Gold draft');
    expect(within(draft).getByText('Applies nowhere')).toBeInTheDocument();
    expect(within(draft).getByText('Applies to no one')).toBeInTheDocument();
    expect(within(draft).getByText('Draft')).toBeInTheDocument();
    const headers = within(await table()).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Name', 'Type', 'Status', 'Currency', 'Channels', 'Audience', 'Priority', 'Price rows']));
  });

  it('marks the base book once per currency and offers it no delete', async () => {
    mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN });
    const base = await rowOf('Base prices PLN');
    expect(within(base).getByText('Base prices — PLN')).toBeInTheDocument();
    expect(within(base).queryByRole('button', { name: /Actions for/ })).toBeNull();
    const acme = await rowOf('Acme screws');
    await userEvent.setup().click(within(acme).getByRole('button', { name: 'Actions for Acme screws' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('asks before deleting, naming the book and its row count, then removes it', async () => {
    const user = userEvent.setup();
    api.delete.mockResolvedValue(undefined);
    mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN });
    await user.click(within(await rowOf('Acme screws')).getByRole('button', { name: 'Actions for Acme screws' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete price book?' });
    expect(dialog).toHaveTextContent('“Acme screws” and its 2 price rows will be deleted.');
    books = ALL.filter((b) => b.id !== IDS.books.L2);
    await user.click(within(dialog).getByRole('button', { name: 'Delete price book' }));
    expect(api.delete).toHaveBeenCalledWith(`${B}/${IDS.books.L2}`);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Acme screws' })).toBeNull());
  });

  it('offers a reader neither the create action nor a delete', async () => {
    mountScreen({ path: '/price-lists', session: PRICING_READER });
    await rowOf('Acme screws');
    expect(screen.queryByRole('link', { name: 'New price book' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  });

  it('offers nothing to change on a book the caller may not write', async () => {
    books = ALL.map((b) => ({ ...b, writable: b.id === IDS.books.L2 }));
    mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN });
    expect(within(await rowOf('Acme screws')).getByRole('button', { name: 'Actions for Acme screws' })).toBeInTheDocument();
    expect(within(await rowOf('Acme contract')).queryByRole('button', { name: /Actions for/ })).toBeNull();
  });
});

describe('price-book list — filters in the URL', () => {
  it('reads the filters from the address, asks the API with them and labels the member', async () => {
    mountScreen({
      path: `/price-lists?currency=PLN&audienceKind=organizations&memberId=${IDS.orgs.Acme}`,
      session: PLATFORM_ADMIN,
    });
    await table();
    const asked = listRequests().at(-1)!;
    expect(asked.get('currency')).toBe('PLN');
    expect(asked.get('audienceKind')).toBe('organizations');
    expect(asked.get('memberId')).toBe(IDS.orgs.Acme);
    // G12: the member chip is the organization's name, not its id.
    expect(await screen.findByText('Acme B2B (demo)')).toBeInTheDocument();
  });

  it('writes a changed filter to the address and asks again', async () => {
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN });
    await table();
    await user.selectOptions(screen.getByLabelText('Type'), 'sale');
    await waitFor(() => expect(currentParams().get('type')).toBe('sale'));
    await waitFor(() => expect(listRequests().at(-1)!.getAll('type')).toEqual(['sale']));
    await user.selectOptions(screen.getByLabelText('Status'), 'draft');
    await waitFor(() => expect(currentParams().get('status')).toBe('draft'));
    await user.selectOptions(screen.getByLabelText('Audience'), 'customer_groups');
    await user.selectOptions(await screen.findByLabelText('Member'), IDS.group.VIP);
    await waitFor(() => expect(currentParams().get('memberId')).toBe(IDS.group.VIP));
    await user.selectOptions(screen.getByLabelText('Currency'), 'EUR');
    await user.selectOptions(screen.getByLabelText('Sales channel'), IDS.channel);
    await waitFor(() => expect(currentParams().get('channelId')).toBe(IDS.channel));
    expect(listRequests().at(-1)!.get('currency')).toBe('EUR');
  });

  it('searches by name from the address and clears every filter at once', async () => {
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists?status=active', session: PLATFORM_ADMIN });
    await table();
    await user.type(screen.getByRole('searchbox', { name: 'Search by name' }), 'acme');
    await waitFor(() => expect(currentParams().get('search')).toBe('acme'));
    await waitFor(() => expect(listRequests().at(-1)!.get('search')).toBe('acme'));
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect([...currentParams().keys()]).toEqual([]));
  });

  it('searches members through the scope-filtered targets', async () => {
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists?audienceKind=organizations', session: PLATFORM_ADMIN });
    await table();
    await user.type(await screen.findByRole('combobox', { name: 'Member' }), 'Beta');
    await waitFor(() =>
      expect(api.get.mock.calls.some(([url]) => (url as string).startsWith(`${B}/targets/organizations?search=Beta`))).toBe(true),
    );
    await user.click(await screen.findByRole('option', { name: /Beta/ }));
    await waitFor(() => expect(currentParams().get('memberId')).toBe(IDS.orgs.Beta));
    expect(api.get.mock.calls.some(([url]) => (url as string).startsWith(`${B}/targets/organizations?search=Beta`))).toBe(true);
  });
});

describe('price-book list — states', () => {
  it('shows a loading state with a polite status while the list is on its way', async () => {
    api.get.mockImplementation(async (url: string) => (url.split('?')[0] === B ? new Promise(() => undefined) : route(url)));
    mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN });
    expect(await screen.findByRole('status')).toHaveTextContent('Loading price books…');
    expect(screen.getByTestId('price-books-loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the empty state with one action to create the first book', async () => {
    books = [];
    const { container } = mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN });
    expect(await screen.findByText('No price books yet')).toBeInTheDocument();
    const create = screen.getAllByRole('link', { name: 'New price book' });
    expect(create[0]).toHaveAttribute('href', '/price-lists/new');
    expect(primaryActions(container)).toHaveLength(1);
  });

  it('says when the filters match nothing, and offers to clear them', async () => {
    books = [];
    mountScreen({ path: '/price-lists?currency=EUR', session: PLATFORM_ADMIN });
    expect(await screen.findByText('No price book matches these filters')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0);
  });

  it('says the list could not be loaded and tries again on request', async () => {
    failList = true;
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN });
    expect(await screen.findByText('The price books could not be loaded.')).toBeInTheDocument();
    failList = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await rowOf('Acme screws');
  });

  it('has one primary action and no axe violations', async () => {
    const { container } = mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN });
    await rowOf('Acme screws');
    expect(primaryActions(container).map((e) => e.textContent)).toEqual(['New price book']);
    await expectNoAxeViolations(container);
  });

  it('speaks Polish', async () => {
    mountScreen({ path: '/price-lists', session: PLATFORM_ADMIN, language: 'pl' });
    expect(await screen.findByRole('heading', { name: 'Cenniki' })).toBeInTheDocument();
    const base = (await within(await table()).findByRole('link', { name: 'Base prices PLN' })).closest('tr')!;
    expect(within(base).getByText('Ceny bazowe — PLN')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nowy cennik' })).toBeInTheDocument();
  });
});
