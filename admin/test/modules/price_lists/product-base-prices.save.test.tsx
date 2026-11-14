import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';

/**
 * Saving the base prices with the product editor's one Save (feature 180, WP-3; FR-020, FR-021,
 * FR-031; 161 FR-020's original wording restored). The panel is a save participant: it has no
 * *Save prices*, no prompt of its own and no "Applies immediately" badge; its changes are counted
 * by the page Save, survive a tab switch, are pre-checked by the server's dry run and then written
 * by one `PUT …/base-prices/:productId` of the changed currencies.
 *
 * The page Save here is the harness in `price-book-screen.tsx` — the session, admin-kit's
 * `SaveSessionActions` and the panel rendered through the real zone.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountBasePricePanel, apiError, pageSaves } = await import('../../helpers/price-book-screen');
const { P5, P5R, P5B, B, basePrices, serveBasePrices } = await import('./base-price-fixture');

const DRY = `${B}/base-prices/${P5}?dryRun=true`;
const WRITE = `${B}/base-prices/${P5}`;

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  serveBasePrices(api, basePrices());
});

const pln = (): HTMLElement => screen.getByRole('group', { name: 'PLN' });
const pageSave = (): HTMLElement => screen.getByRole('button', { name: /^(Save|Save \d+ changes?|Saving…)$/ });

async function editFirstPrice(value: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  const price = within(pln()).getByLabelText('Price from 1, PLN');
  await user.clear(price);
  await user.type(price, value);
  return price;
}

describe('base-price panel — saved by the page Save', () => {
  it('has no Save of its own and no "Applies immediately" badge', async () => {
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    await screen.findByRole('group', { name: 'PLN' });
    // The page Save appears once the panel has registered as a writable part.
    await screen.findByRole('button', { name: 'Save' });
    expect(screen.queryByRole('button', { name: 'Save prices' })).toBeNull();
    expect(screen.queryByText('Applies immediately')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Save/ })).toHaveLength(1);
    expect(pageSave()).toHaveAccessibleName('Save');
  });

  it('counts the changed currency, pre-checks it, then writes it once', async () => {
    const user = userEvent.setup();
    let resolve: (value: unknown) => void = () => undefined;
    api.put.mockImplementation((url: string) =>
      url === DRY ? Promise.resolve({ data: { valid: true } }) : new Promise((r) => (resolve = r)),
    );
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    await screen.findByRole('group', { name: 'PLN' });
    await editFirstPrice('100');
    await user.click(within(pln()).getByRole('button', { name: 'Add tier in PLN' }));
    await user.type(within(pln()).getByLabelText('Start of tier 2, PLN'), '10');
    await user.type(within(pln()).getByLabelText('Price of tier 2, PLN'), '90');
    expect(pageSave()).toHaveAccessibleName('Save 1 change');

    await user.click(pageSave());
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    const body = {
      byCurrency: {
        PLN: {
          product: [
            { minQuantity: 1, maxQuantity: 9, amount: '100.0000' },
            { minQuantity: 10, maxQuantity: null, amount: '90.0000' },
          ],
          variants: { [P5R]: { type: 'percent' as const, percent: '10.00' }, [P5B]: null },
        },
      },
    };
    expect(api.put.mock.calls[0]).toEqual([DRY, body]);
    expect(api.put.mock.calls[1]).toEqual([WRITE, body]);
    // Inert while saving: a second press sends nothing.
    await user.click(pageSave());
    expect(api.put).toHaveBeenCalledTimes(2);

    const saved = basePrices({
      byCurrency: {
        PLN: {
          bookId: '00000000-0000-4000-8000-00000000d51b',
          product: body.byCurrency.PLN.product,
          variants: body.byCurrency.PLN.variants,
        },
      },
    });
    await act(async () => resolve({ data: saved }));
    await waitFor(() => expect(pageSaves.last?.result).toBe('saved'));
    expect(pageSave()).toHaveAccessibleName('Save');
    expect(within(pln()).getByRole('group', { name: 'Variant P5R' })).toHaveTextContent('Preview: 110.00');
    expect(screen.getByText('Saved: Base prices.')).toBeInTheDocument();
  });

  it('a refusal of the dry run writes nothing, keeps the edit and names the part', async () => {
    api.put.mockImplementation(async (url: string) => {
      if (url === DRY) throw await apiError(400, 'VALIDATION_FAILED', 'A variant adjustment needs a product base price.');
      return { data: basePrices() };
    });
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    await screen.findByRole('group', { name: 'PLN' });
    const price = await editFirstPrice('95');
    await userEvent.setup().click(pageSave());

    await waitFor(() => expect(pageSaves.last?.result).toBe('refused'));
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put.mock.calls[0]![0]).toBe(DRY);
    expect(price).toHaveValue('95');
    expect(screen.getAllByText(/A variant adjustment needs a product base price\./).length).toBeGreaterThan(0);
    expect(screen.getByText('Base prices — 1 problem')).toBeInTheDocument();
    expect(pageSave()).toHaveAccessibleName('Save 1 change');
  });

  it('a failed write keeps the edit staged and says why', async () => {
    api.put.mockImplementation(async (url: string) => {
      if (url === DRY) return { data: { valid: true } };
      throw await apiError(500, 'INTERNAL', 'Database unavailable');
    });
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    await screen.findByRole('group', { name: 'PLN' });
    const price = await editFirstPrice('95');
    await userEvent.setup().click(pageSave());

    await waitFor(() => expect(pageSaves.last?.result).toBe('failed'));
    expect(price).toHaveValue('95');
    expect(screen.getAllByText(/Database unavailable/).length).toBeGreaterThan(0);
    expect(pageSave()).toHaveAccessibleName('Save 1 change');
  });

  it('keeps the edit through a tab switch and asks nothing (FR-003, FR-031)', async () => {
    const user = userEvent.setup();
    const onHostTab = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN, onHostTab });
    await screen.findByRole('group', { name: 'PLN' });
    await editFirstPrice('95');

    await user.click(screen.getByRole('tab', { name: 'Details' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onHostTab).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group', { name: 'PLN' })).toBeNull();
    expect(pageSave()).toHaveAccessibleName('Save 1 change');

    await user.click(screen.getByRole('tab', { name: 'Pricing' }));
    expect(within(await screen.findByRole('group', { name: 'PLN' })).getByLabelText('Price from 1, PLN')).toHaveValue('95');
    // The panel runs no leave prompt of its own: the editor's one guard does (FR-030).
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    confirm.mockRestore();
  });

  it('is never counted for a caller who may not write base prices (FR-035)', async () => {
    serveBasePrices(api, basePrices({ writable: false }));
    const { container } = mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    await screen.findByRole('group', { name: 'PLN' });
    expect(screen.queryByRole('textbox')).toBeNull();
    // No writable part and no host part: the harness Save is not shown at all.
    expect(container.querySelector('.b2b-sticky-form-actions')).toBeNull();
  });
});
