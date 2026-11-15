import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ShoppingList } from '../../lib/api/shopping-lists';
import { StorefrontApiError } from '../../lib/api/client';
import { actionsOf, form, redirectOf } from '../url-errors/actions';

/**
 * Issue #1251 — the list page has one *Save changes* for the list's name and every line
 * quantity, and the four conversions save what the buyer typed before converting, so they
 * convert the typed quantities rather than the stored ones. Remove, Clear and the conversions
 * stay immediate. The page is still a server-rendered form: every field submits without JS.
 */

const LIST_ID = '00000000-0000-4000-8000-0000000000f1';
let locale = 'en-US';
let list: ShoppingList;
const calls: string[] = [];
const updateShoppingList = vi.fn(async (_session: string, _id: string, _patch: unknown) => {
  calls.push('update');
  if (updateFailure) throw updateFailure;
  return list;
});
let updateFailure: Error | null = null;
const convertShoppingListToCart = vi.fn(async (_session: string, _id: string, _itemIds?: string[]) => {
  calls.push('toCart');
  return { shoppingListId: LIST_ID, added: 3, skipped: [] };
});
const convertShoppingListToRfq = vi.fn(async (_session: string, _id: string, _itemIds?: string[]) => {
  calls.push('toRfq');
  return { shoppingListId: LIST_ID, rfqId: '00000000-0000-4000-8000-0000000000aa', added: 2, skipped: [] };
});

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
vi.mock('../../lib/api/shopping-lists', () => ({
  getShoppingList: async () => list,
  updateShoppingList: (...args: [string, string, unknown]) => updateShoppingList(...args),
  clearShoppingListItems: async () => undefined,
  removeShoppingListItem: async () => undefined,
  convertShoppingListToCart: (...args: [string, string, string[]?]) => convertShoppingListToCart(...args),
  convertShoppingListToRfq: (...args: [string, string, string[]?]) => convertShoppingListToRfq(...args),
}));
vi.mock('../../lib/api/catalog', () => ({
  getProductBySlug: async () => ({ name: 'Bolt', sku: 'BOLT-1', slug: 'bolt' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { default: Detail } = await import('../../app/(account)/shopping-lists/[id]/page');

async function tree(sp: Record<string, string> = {}): Promise<unknown> {
  return Detail({ params: Promise.resolve({ id: LIST_ID }), searchParams: Promise.resolve(sp) });
}
async function html(sp: Record<string, string> = {}): Promise<string> {
  return renderToString(<>{(await tree(sp)) as React.ReactNode}</>).replaceAll('<!-- -->', '');
}
async function action(name: string): Promise<(data: FormData) => Promise<void>> {
  const found = actionsOf(await tree()).get(name);
  if (!found) throw new Error(`the detail page hands no ${name}`);
  return found as unknown as (data: FormData) => Promise<void>;
}

/** The fields the page's one form submits: the name, and each line's typed and shown quantity. */
function typed(fields: { name?: string; quantities: Record<string, [typed: string, shown: number]> }, extra: Record<string, string> = {}): FormData {
  const data = form({ listId: LIST_ID, name: fields.name ?? 'Site A', nameWas: 'Site A', ...extra });
  for (const [id, [value, shown]] of Object.entries(fields.quantities)) {
    data.append(`quantity.${id}`, value);
    data.append(`quantityWas.${id}`, String(shown));
  }
  return data;
}

beforeEach(() => {
  locale = 'en-US';
  updateFailure = null;
  calls.length = 0;
  updateShoppingList.mockClear();
  convertShoppingListToCart.mockClear();
  convertShoppingListToRfq.mockClear();
  list = {
    id: LIST_ID,
    organizationId: 'org-1',
    customerAccountId: 'acc-1',
    name: 'Site A',
    isDefault: false,
    items: [
      { id: 'i1', productId: 'p1', variantId: null, quantity: 4, note: null },
      { id: 'i2', productId: 'p2', variantId: null, quantity: 2, note: null },
      { id: 'i3', productId: 'p3', variantId: null, quantity: 9, note: null },
    ] as ShoppingList['items'],
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
});

describe('the page — one form, one Save', () => {
  it('renders one Save changes and no per-row Save or Rename', async () => {
    const out = await html();
    expect(out.match(/>Save changes<\/button>/g)).toHaveLength(1);
    expect(out).not.toMatch(/>Save<\/button>/);
    expect(out).not.toMatch(/>Rename<\/button>/);
    expect(out).not.toContain('form="sl-qty-');
    // The name and every quantity sit in the one form the Save and the conversions submit.
    expect(out).toMatch(/<form id="sl-list"[^>]*novalidate/i);
    expect(out).toMatch(/<input[^>]*name="name"[^>]*value="Site A"/);
    for (const id of ['i1', 'i2', 'i3']) expect(out).toMatch(new RegExp(`<input[^>]*name="quantity\\.${id}"`));
    const form = /<form id="sl-list"[\s\S]*?<\/form>/.exec(out)?.[0] ?? '';
    expect(form).toContain('Save changes');
    expect(form).toContain('Convert all to cart');
    expect(form).toContain('Convert selected to a quote request');
    expect(form).toContain('name="quantity.i1"');
    // Remove stays its own immediate form per row, outside the list form.
    expect(out).toMatch(/<form id="sl-remove-i1"/);
    expect(form.slice('<form'.length)).not.toContain('<form');
  });

  it('words the controls in Polish', async () => {
    locale = 'pl-PL';
    const out = await html();
    expect(out).toContain('>Zapisz zmiany</button>');
    expect(out).toContain('Nazwa listy');
  });

  it('marks the refused row and moves focus there after a refused save', async () => {
    const out = await html({ qtyError: 'i2' });
    const input = /<input[^>]*name="quantity\.i2"[^>]*>/.exec(out)?.[0] ?? '';
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="sl-qty-error-i2"');
    expect(out).toMatch(/<p id="sl-qty-error-i2" role="status"[^>]*>Enter a whole number from 1 to 9999.<\/p>/);
  });
});

describe('Save changes — several rows edited, saved once', () => {
  it('sends the name and every edited quantity in one write', async () => {
    const save = await action('saveListAction');
    const to = await redirectOf(() =>
      save(typed({ name: 'Site B', quantities: { i1: ['5', 4], i2: [' 12 ', 2], i3: ['9', 9] } })),
    );
    expect(updateShoppingList).toHaveBeenCalledTimes(1);
    expect(updateShoppingList).toHaveBeenCalledWith('session-cookie', LIST_ID, {
      name: 'Site B',
      items: [
        { id: 'i1', quantity: 5 },
        { id: 'i2', quantity: 12 },
      ],
    });
    expect(to).toBe(`/shopping-lists/${LIST_ID}?status=saved`);
  });

  it('writes nothing when nothing changed', async () => {
    const save = await action('saveListAction');
    const to = await redirectOf(() => save(typed({ quantities: { i1: ['4', 4], i2: ['2', 2] } })));
    expect(updateShoppingList).not.toHaveBeenCalled();
    expect(to).toBe(`/shopping-lists/${LIST_ID}`);
  });

  it('writes nothing and names the row when one quantity is refused', async () => {
    const save = await action('saveListAction');
    const to = await redirectOf(() => save(typed({ quantities: { i1: ['5', 4], i2: ['0', 2] } })));
    expect(updateShoppingList).not.toHaveBeenCalled();
    expect(to).toBe(`/shopping-lists/${LIST_ID}?qtyError=i2`);
  });

  it('writes nothing for an empty name', async () => {
    const save = await action('saveListAction');
    const to = await redirectOf(() => save(typed({ name: '  ', quantities: { i1: ['5', 4] } })));
    expect(updateShoppingList).not.toHaveBeenCalled();
    expect(to).toBe(`/shopping-lists/${LIST_ID}?error=NAME_REQUIRED`);
  });

  it('carries SAVE_FAILED for a refusal it cannot name, and the API code it can', async () => {
    const save = await action('saveListAction');
    updateFailure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    expect(await redirectOf(() => save(typed({ quantities: { i1: ['5', 4] } })))).toBe(
      `/shopping-lists/${LIST_ID}?error=SAVE_FAILED`,
    );
    updateFailure = new StorefrontApiError(404, 'NOT_FOUND', 'Shopping list item not found.');
    expect(await redirectOf(() => save(typed({ quantities: { i1: ['5', 4] } })))).toBe(
      `/shopping-lists/${LIST_ID}?error=NOT_FOUND`,
    );
  });

  it('says the changes were saved, in both languages', async () => {
    expect(await html({ status: 'saved' })).toMatch(/role="status"[^>]*>Changes saved.</);
    locale = 'pl-PL';
    expect(await html({ status: 'saved' })).toMatch(/role="status"[^>]*>Zapisano zmiany.</);
  });
});

describe('a conversion pressed with unsaved quantities converts the typed ones', () => {
  it.each([
    ['convertAllToCartAction', 'toCart', undefined],
    ['convertSelectedToCartAction', 'toCart', ['i1', 'i2']],
    ['convertAllToRfqAction', 'toRfq', undefined],
    ['convertSelectedToRfqAction', 'toRfq', ['i1', 'i2']],
  ] as const)('%s saves first, then converts', async (name, target, itemIds) => {
    const run = await action(name);
    const data = typed({ quantities: { i1: ['15', 4], i2: ['2', 2], i3: ['30', 9] } });
    for (const id of itemIds ?? []) data.append('itemIds', id);
    const to = await redirectOf(() => run(data));
    expect(calls).toEqual(['update', target]);
    expect(updateShoppingList).toHaveBeenCalledWith('session-cookie', LIST_ID, {
      items: [
        { id: 'i1', quantity: 15 },
        { id: 'i3', quantity: 30 },
      ],
    });
    const convert = target === 'toCart' ? convertShoppingListToCart : convertShoppingListToRfq;
    expect(convert).toHaveBeenCalledWith('session-cookie', LIST_ID, ...(itemIds ? [itemIds] : []));
    expect(to).toContain(target === 'toCart' ? 'cartAdded=3' : 'rfqAdded=2');
  });

  it('converts straight away when nothing was edited', async () => {
    const run = await action('convertAllToCartAction');
    await redirectOf(() => run(typed({ quantities: { i1: ['4', 4] } })));
    expect(calls).toEqual(['toCart']);
  });

  it('converts for a member who may not edit, whose form carries no quantities', async () => {
    const run = await action('convertAllToRfqAction');
    await redirectOf(() => run(form({ listId: LIST_ID })));
    expect(calls).toEqual(['toRfq']);
  });

  it('does not convert when the save is refused', async () => {
    const run = await action('convertAllToCartAction');
    updateFailure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    const to = await redirectOf(() => run(typed({ quantities: { i1: ['15', 4] } })));
    expect(calls).toEqual(['update']);
    expect(to).toBe(`/shopping-lists/${LIST_ID}?error=SAVE_FAILED`);
  });

  it('does not convert when a typed quantity is refused', async () => {
    const run = await action('convertAllToRfqAction');
    const to = await redirectOf(() => run(typed({ quantities: { i1: ['abc', 4] } })));
    expect(calls).toEqual([]);
    expect(to).toBe(`/shopping-lists/${LIST_ID}?qtyError=i1`);
  });
});
