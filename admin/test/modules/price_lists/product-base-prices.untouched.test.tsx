import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';

/**
 * The panel never rewrites a tier the operator did not edit (feature 161,
 * Checkpoint 6 review): a lowest tier from 10 is shown as stored — not as an
 * empty "from 1" line — with the notice that the product cannot be ordered
 * below it, and is sent back exactly; a variant's own quantity tiers are shown
 * read-only and sent back exactly; and a panel saved with no change sends
 * nothing. (That the server keeps such rows' ids and values is
 * `backend/test/contract/price_lists/base-prices-untouched-rows.test.ts`.)
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountBasePricePanel } = await import('../../helpers/price-book-screen');
const { P5, P5R, P5B, B, basePrices, serveBasePrices } = await import('./base-price-fixture');

const P5B_TIERS = [
  { minQuantity: 1, maxQuantity: 9, amount: '85.0000' },
  { minQuantity: 10, maxQuantity: null, amount: '75.0000' },
];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  serveBasePrices(
    api,
    basePrices({
      byCurrency: {
        PLN: {
          bookId: '00000000-0000-4000-8000-00000000d51b',
          product: [{ minQuantity: 10, maxQuantity: null, amount: '80.0000' }],
          variants: { [P5R]: { type: 'percent', percent: '10.00' }, [P5B]: { type: 'fixed', tiers: P5B_TIERS } },
        },
      },
    }),
  );
  api.put.mockImplementation(async () => ({ data: basePrices() }));
});

const pln = (): HTMLElement => screen.getByRole('group', { name: 'PLN' });

async function open(): Promise<void> {
  mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
  await screen.findByRole('group', { name: 'PLN' });
}

describe('base-price panel — tiers nobody edited', () => {
  it('shows a lowest tier from 10 as stored, and says the product cannot be ordered below it', async () => {
    await open();
    expect(within(pln()).getByLabelText('Price from 10, PLN')).toHaveValue('80.00');
    expect(within(pln()).queryByLabelText('Price from 1, PLN')).toBeNull();
    expect(within(pln()).getByText('Not orderable below 10 in PLN: there is no base price for smaller quantities.')).toBeInTheDocument();
  });

  it('sends the tier from 10 back exactly, and no tier from 1, when only a variant changes', async () => {
    const user = userEvent.setup();
    await open();
    const p5r = within(pln()).getByRole('group', { name: 'Variant P5R' });
    const value = within(p5r).getByLabelText('Percentage for P5R');
    await user.clear(value);
    await user.type(value, '12');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put.mock.calls[0]).toEqual([
      `${B}/base-prices/${P5}`,
      {
        byCurrency: {
          PLN: {
            product: [{ minQuantity: 10, maxQuantity: null, amount: '80.0000' }],
            variants: { [P5R]: { type: 'percent', percent: '12.00' }, [P5B]: { type: 'fixed', tiers: P5B_TIERS } },
          },
        },
      },
    ]);
  });

  it('shows a variant’s own quantity tiers read-only, sends them back exactly, and offers no single value', async () => {
    const user = userEvent.setup();
    await open();
    const p5b = within(pln()).getByRole('group', { name: 'Variant P5B' });
    expect(within(p5b).queryByRole('combobox')).toBeNull();
    expect(within(p5b).queryByRole('textbox')).toBeNull();
    expect(p5b).toHaveTextContent('From 1: 85.00');
    expect(p5b).toHaveTextContent('From 10: 75.00');
    expect(within(p5b).getByText('Has quantity tiers: edit them in the price grid.')).toBeInTheDocument();
    expect(within(p5b).getByRole('link', { name: 'Open the base prices' })).toHaveAttribute(
      'href',
      '/price-lists/00000000-0000-4000-8000-00000000d51b?tab=prices',
    );
    const price = within(pln()).getByLabelText('Price from 10, PLN');
    await user.clear(price);
    await user.type(price, '79');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    const body = api.put.mock.calls[0]![1] as { byCurrency: { PLN: { variants: Record<string, unknown> } } };
    expect(body.byCurrency.PLN.variants[P5B]).toEqual({ type: 'fixed', tiers: P5B_TIERS });
  });

  it('sends nothing when nothing changed', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Save prices' })).toBeDisabled();
    expect(api.put).not.toHaveBeenCalled();
  });
});
