import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../helpers/axe';
import { PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';

/**
 * The product's base-price panel (feature 161, T070; US3 scenarios 1–4;
 * FR-019, FR-020, FR-030): one line per currency, tiers, each variant
 * inheriting or priced its own way with a labelled preview rounded as the
 * server rounds, the not-orderable notice, read-only when not writable, and
 * errors on their fields.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountBasePricePanel } = await import('../../helpers/price-book-screen');
const { P5, basePrices, serveBasePrices } = await import('./base-price-fixture');

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  serveBasePrices(api, basePrices());
});

async function open(language: 'en' | 'pl' = 'en') {
  const mounted = mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN, language });
  await screen.findByRole('group', { name: 'PLN' });
  return mounted;
}

const pln = (): HTMLElement => screen.getByRole('group', { name: 'PLN' });
const eur = (): HTMLElement => screen.getByRole('group', { name: 'EUR' });

describe('base-price panel — what it shows', () => {
  it('has one line per currency a channel offers, with the stored tiers, and an empty one where none', async () => {
    await open();
    expect(eur()).toBeInTheDocument();
    expect(within(pln()).getByLabelText('Price from 1, PLN')).toHaveValue('80.00');
    expect(within(eur()).getByLabelText('Price from 1, EUR')).toHaveValue('');
    expect(within(eur()).getByText('No base price in EUR: buyers paying in EUR cannot order this product.')).toBeInTheDocument();
  });

  it('shows each variant inheriting or priced its own way, with a labelled preview', async () => {
    await open();
    const p5r = within(pln()).getByRole('group', { name: 'Variant P5R' });
    expect(within(p5r).getByLabelText('How P5R is priced')).toHaveValue('percent');
    expect(within(p5r).getByLabelText('Percentage for P5R')).toHaveValue('+10%');
    // 80 × 1.10, as the server computes it (G17).
    expect(within(p5r).getByText('Preview: 88.00')).toBeInTheDocument();
    const p5b = within(pln()).getByRole('group', { name: 'Variant P5B' });
    expect(within(p5b).getByLabelText('How P5B is priced')).toHaveValue('inherit');
    expect(within(p5b).getByText('Inherits 80.00')).toBeInTheDocument();
  });

  it('updates the preview as a variant’s adjustment is typed', async () => {
    const user = userEvent.setup();
    await open();
    const p5b = within(pln()).getByRole('group', { name: 'Variant P5B' });
    await user.selectOptions(within(p5b).getByLabelText('How P5B is priced'), 'amount');
    await user.type(within(p5b).getByLabelText('Amount for P5B'), '-7,5');
    expect(within(p5b).getByText('Preview: 72.50')).toBeInTheDocument();
  });

  it('says the product cannot be ordered when no currency has a base price', async () => {
    serveBasePrices(api, basePrices({ byCurrency: {} }));
    await open();
    expect(screen.getByText('This product has no base price, so it cannot be ordered.')).toBeInTheDocument();
  });

  it('shows the prices without a control when the caller may not write them', async () => {
    serveBasePrices(api, basePrices({ writable: false }));
    await open();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save prices' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add tier/ })).toBeNull();
    expect(within(pln()).getByText('From 1: 80.00')).toBeInTheDocument();
    expect(screen.getByText('You can view the base prices but not change them.')).toBeInTheDocument();
  });

  it('marks a refused value on its field and sends nothing', async () => {
    const user = userEvent.setup();
    await open();
    const price = within(pln()).getByLabelText('Price from 1, PLN');
    await user.clear(price);
    await user.type(price, '-5%');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    expect(price).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(price.getAttribute('aria-describedby')!.split(' ').at(-1)!)).toHaveTextContent('A base price is a fixed amount');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('adds and removes tiers, and refuses a tier that does not start above the one before', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(within(pln()).getByRole('button', { name: 'Add tier in PLN' }));
    const from = within(pln()).getByLabelText('Start of tier 2, PLN');
    await user.type(from, '1');
    await user.type(within(pln()).getByLabelText('Price of tier 2, PLN'), '70');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    expect(from).toHaveAttribute('aria-invalid', 'true');
    expect(within(pln()).getByText('Each tier starts above the one before it.')).toBeInTheDocument();
    await user.click(within(pln()).getByRole('button', { name: 'Remove tier 2, PLN' }));
    await waitFor(() => expect(within(pln()).queryByLabelText('Start of tier 2, PLN')).toBeNull());
  });

  it('has no axe violations, and speaks Polish', async () => {
    const { container, unmount } = await open();
    await expectNoAxeViolations(container);
    unmount();
    await open('pl');
    expect(screen.getByRole('button', { name: 'Zapisz ceny' })).toBeInTheDocument();
    expect(within(pln()).getByLabelText('Cena od 1, PLN')).toHaveValue('80,00');
  });
});
