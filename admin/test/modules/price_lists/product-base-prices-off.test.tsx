import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';
import { modulePresence } from '../../helpers/render-with-session';

/**
 * `price_lists` off and the product editor's one Save (feature 180, US5; FR-034; Principle XVII).
 *
 * A module that is off takes no part: no panel, no request, nothing counted. One switched off
 * while its panel holds unsaved prices has them dropped with a notice; a write refused with
 * `503 MODULE_DISABLED` is that part not saved, named as switched off; switched back on, the
 * panel takes part again.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountBasePricePanel, apiError, pageSaves } = await import('../../helpers/price-book-screen');
const { P5, B, basePrices, serveBasePrices } = await import('./base-price-fixture');

const pageSave = (): HTMLElement => screen.getByRole('button', { name: /^(Save|Save \d+ changes?|Saving…)$/ });
const priceBookRequests = (): unknown[][] =>
  [...api.get.mock.calls, ...api.put.mock.calls].filter(([url]) => String(url).startsWith(B));

/** The module projection the presence provider re-reads (it fetches through the kit's own client). */
function serveProjection(present: boolean): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify(present ? modulePresence({ present: ['price_lists'] }) : modulePresence({ absent: ['price_lists'] })),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
}

async function editFirstPrice(value: string): Promise<void> {
  const user = userEvent.setup();
  const price = within(await screen.findByRole('group', { name: 'PLN' })).getByLabelText('Price from 1, PLN');
  await user.clear(price);
  await user.type(price, value);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  serveBasePrices(api, basePrices());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('base prices with price_lists off (FR-034)', () => {
  it('renders no panel, sends no price-book request and counts nothing', async () => {
    const { container } = mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN, absent: ['price_lists'] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('group', { name: 'PLN' })).toBeNull();
    expect(screen.queryByText('Base prices')).toBeNull();
    expect(priceBookRequests()).toEqual([]);
    expect(container.querySelector('.b2b-sticky-form-actions')).toBeNull();
  });

  it('drops unsaved prices with a notice when the module is switched off under the page', async () => {
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    await editFirstPrice('95');
    expect(pageSave()).toHaveAccessibleName('Save 1 change');

    serveProjection(false);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh presence' }));

    await waitFor(() => expect(screen.queryByRole('group', { name: 'PLN' })).toBeNull());
    await waitFor(() => expect(screen.getByText(/Base prices: unsaved changes were discarded because the module was switched off\./)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Save \d/ })).toBeNull();
  });

  it('names a 503 MODULE_DISABLED as the part being switched off', async () => {
    api.put.mockImplementation(async (url: string) => {
      if (url.endsWith('?dryRun=true')) return { data: { valid: true } };
      throw await apiError(503, 'MODULE_DISABLED', 'Module price_lists is disabled.');
    });
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    await editFirstPrice('95');
    await userEvent.setup().click(pageSave());

    await waitFor(() => expect(pageSaves.last?.result).toBe('failed'));
    expect(pageSaves.last?.parts[0]).toMatchObject({ id: 'price_lists:base-prices', message: 'Not saved: this module was switched off.' });
    expect(screen.getByText('Not saved: Base prices — Not saved: this module was switched off.')).toBeInTheDocument();
  });

  it('takes part again once it is switched back on', async () => {
    serveProjection(false);
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN, absent: ['price_lists'] });
    expect(screen.queryByRole('group', { name: 'PLN' })).toBeNull();

    serveProjection(true);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh presence' }));
    await editFirstPrice('95');
    expect(pageSave()).toHaveAccessibleName('Save 1 change');
  });
});
