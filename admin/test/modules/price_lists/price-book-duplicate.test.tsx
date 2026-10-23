import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PriceBook } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BOOKS, CATALOG, IDS, PLATFORM_ADMIN, PRICING_READER } from '../../helpers/price-book-fixtures';

/**
 * Duplicating a book (feature 161, T076; US4; FR-022): a dialog pre-filled
 * from the source — "… (copy)", its channels, currency and audience,
 * multiplier 1 — that flags the channels a changed currency leaves behind
 * before anything is sent, says percentages are copied unchanged, and opens
 * the draft copy; the source is never written.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen, currentLocation, apiError } = await import('../../helpers/price-book-screen');

const B = '/api/v1/admin/price-books';
const CH_EU = { id: '00000000-0000-4000-8000-000000161c02', code: 'b2b_eu', name: { 'en-US': 'B2B EU' }, currencies: ['EUR'], defaultCurrency: 'EUR' };
const COPY = '00000000-0000-4000-8000-000000161d0c';

let book: PriceBook;

beforeEach(() => {
  book = BOOKS.L4;
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    const [path, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    if (path === `${B}/${book.id}`) return { data: book };
    if (path === `${B}/${COPY}`) return { data: { ...book, id: COPY, name: 'Beta contract', status: 'draft', everActivated: false } };
    if (path === `${B}/targets/sales-channels`) return { data: { items: [CATALOG.channel, CH_EU] } };
    if (path === `${B}/targets/currencies`) return { data: { items: [{ code: 'EUR', exposedByChannels: ['b2b_eu'] }, { code: 'PLN', exposedByChannels: ['b2b_pl'] }] } };
    if (path === `${B}/targets/customer-groups`) return { data: { items: CATALOG.customerGroups } };
    if (path === `${B}/targets/organizations`) {
      const ids = params.get('ids')?.split(',');
      const search = (params.get('search') ?? '').toLowerCase();
      return { data: { items: CATALOG.organizations.filter((o) => (ids ? ids.includes(o.id) : o.name.toLowerCase().includes(search))) } };
    }
    if (path === B) return { data: [], meta: { page: 1, pageSize: 1, totalCount: 0, creatableAudienceKinds: ['everyone', 'customer_groups', 'organizations'] } };
    if (path?.endsWith('/lines')) return { data: [], meta: { page: 1, pageSize: 50, totalLines: 0 } };
    throw new Error(`unexpected GET ${url}`);
  });
  api.post.mockResolvedValue({ data: { ...book, id: COPY, name: 'Beta contract', status: 'draft', everActivated: false } });
});

async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  mountScreen({ path: `/price-lists/${book.id}`, session: PLATFORM_ADMIN });
  await screen.findByRole('heading', { level: 1, name: book.name });
  await user.click(screen.getByRole('button', { name: 'Duplicate' }));
  return screen.findByRole('dialog', { name: 'Duplicate price book' });
}

describe('duplicate a price book', () => {
  it('pre-fills the dialog from the source', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Acme contract (copy)');
    expect(within(dialog).getByLabelText('Currency')).toHaveValue('PLN');
    expect(within(dialog).getByRole('checkbox', { name: 'B2B PL' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Organizations/ })).toBeChecked();
    expect(await within(dialog).findByText('Acme B2B (demo)')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Multiply fixed prices by')).toHaveValue('1');
    expect(within(dialog).getByText('Fixed prices and amount adjustments are multiplied; percentages are copied unchanged.')).toBeInTheDocument();
  });

  it('flags the channels a changed currency leaves behind, before anything is sent', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.selectOptions(within(dialog).getByLabelText('Currency'), 'EUR');
    expect(within(dialog).getByText('B2B PL does not sell in EUR. Untick it or choose another currency.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    expect(api.post).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('checkbox', { name: 'B2B PL' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'B2B EU' }));
    expect(within(dialog).queryByText(/does not sell in EUR/)).toBeNull();
  });

  it('sends the copy with Beta instead of Acme, EUR and 0,23, opens the draft, and leaves the source alone', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    const name = within(dialog).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Beta contract');
    await user.selectOptions(within(dialog).getByLabelText('Currency'), 'EUR');
    await user.click(within(dialog).getByRole('checkbox', { name: 'B2B PL' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'B2B EU' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Remove Acme B2B (demo)' }));
    await user.type(within(dialog).getByRole('combobox', { name: 'Add an organization' }), 'Beta');
    await user.click(await screen.findByRole('option', { name: /Beta/ }));
    const multiplier = within(dialog).getByLabelText('Multiply fixed prices by');
    await user.clear(multiplier);
    await user.type(multiplier, '0,23');
    await user.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(`${B}/${book.id}/duplicate`, {
      name: 'Beta contract',
      channelIds: [CH_EU.id],
      currencyCode: 'EUR',
      audience: { kind: 'organizations', memberIds: [IDS.orgs.Beta] },
      amountMultiplier: '0.23',
    });
    await waitFor(() => expect(currentLocation()).toBe(`/price-lists/${COPY}`));
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('refuses a multiplier that is not a positive number, and shows a server refusal', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    const multiplier = within(dialog).getByLabelText('Multiply fixed prices by');
    await user.clear(multiplier);
    await user.type(multiplier, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    expect(multiplier).toHaveAttribute('aria-invalid', 'true');
    expect(api.post).not.toHaveBeenCalled();
    await user.clear(multiplier);
    await user.type(multiplier, '2');
    api.post.mockRejectedValueOnce(await apiError(400, 'PRICE_BOOK_AUDIENCE_KIND', 'Every member must exist.'));
    await user.click(within(dialog).getByRole('button', { name: 'Duplicate' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Every member must exist.');
  });

  it('has no axe violations', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await within(dialog).findByText('Acme B2B (demo)');
    await expectNoAxeViolations(dialog);
  });

  it('is not offered to a reader', async () => {
    mountScreen({ path: `/price-lists/${book.id}`, session: PRICING_READER });
    await screen.findByRole('heading', { level: 1, name: book.name });
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull();
  });

  it('is not offered on a base book', async () => {
    book = BOOKS.base;
    mountScreen({ path: `/price-lists/${book.id}`, session: PLATFORM_ADMIN });
    await screen.findByRole('heading', { level: 1, name: book.name });
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull();
  });
});
