import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ShoppingList } from '../../../lib/api/shopping-lists';
import { POLISH_DIACRITIC, visibleText } from './text';

/**
 * Issue #85 — the shopping-list pages and their controls render the shop's
 * language: the overview, the detail with its counted conversion sentences
 * (Polish has three forms: 1 / 2–4 / 5+), the clear and delete dialogs and the
 * PDP's list heart, in `en-US` and `pl-PL`.
 *
 * The dialogs and the heart's menu only open after a click, and the storefront
 * harness is server-render only, so `useState` is seeded for those renders
 * (`seedState`): each `useState` call takes the next seeded value instead of its
 * initial one. `createPortal` renders in place, so the dialog's markup is in the
 * string.
 */

let locale = 'en-US';
let seeded: unknown[] = [];

function seedState(...values: unknown[]): void {
  seeded = values;
}

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: <S,>(initial: S | (() => S)) => actual.useState(seeded.length > 0 ? (seeded.shift() as S) : initial),
  };
});
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return { ...actual, createPortal: (node: React.ReactNode) => node };
});

const list: ShoppingList = {
  id: 'l1',
  organizationId: 'org-1',
  customerAccountId: 'acc-1',
  name: 'Site A',
  isDefault: false,
  items: [
    { id: 'i1', productId: 'p1', variantId: 'v1234567890', quantity: 4, note: null },
  ] as ShoppingList['items'],
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

let lists: ShoppingList[] = [];

vi.mock('../../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: {} }),
}));
vi.mock('../../../lib/api/shopping-lists', () => ({
  listShoppingLists: async () => lists,
  createShoppingList: async () => list,
  deleteShoppingList: async () => undefined,
  setDefaultShoppingList: async () => undefined,
  getShoppingList: async () => list,
  clearShoppingListItems: async () => undefined,
  convertShoppingListToCart: async () => ({ added: 0, skipped: [] }),
  convertShoppingListToRfq: async () => ({ rfqId: 'r', added: 0, skipped: [] }),
  removeShoppingListItem: async () => undefined,
  renameShoppingList: async () => undefined,
  updateShoppingListItem: async () => undefined,
}));
vi.mock('../../../lib/api/catalog', () => ({
  getProductBySlug: async () => ({ name: 'Bolt', sku: 'BOLT-1', slug: 'bolt' }),
}));
vi.mock('../../../lib/actions/shoppingList', () => ({
  addToDefaultListAction: async () => ({ ok: true }),
  addToListAction: async () => ({ ok: true }),
  listShoppingListsAction: async () => ({ lists: [] }),
  removeFromDefaultListAction: async () => ({ ok: true }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const noop = async (): Promise<void> => undefined;

async function renderDetail(sp: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import('../../../app/(account)/shopping-lists/[id]/page');
  const tree = await Page({ params: Promise.resolve({ id: 'l1' }), searchParams: Promise.resolve(sp) });
  return visibleText(renderToString(<>{tree}</>));
}

beforeEach(() => {
  seeded = [];
  lists = [];
});

describe('shopping-list overview — the shop language (issue #85)', () => {
  it('renders the overview in both languages', async () => {
    const { default: Page } = await import('../../../app/(account)/shopping-lists/page');
    lists = [{ ...list, isDefault: true }, { ...list, id: 'l2', name: 'Site B' }];
    locale = 'en-US';
    const en = visibleText(renderToString(<>{await Page({ searchParams: Promise.resolve({}) })}</>));
    expect(en).toContain('Shopping lists');
    expect(en).toContain('Create a new list');
    expect(en).toContain('Name Items Updated Default');
    expect(en).toContain('Set as default');
    expect(en).toContain('Delete');
    expect(en).not.toMatch(POLISH_DIACRITIC);
    locale = 'pl-PL';
    const pl = visibleText(renderToString(<>{await Page({ searchParams: Promise.resolve({}) })}</>));
    expect(pl).toContain('Listy zakupów');
    expect(pl).toContain('Utwórz nową listę');
    expect(pl).toContain('Domyślna');
    expect(pl).toContain('Ustaw jako domyślną');
    expect(pl).toContain('Usuń');
  });
});

describe('shopping-list detail — the shop language (issue #85)', () => {
  it('renders the detail in English', async () => {
    locale = 'en-US';
    const text = await renderDetail();
    expect(text).toContain('← All lists');
    expect(text).toContain('Rename list');
    expect(text).toContain('Product Qty Note');
    expect(text).toContain('SKU: BOLT-1');
    expect(text).toContain('variant v1234567');
    expect(text).toContain('Convert all to cart');
    expect(text).toContain('Convert selected to a quote request');
    expect(text).toContain('Clear list');
    expect(text).not.toMatch(POLISH_DIACRITIC);
  });

  it('renders the detail in Polish', async () => {
    locale = 'pl-PL';
    const text = await renderDetail();
    expect(text).toContain('← Wszystkie listy');
    expect(text).toContain('Zmień nazwę listy');
    expect(text).toContain('Produkt Ilość Notatka');
    expect(text).toContain('wariant v1234567');
    expect(text).toContain('Dodaj wszystko do koszyka');
    expect(text).toContain('Dodaj zaznaczone do zapytania ofertowego');
    expect(text).toContain('Wyczyść listę');
  });

  it('counts what a cart conversion added and skipped, in each Polish form', async () => {
    locale = 'pl-PL';
    expect(await renderDetail({ cartAdded: '1', cartSkipped: '0' })).toContain('Dodano 1 pozycję do koszyka.');
    expect(await renderDetail({ cartAdded: '3', cartSkipped: '2' })).toContain(
      'Dodano 3 pozycje do koszyka. Pominięto 2 wiersze.',
    );
    expect(await renderDetail({ cartAdded: '5', cartSkipped: '12' })).toContain(
      'Dodano 5 pozycji do koszyka. Pominięto 12 wierszy.',
    );
    expect(await renderDetail({ cartAdded: '22', cartSkipped: '1' })).toContain(
      'Dodano 22 pozycje do koszyka. Pominięto 1 wiersz.',
    );
  });

  it('counts what a cart conversion added and skipped, in English', async () => {
    locale = 'en-US';
    expect(await renderDetail({ cartAdded: '1', cartSkipped: '0' })).toContain('Added 1 item to your cart.');
    expect(await renderDetail({ cartAdded: '3', cartSkipped: '1' })).toContain(
      'Added 3 items to your cart. Skipped 1 row.',
    );
  });

  it('words the quote-request conversion in both languages', async () => {
    locale = 'en-US';
    expect(await renderDetail({ rfqId: 'r1', rfqAdded: '2', rfqSkipped: '1' })).toContain(
      'Added 2 items to your draft quote request. Skipped 1 archived row. Open the quote request',
    );
    locale = 'pl-PL';
    expect(await renderDetail({ rfqId: 'r1', rfqAdded: '2', rfqSkipped: '5' })).toContain(
      'Dodano 2 pozycje do szkicu zapytania ofertowego. Pominięto 5 zarchiwizowanych wierszy. Otwórz zapytanie ofertowe',
    );
  });
});

describe('shopping-list dialogs — the shop language (issue #85)', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { body: {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('words the clear dialog in both languages', async () => {
    const { ClearListButton } = await import('../../../components/shopping-lists/ClearListButton');
    seedState(true);
    const en = visibleText(renderToString(<ClearListButton listId="l1" locale="en-US" clearAction={noop} />));
    expect(en).toContain('Clear this list?');
    expect(en).toContain('This removes all items from the list. This action cannot be undone.');
    expect(en).toContain('Cancel');
    seedState(true);
    const pl = visibleText(renderToString(<ClearListButton listId="l1" locale="pl-PL" clearAction={noop} />));
    expect(pl).toContain('Wyczyścić tę listę?');
    expect(pl).toContain('Tej operacji nie można cofnąć.');
    expect(pl).toContain('Anuluj');
  });

  it('words the delete dialog, with the list name inside the sentence, in both languages', async () => {
    const { DeleteShoppingListButton } = await import(
      '../../../components/shopping-lists/DeleteShoppingListButton'
    );
    seedState(true);
    const en = visibleText(
      renderToString(<DeleteShoppingListButton listId="l1" listName="Site A" locale="en-US" deleteAction={noop} />),
    );
    expect(en).toContain('Delete this list?');
    expect(en).toContain('Deleting Site A removes the list and all its items.');
    expect(en).toContain('Delete list');
    seedState(true);
    const pl = visibleText(
      renderToString(<DeleteShoppingListButton listId="l1" listName="Site A" locale="pl-PL" deleteAction={noop} />),
    );
    expect(pl).toContain('Usunąć tę listę?');
    expect(pl).toContain('Usunięcie listy Site A usuwa ją wraz ze wszystkimi pozycjami.');
    expect(pl).toContain('Usuń listę');
  });
});

describe('shopping-list heart — the shop language (issue #85)', () => {
  const twoLists = [
    { id: 'a', name: 'Site A', isDefault: true },
    { id: 'b', name: 'Site B', isDefault: false },
  ];

  it('words the labelled button, its picker and its confirmation in both languages', async () => {
    const { AddToShoppingListButton } = await import('../../../components/AddToShoppingListButton');
    // state, inList, lists, menuOpen, addedTo
    seedState('idle', true, twoLists, true, 'Site B');
    const en = renderToString(
      <AddToShoppingListButton apiBase="" productId="p1" label="Add" locale="en-US" showLabel />,
    );
    expect(en).toContain('aria-label="Remove from shopping list"');
    expect(en).toContain('aria-label="Choose a shopping list"');
    expect(visibleText(en)).toContain('Added to “Site B”');
    expect(visibleText(en)).toContain('default');
    expect(visibleText(en)).not.toMatch(POLISH_DIACRITIC);

    seedState('idle', true, twoLists, true, 'Site B');
    const pl = renderToString(
      <AddToShoppingListButton apiBase="" productId="p1" label="Dodaj" locale="pl-PL" showLabel />,
    );
    expect(pl).toContain('aria-label="Usuń z listy zakupowej"');
    expect(pl).toContain('aria-label="Wybierz listę zakupów"');
    expect(visibleText(pl)).toContain('Dodano do „Site B”');
    expect(visibleText(pl)).toContain('domyślna');
  });

  it('words the icon heart’s failure tooltip in both languages', async () => {
    const { AddToShoppingListButton } = await import('../../../components/AddToShoppingListButton');
    seedState('error');
    expect(
      visibleText(renderToString(<AddToShoppingListButton apiBase="" productId="p1" label="Add" locale="en-US" />)),
    ).toContain('Could not change the list');
    seedState('error');
    expect(
      visibleText(renderToString(<AddToShoppingListButton apiBase="" productId="p1" label="Dodaj" locale="pl-PL" />)),
    ).toContain('Nie udało się zmienić listy');
  });
});
