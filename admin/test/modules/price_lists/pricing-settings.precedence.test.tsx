import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { PrecedenceView } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../../helpers/axe';
import { PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';

/**
 * The precedence on *Pricing settings* (feature 161, T081; US6; FR-025): the
 * page is titled *Pricing settings*; its precedence section names the active
 * preset, lists the twelve buyer cells in the order in force with an example
 * each, says which of a category line and an attribute value line wins, and
 * offers no control that changes any of it — changing it arrives later.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen } = await import('../../helpers/price-book-screen');

const B = '/api/v1/admin/price-books';

/** HY, the default preset (decision-record §5.6), version 1. */
const HY: PrecedenceView = {
  version: 1,
  preset: 'HY',
  categoryBeforeAttribute: true,
  depthMode: 'within_cell',
  cells: [
    'org.variant',
    'org.product',
    'org.category_attribute',
    'org.category',
    'org.attribute',
    'group.variant',
    'group.product',
    'group.category_attribute',
    'group.category',
    'group.attribute',
    'org.all',
    'group.all',
  ],
};

let precedence: PrecedenceView = HY;

beforeEach(() => {
  precedence = HY;
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (url: string) => {
    const [path] = url.split('?');
    if (path === `${B}/precedence`) return { data: precedence };
    if (path === `${B}/settings/show-list-price`) return { data: { value: false } };
    if (path === '/api/v1/admin/pricing/display-mode-overrides') return { data: { items: [] } };
    if (path === `${B}/targets/organizations`) return { data: { items: [] } };
    if (path === `${B}/targets/categories`) return { data: { items: [] } };
    if (path === '/api/v1/admin/catalog/products') return { data: [] };
    if (path?.startsWith('/api/v1/admin/settings/')) return { defaultValue: 'gross_only' };
    throw new Error(`unexpected GET ${url}`);
  });
});

async function open(language: 'en' | 'pl' = 'en'): Promise<HTMLElement> {
  mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN, language });
  return screen.findByRole('region', { name: language === 'en' ? 'Price precedence' : 'Kolejność cen' });
}

const EN_ORDER = [
  ['Organization book, variant line', "Acme's price for Screws 0200, zinc-plated"],
  ['Organization book, product line', "Acme's price for Screws 0200"],
  ['Organization book, category and attribute value line', "Acme's price for zinc-plated items in Screws"],
  ['Organization book, category line', "Acme's price for everything in Screws"],
  ['Organization book, attribute value line', "Acme's price for everything zinc-plated"],
  ['Customer group book, variant line', "VIP customers' price for Screws 0200, zinc-plated"],
  ['Customer group book, product line', "VIP customers' price for Screws 0200"],
  ['Customer group book, category and attribute value line', "VIP customers' price for zinc-plated items in Screws"],
  ['Customer group book, category line', "VIP customers' price for everything in Screws"],
  ['Customer group book, attribute value line', "VIP customers' price for everything zinc-plated"],
  ['Organization book, all-products line', "Acme's discount on everything"],
  ['Customer group book, all-products line', "VIP customers' discount on everything"],
] as const;

describe('Pricing settings — the precedence in force (FR-025)', () => {
  it('is titled Pricing settings, in English and Polish', async () => {
    const first = mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN });
    expect(await screen.findByRole('heading', { level: 1, name: 'Pricing settings' })).toBeTruthy();
    first.unmount();
    mountScreen({ path: '/price-lists/display-modes', session: PLATFORM_ADMIN, language: 'pl' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Ustawienia cenowe' })).toBeTruthy();
  });

  it('names the active preset and its version', async () => {
    const section = await open();
    expect(await within(section).findByText('Contract first, blanket last (HY)')).toBeTruthy();
    expect(within(section).getByText(/Version 1/)).toBeTruthy();
  });

  it('lists the twelve cells in the order in force, each with an example', async () => {
    const section = await open();
    const list = await within(section).findByRole('list', { name: 'Order in which lines win' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(12);
    items.forEach((item, index) => {
      const [label, example] = EN_ORDER[index]!;
      expect(item.textContent, `position ${index + 1}`).toContain(label);
      expect(item.textContent, `position ${index + 1}`).toContain(example);
    });
    // The list is ordered: position 1 wins over position 2.
    expect(list.tagName).toBe('OL');
  });

  it('follows the order the server answers, not a fixed one', async () => {
    precedence = {
      ...HY,
      preset: 'AF',
      cells: [...HY.cells.slice(0, 5), 'org.all', ...HY.cells.slice(5, 10), 'group.all'],
    };
    const section = await open();
    expect(await within(section).findByText('Audience first (AF)')).toBeTruthy();
    const items = within(within(section).getByRole('list', { name: 'Order in which lines win' })).getAllByRole('listitem');
    expect(items[5]!.textContent).toContain('Organization book, all-products line');
  });

  it('says which of a category line and an attribute value line wins', async () => {
    const section = await open();
    expect(await within(section).findByText('A category line wins over an attribute value line.')).toBeTruthy();
  });

  it('names an order that matches no preset as a custom order', async () => {
    precedence = { ...HY, preset: null, categoryBeforeAttribute: false };
    const section = await open();
    expect(await within(section).findByText('Custom order')).toBeTruthy();
    expect(within(section).getByText('An attribute value line wins over a category line.')).toBeTruthy();
  });

  it('says when the buyer’s own organization comes before its parents', async () => {
    precedence = { ...HY, preset: 'AF-N', depthMode: 'nearest_organization_first' };
    const section = await open();
    expect(
      await within(section).findByText(
        "Any line of the buyer's own organization wins over every line of a parent organization.",
      ),
    ).toBeTruthy();
  });

  it('offers no control that changes the precedence, and says changes arrive later', async () => {
    const section = await open();
    await within(section).findByText('Contract first, blanket last (HY)');
    expect(within(section).queryAllByRole('button')).toEqual([]);
    expect(within(section).queryAllByRole('combobox')).toEqual([]);
    expect(within(section).queryAllByRole('checkbox')).toEqual([]);
    expect(within(section).queryAllByRole('switch')).toEqual([]);
    expect(within(section).queryAllByRole('textbox')).toEqual([]);
    expect(within(section).getByText('Changing the precedence arrives in a later release.')).toBeTruthy();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('is the section the grid links to', async () => {
    const section = await open();
    expect(section.id).toBe('precedence');
  });

  it('reads in Polish', async () => {
    const section = await open('pl');
    expect(await within(section).findByText('Najpierw umowa, rabat ogólny na końcu (HY)')).toBeTruthy();
    const items = within(within(section).getByRole('list', { name: 'Kolejność wygrywania linii' })).getAllByRole('listitem');
    expect(items[1]!.textContent).toContain('Cena Acme za Wkręty 0200');
  });

  it('says so when the precedence cannot be read, with a retry', async () => {
    let fail = true;
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (url: string) => {
      if (url === `${B}/precedence` && fail) throw new Error('down');
      return base(url);
    });
    const section = await open();
    expect(await within(section).findByText('The price precedence could not be loaded.')).toBeTruthy();
    fail = false;
    within(section).getByRole('button', { name: 'Try again' }).click();
    expect(await within(section).findByText('Contract first, blanket last (HY)')).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const section = await open();
    await within(section).findByText('Contract first, blanket last (HY)');
    await expectNoAxeViolations(document.body);
  });
});
