import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';

/**
 * Saving the base prices (feature 161, T072; FR-020, OQ-1 = B): the panel's
 * own *Save prices* sends one `PUT …/base-prices/:productId` with the changed
 * currencies, shows progress, cannot be sent twice, announces the result; and
 * leaving the Pricing tab or the page with unsaved prices asks first.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountBasePricePanel, apiError } = await import('../../helpers/price-book-screen');
const { P5, P5R, P5B, B, basePrices, serveBasePrices } = await import('./base-price-fixture');

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  serveBasePrices(api, basePrices());
});

const pln = (): HTMLElement => screen.getByRole('group', { name: 'PLN' });

describe('base-price panel — saving', () => {
  it('sends one write of the changed currency, shows progress, cannot be sent twice, and announces it', async () => {
    const user = userEvent.setup();
    let resolve: (value: unknown) => void = () => undefined;
    api.put.mockImplementation(() => new Promise((r) => (resolve = r)));
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    await screen.findByRole('group', { name: 'PLN' });
    expect(screen.getByRole('button', { name: 'Save prices' })).toBeDisabled();
    const price = within(pln()).getByLabelText('Price from 1, PLN');
    await user.clear(price);
    await user.type(price, '100');
    await user.click(within(pln()).getByRole('button', { name: 'Add tier in PLN' }));
    await user.type(within(pln()).getByLabelText('Start of tier 2, PLN'), '10');
    await user.type(within(pln()).getByLabelText('Price of tier 2, PLN'), '90');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    const saving = screen.getByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    expect(saving).toHaveAttribute('aria-busy', 'true');
    await user.click(saving);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledWith(`${B}/base-prices/${P5}`, {
      byCurrency: {
        PLN: {
          product: [
            { minQuantity: 1, maxQuantity: 9, amount: '100.0000' },
            { minQuantity: 10, maxQuantity: null, amount: '90.0000' },
          ],
          variants: { [P5R]: { type: 'percent', percent: '10.00' }, [P5B]: null },
        },
      },
    });
    const saved = basePrices({
      byCurrency: {
        PLN: {
          bookId: '00000000-0000-4000-8000-00000000d51b',
          product: [
            { minQuantity: 1, maxQuantity: 9, amount: '100.0000' },
            { minQuantity: 10, maxQuantity: null, amount: '90.0000' },
          ],
          variants: { [P5R]: { type: 'percent', percent: '10.00' }, [P5B]: null },
        },
      },
    });
    await act(async () => resolve({ data: saved }));
    expect(await screen.findByText('Base prices saved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save prices' })).toBeDisabled();
    expect(within(pln()).getByRole('group', { name: 'Variant P5R' })).toHaveTextContent('Preview: 110.00');
  });

  it('shows the server’s refusal and keeps the edits', async () => {
    const user = userEvent.setup();
    api.put.mockRejectedValue(await apiError(400, 'VALIDATION_FAILED', 'A variant adjustment needs a product base price.'));
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    await screen.findByRole('group', { name: 'PLN' });
    const price = within(pln()).getByLabelText('Price from 1, PLN');
    await user.clear(price);
    await user.type(price, '95');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A variant adjustment needs a product base price.');
    expect(price).toHaveValue('95');
  });

  it('asks before the Pricing tab or the page is left with unsaved prices', async () => {
    const user = userEvent.setup();
    const onHostTab = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN, onHostTab });
    await screen.findByRole('group', { name: 'PLN' });
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onHostTab).toHaveBeenCalledTimes(1);
    const price = within(pln()).getByLabelText('Price from 1, PLN');
    await user.clear(price);
    await user.type(price, '95');
    await user.click(screen.getByRole('tab', { name: 'Details' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onHostTab).toHaveBeenCalledTimes(1);
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    confirm.mockRestore();
  });
});
