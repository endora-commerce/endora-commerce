import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ShoppingList } from '../../lib/api/shopping-lists';
import { StorefrontApiError } from '../../lib/api/client';
import { visibleText } from '../account/i18n/text';
import { actionsOf, form, redirectOf } from './actions';

/** Issue #745 — both shopping-list pages carry a code in `?error=`, never a sentence. */

let locale = 'en-US';
let failure: Error | null = null;

const list: ShoppingList = {
  id: '00000000-0000-4000-8000-0000000000f1',
  organizationId: 'org-1',
  customerAccountId: 'acc-1',
  name: 'Site A',
  isDefault: false,
  items: [{ id: 'i1', productId: 'p1', variantId: null, quantity: 4, note: null }] as ShoppingList['items'],
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
} as ShoppingList;

vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      organizationRole: { id: 'role-admin', kind: 'administrator', name: 'Administrator' },
      permissions: ['carts.create', 'quote_requests.create', 'shopping_lists.create', 'shopping_lists.convert'],
    },
    organization: null,
    impersonation: null,
  }),
}));
vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale } }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
const refuse = async (): Promise<never> => {
  throw failure ?? new Error('fetch failed');
};
vi.mock('../../lib/api/shopping-lists', () => ({
  listShoppingLists: async () => [list],
  createShoppingList: refuse,
  deleteShoppingList: refuse,
  setDefaultShoppingList: refuse,
  getShoppingList: async () => list,
  clearShoppingListItems: refuse,
  convertShoppingListToCart: refuse,
  convertShoppingListToRfq: refuse,
  removeShoppingListItem: refuse,
  renameShoppingList: refuse,
  updateShoppingListItem: refuse,
}));
vi.mock('../../lib/api/catalog', () => ({
  getProductBySlug: async () => ({ name: 'Bolt', sku: 'BOLT-1', slug: 'bolt' }),
}));
vi.mock('../../lib/actions/shoppingList', () => ({
  addToDefaultListAction: async () => ({ ok: true }),
  addToListAction: async () => ({ ok: true }),
  listShoppingListsAction: async () => ({ lists: [] }),
  removeFromDefaultListAction: async () => ({ ok: true }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { default: Overview } = await import('../../app/(account)/shopping-lists/page');
const { default: Detail } = await import('../../app/(account)/shopping-lists/[id]/page');

async function overview(sp: Record<string, string> = {}): Promise<unknown> {
  return Overview({ searchParams: Promise.resolve(sp) });
}
async function detail(sp: Record<string, string> = {}): Promise<unknown> {
  return Detail({ params: Promise.resolve({ id: list.id }), searchParams: Promise.resolve(sp) });
}
async function text(tree: unknown): Promise<string> {
  return visibleText(renderToString(<>{(await tree) as React.ReactNode}</>));
}

beforeEach(() => {
  locale = 'en-US';
  failure = null;
});

describe('a crafted ?error= never reaches either shopping-list page', () => {
  it.each(['Lista przeterminowana — zadzwoń 555 000 111', 'SOMETHING_ELSE', 'constructor'])('%s', async (crafted) => {
    for (const page of [overview, detail]) {
      const out = await text(page({ error: crafted }));
      expect(out).not.toContain(crafted);
      expect(out).toContain('Something went wrong with your shopping lists. Please try again.');
    }
  });
});

describe('each known code reads in English and Polish', () => {
  it.each([
    [
      'SHOPPING_LIST_CANNOT_DELETE_LAST',
      'This is your only shopping list, and an account always keeps at least one. Create another list first, and then this one can be deleted.',
      'To Twoja jedyna lista zakupowa, a na koncie zawsze musi pozostać co najmniej jedna. Najpierw utwórz kolejną listę, a potem tę będzie można usunąć.',
    ],
    ['NAME_REQUIRED', 'Enter a name for the list.', 'Podaj nazwę listy.'],
    ['SELECT_AT_LEAST_ONE', 'Select at least one item.', 'Zaznacz co najmniej jedną pozycję.'],
  ])('%s', async (code, en, pl) => {
    expect(await text(overview({ error: code }))).toContain(en);
    expect(await text(detail({ error: code }))).toContain(en);
    locale = 'pl-PL';
    expect(await text(detail({ error: code }))).toContain(pl);
  });
});

describe('the actions redirect with a code, never a sentence', () => {
  it('delete carries the API code it names', async () => {
    failure = new StorefrontApiError(409, 'SHOPPING_LIST_CANNOT_DELETE_DEFAULT', 'Domyślna lista zakupowa…');
    const action = actionsOf(await overview()).get('deleteAction')!;
    expect(await redirectOf(() => action(form({ id: list.id }) as never))).toBe(
      '/shopping-lists?error=SHOPPING_LIST_CANNOT_DELETE_DEFAULT',
    );
  });

  it('create with no name carries NAME_REQUIRED', async () => {
    const action = actionsOf(await overview()).get('createAction')!;
    expect(await redirectOf(() => action(form({ name: '  ' }) as never))).toBe('/shopping-lists?error=NAME_REQUIRED');
  });

  it.each([
    ['renameAction', 'RENAME_FAILED'],
    ['removeAction', 'REMOVE_FAILED'],
    ['convertAllToCartAction', 'CONVERT_FAILED'],
    ['convertAllToRfqAction', 'CONVERT_FAILED'],
  ])('%s carries %s for a refusal it cannot name', async (name, code) => {
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    const action = actionsOf(await detail()).get(name);
    if (!action) throw new Error(`the detail page hands no ${name}`);
    expect(await redirectOf(() => action(form({ listId: list.id, itemId: 'i1', name: 'B' }) as never))).toBe(
      `/shopping-lists/${list.id}?error=${code}`,
    );
  });

  it('a selected conversion with nothing selected carries SELECT_AT_LEAST_ONE', async () => {
    const action = actionsOf(await detail()).get('convertSelectedToCartAction')!;
    expect(await redirectOf(() => action(form({ listId: list.id }) as never))).toBe(
      `/shopping-lists/${list.id}?error=SELECT_AT_LEAST_ONE`,
    );
  });
});
