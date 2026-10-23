import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { expectNoAxeViolations } from '../../helpers/axe';
import { PLATFORM_ADMIN, PRICING_READER } from '../../helpers/price-book-fixtures';

/**
 * *Show list price beside the buyer's price* on *Pricing settings* (feature
 * 161, T082; US7; FR-026): the switch reads and writes
 * `…/settings/show-list-price` (`{ value }`, the audited write of G8), is off
 * by default, is offered only to an operator holding `price_lists:write`
 * (a reader sees the state, with no control), and announces the save.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen } = await import('../../helpers/price-book-screen');

const B = '/api/v1/admin/price-books';
const SETTING = `${B}/settings/show-list-price`;
const LABEL = "Show list price beside the buyer's price";

let stored = false;

beforeEach(() => {
  stored = false;
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    const [path] = url.split('?');
    if (path === SETTING) return { data: { value: stored } };
    if (path === `${B}/precedence`) {
      return {
        data: {
          version: 1,
          preset: 'HY',
          categoryBeforeAttribute: true,
          depthMode: 'within_cell',
          cells: [
            'org.variant', 'org.product', 'org.category_attribute', 'org.category', 'org.attribute',
            'group.variant', 'group.product', 'group.category_attribute', 'group.category', 'group.attribute',
            'org.all', 'group.all',
          ],
        },
      };
    }
    if (path === '/api/v1/admin/pricing/display-mode-overrides') return { data: { items: [] } };
    if (path === `${B}/targets/organizations`) return { data: { items: [] } };
    if (path === `${B}/targets/categories`) return { data: { items: [] } };
    if (path === '/api/v1/admin/catalog/products') return { data: [] };
    if (path?.startsWith('/api/v1/admin/settings/')) return { defaultValue: 'gross_only' };
    throw new Error(`unexpected GET ${url}`);
  });
  api.put.mockImplementation(async (url: string, body: { value: boolean }) => {
    if (url === SETTING) {
      stored = body.value;
      return { data: { value: body.value } };
    }
    throw new Error(`unexpected PUT ${url}`);
  });
});

function section(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'Storefront prices' });
}

describe('Pricing settings — show the list price (FR-026)', () => {
  it('reads the setting, off by default, and explains what it does', async () => {
    mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN });
    const region = await section();
    const control = await within(region).findByRole('switch', { name: LABEL });
    expect(control.getAttribute('aria-checked') ?? String((control as HTMLInputElement).checked)).toBe('false');
    expect((control as HTMLInputElement).checked).toBe(false);
    expect(api.get).toHaveBeenCalledWith(SETTING);
    expect(
      within(region).getByText(
        'Buyers whose price is below the catalogue price see both on the product page and the product lists. The basket and the checkout always show only the price charged.',
      ),
    ).toBeTruthy();
  });

  it('shows a stored “on”', async () => {
    stored = true;
    mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN });
    const control = await within(await section()).findByRole('switch', { name: LABEL });
    await waitFor(() => expect((control as HTMLInputElement).checked).toBe(true));
  });

  it('writes { value } through the settings endpoint and announces the save', async () => {
    const user = userEvent.setup();
    mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN });
    const region = await section();
    const status = within(region).getByRole('status');
    // The live region is mounted empty, before it has anything to say.
    expect(status.textContent).toBe('');
    const control = await within(region).findByRole('switch', { name: LABEL });

    let release: () => void = () => undefined;
    api.put.mockImplementationOnce(
      (_url: string, body: { value: boolean }) =>
        new Promise((resolve) => {
          release = () => {
            stored = body.value;
            resolve({ data: { value: body.value } });
          };
        }),
    );
    await user.click(control);
    expect(api.put).toHaveBeenCalledWith(SETTING, { value: true });
    expect(api.put).toHaveBeenCalledTimes(1);
    // In flight: busy, not clickable twice, and said so.
    expect(control.getAttribute('aria-busy')).toBe('true');
    expect((control as HTMLInputElement).disabled).toBe(true);
    expect(status.textContent).toBe('Saving…');
    release();
    await waitFor(() => expect(status.textContent).toBe('Saved. Buyers see the list price from their next page.'));
    expect((control as HTMLInputElement).checked).toBe(true);
    expect((control as HTMLInputElement).disabled).toBe(false);

    await user.click(control);
    expect(api.put).toHaveBeenLastCalledWith(SETTING, { value: false });
    await waitFor(() => expect(status.textContent).toBe('Saved. Buyers see one price.'));
    expect((control as HTMLInputElement).checked).toBe(false);
  });

  it('keeps the stored value and says why when the save is refused', async () => {
    const user = userEvent.setup();
    api.put.mockRejectedValueOnce(
      new ApiError(403, { error: { code: 'FORBIDDEN', message: 'Missing permission price_lists:write.' } }),
    );
    mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN });
    const region = await section();
    const control = await within(region).findByRole('switch', { name: LABEL });
    await user.click(control);
    await waitFor(() =>
      expect(within(region).getByRole('status').textContent).toBe('The setting could not be saved. Try again.'),
    );
    expect((control as HTMLInputElement).checked).toBe(false);
  });

  it('offers no control without price_lists:write, and shows the state', async () => {
    stored = true;
    mountScreen({ path: '/price-lists/display-modes', session: PRICING_READER });
    const region = await section();
    expect(await within(region).findByText(LABEL)).toBeTruthy();
    expect(await within(region).findByText('On')).toBeTruthy();
    expect(within(region).queryByRole('switch')).toBeNull();
    expect(within(region).queryByRole('checkbox')).toBeNull();
  });

  it('reads in Polish', async () => {
    mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN, language: 'pl' });
    const region = await screen.findByRole('region', { name: 'Ceny w sklepie' });
    expect(await within(region).findByRole('switch', { name: 'Pokazuj cenę katalogową obok ceny kupującego' })).toBeTruthy();
  });

  it('has no axe violations', async () => {
    mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN });
    await within(await section()).findByRole('switch', { name: LABEL });
    await expectNoAxeViolations(document.body);
  });
});
