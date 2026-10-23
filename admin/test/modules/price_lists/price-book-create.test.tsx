import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BOOKS, CATALOG, IDS, PLATFORM_ADMIN, SALES_REP_ACME } from '../../helpers/price-book-fixtures';

/**
 * The create flow (feature 161, T051; US1 scenario 2; FR-002, FR-033): type →
 * currency → channels (only those offering the currency, and why the others
 * are missing) → audience (the kinds the caller may create, their pickers) →
 * schedule and priority; one draft created; one primary action per step.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: api };
});

const { mountScreen, currentLocation, primaryActions, apiError } = await import('../../helpers/price-book-screen');

const B = '/api/v1/admin/price-books';
const CH_EU = { id: '00000000-0000-4000-8000-000000161c02', code: 'b2b_eu', name: { 'en-US': 'B2B EU' }, currencies: ['EUR'], defaultCurrency: 'EUR' };
const CH_BOTH = { id: '00000000-0000-4000-8000-000000161c03', code: 'b2c', name: { 'en-US': 'B2C shop', 'pl-PL': 'Sklep B2C' }, currencies: ['PLN', 'EUR'], defaultCurrency: 'PLN' };
const CREATED = { ...BOOKS.L2, id: '00000000-0000-4000-8000-000000161d0a', status: 'draft' as const, everActivated: false, version: 1 };

let creatable: string[] = ['everyone', 'customer_groups', 'organizations'];

function route(url: string): unknown {
  const [path, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  if (path === B) {
    return { data: [], meta: { page: 1, pageSize: 1, totalCount: 0, creatableAudienceKinds: creatable } };
  }
  if (path === `${B}/targets/currencies`) {
    return { data: { items: [{ code: 'EUR', exposedByChannels: ['b2b_eu', 'b2c'] }, { code: 'PLN', exposedByChannels: ['b2b_pl', 'b2c'] }] } };
  }
  if (path === `${B}/targets/sales-channels`) return { data: { items: [CATALOG.channel, CH_EU, CH_BOTH] } };
  if (path === `${B}/targets/customer-groups`) return { data: { items: CATALOG.customerGroups } };
  if (path === `${B}/targets/organizations`) {
    const search = (params.get('search') ?? '').toLowerCase();
    const ids = params.get('ids')?.split(',');
    return { data: { items: CATALOG.organizations.filter((o) => (ids ? ids.includes(o.id) : o.name.toLowerCase().includes(search))) } };
  }
  throw new Error(`unexpected GET ${url}`);
}

beforeEach(() => {
  creatable = ['everyone', 'customer_groups', 'organizations'];
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => route(url));
  api.post.mockResolvedValue({ data: CREATED });
});

const step = (n: number, name: string) => screen.findByRole('heading', { name: `Step ${n} of 5: ${name}` });
const next = (): HTMLElement => screen.getByRole('button', { name: 'Next' });

async function throughCurrency(user: ReturnType<typeof userEvent.setup>, currency: 'EUR' | 'PLN'): Promise<void> {
  await step(1, 'Name and type');
  await user.type(screen.getByLabelText('Name'), 'Acme EUR terms');
  await user.click(next());
  await step(2, 'Currency');
  await user.click(screen.getByRole('radio', { name: new RegExp(`^${currency}`) }));
  await user.click(next());
  await step(3, 'Sales channels');
}

describe('create flow — order and steps', () => {
  it('asks for a name before it moves on, and keeps the type chosen', async () => {
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists/new', session: PLATFORM_ADMIN });
    await step(1, 'Name and type');
    expect(screen.getByRole('radio', { name: /Regular prices/ })).toBeChecked();
    await user.click(next());
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a name.')).toBeInTheDocument();
    await step(1, 'Name and type');
    await user.type(screen.getByLabelText('Name'), 'Winter sale');
    await user.click(screen.getByRole('radio', { name: /Sale prices/ }));
    await user.click(next());
    await step(2, 'Currency');
    await user.click(next());
    expect(screen.getByText('Choose a currency.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await step(1, 'Name and type');
    expect(screen.getByLabelText('Name')).toHaveValue('Winter sale');
    expect(screen.getByRole('radio', { name: /Sale prices/ })).toBeChecked();
  });

  it('offers only the channels that sell in the chosen currency, and says why the others are missing', async () => {
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists/new', session: PLATFORM_ADMIN });
    await throughCurrency(user, 'EUR');
    const channels = screen.getByRole('group', { name: 'Sales channels' });
    expect(within(channels).getAllByRole('checkbox').map((c) => c.closest('label')?.textContent)).toEqual(['B2B EU', 'B2C shop']);
    expect(screen.getByText('Not offered here, because they do not sell in EUR: B2B PL')).toBeInTheDocument();
  });

  it('creates a draft of an organizations book with the steps’ values, then opens it', async () => {
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists/new', session: PLATFORM_ADMIN });
    await throughCurrency(user, 'EUR');
    await user.click(screen.getByRole('checkbox', { name: 'B2B EU' }));
    await user.click(next());
    await step(4, 'Audience');
    await user.click(screen.getByRole('radio', { name: /Organizations/ }));
    await user.type(screen.getByRole('combobox', { name: 'Add an organization' }), 'Acme');
    await user.click(await screen.findByRole('option', { name: /Acme B2B \(demo\)/ }));
    expect(screen.getByRole('button', { name: 'Remove Acme B2B (demo)' })).toBeInTheDocument();
    await user.click(next());
    await step(5, 'Schedule and priority');
    const priority = screen.getByLabelText('Priority');
    await user.clear(priority);
    await user.type(priority, '5');
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-11-01T10:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-10-01T10:00' } });
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(screen.getByText('The end must be after the start.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-12-31T18:00' } });
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(B, {
      name: 'Acme EUR terms',
      type: 'regular',
      currencyCode: 'EUR',
      channelIds: [CH_EU.id],
      audience: { kind: 'organizations', memberIds: [IDS.orgs.Acme] },
      priority: 5,
      startsAt: new Date('2026-11-01T10:00').toISOString(),
      endsAt: new Date('2026-12-31T18:00').toISOString(),
    });
    await waitFor(() => expect(currentLocation()).toBe(`/price-lists/${CREATED.id}`));
  });

  it('picks customer groups for a group book and none for everyone', async () => {
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists/new', session: PLATFORM_ADMIN });
    await throughCurrency(user, 'PLN');
    await user.click(next());
    await step(4, 'Audience');
    expect(screen.getByRole('radio', { name: /Everyone/ })).toBeChecked();
    expect(screen.queryByRole('combobox')).toBeNull();
    await user.click(screen.getByRole('radio', { name: /Customer groups/ }));
    await user.click(screen.getByRole('combobox', { name: 'Add a customer group' }));
    await user.click(await screen.findByRole('option', { name: /VIP/ }));
    await user.click(next());
    await step(5, 'Schedule and priority');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0]![1]).toMatchObject({
      currencyCode: 'PLN',
      channelIds: [],
      audience: { kind: 'customer_groups', memberIds: [IDS.group.VIP] },
      priority: 0,
      startsAt: null,
      endsAt: null,
    });
  });

  it('offers a representative only the kinds they may create', async () => {
    creatable = ['organizations'];
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists/new', session: SALES_REP_ACME });
    await throughCurrency(user, 'PLN');
    await user.click(next());
    await step(4, 'Audience');
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
      expect.stringContaining('Organizations'),
    ]);
    expect(screen.getByRole('radio', { name: /Organizations/ })).toBeChecked();
  });

  it('returns to the step the server refuses, with its reason', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue(
      await apiError(400, 'PRICE_BOOK_CHANNEL_CURRENCY', 'A sales channel in this price book does not offer the book’s currency.', [
        { path: 'channelIds', issue: 'b2c does not offer EUR' },
      ]),
    );
    mountScreen({ path: '/price-lists/new', session: PLATFORM_ADMIN });
    await throughCurrency(user, 'EUR');
    await user.click(next());
    await user.click(next());
    await step(5, 'Schedule and priority');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await step(3, 'Sales channels');
    expect(screen.getByRole('alert')).toHaveTextContent('A sales channel in this price book does not offer the book’s currency.');
  });
});

describe('create flow — one primary action, accessibility, Polish', () => {
  it('has exactly one primary action on every step, and no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = mountScreen({ path: '/price-lists/new', session: PLATFORM_ADMIN });
    await step(1, 'Name and type');
    expect(primaryActions(container).map((e) => e.textContent)).toEqual(['Next']);
    await expectNoAxeViolations(container);
    await throughCurrency(user, 'EUR');
    expect(primaryActions(container).map((e) => e.textContent)).toEqual(['Next']);
    await expectNoAxeViolations(container);
    await user.click(next());
    await user.click(next());
    await step(5, 'Schedule and priority');
    expect(primaryActions(container).map((e) => e.textContent)).toEqual(['Create draft']);
    await expectNoAxeViolations(container);
  });

  it('speaks Polish', async () => {
    mountScreen({ path: '/price-lists/new', session: PLATFORM_ADMIN, language: 'pl' });
    expect(await screen.findByRole('heading', { name: 'Krok 1 z 5: Nazwa i typ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dalej' })).toBeInTheDocument();
  });
});
