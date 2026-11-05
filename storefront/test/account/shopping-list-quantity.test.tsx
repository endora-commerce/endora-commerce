import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseListQuantity } from '../../lib/shoppingListQuantity';

/**
 * Feature 155, U4 (owner ruling S8 A) — the shopping list's quantity input. Its native `min`
 * made the browser refuse a 0 with its own bubble, worded in the browser's language. As on the
 * cart, the form asks the browser not to validate and the page says what is wrong beside the
 * field, in the page's language.
 *
 * No minimum hint: a list holds any positive quantity (`contracts/shopping-lists.ts`); the
 * minimum binds when the list moves to the cart, where a short line is reported with it
 * (FR-011).
 */
let locale = 'en-US';

// Offline (170 WP-10): the page reads the member's role through `/api/v1/me`; answered here
// for a member whose role allows every commerce action, so the page renders as it always did.
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      organizationRole: { id: 'role-admin', kind: 'administrator', name: 'Administrator' },
      permissions: [
        'carts.create',
        'quote_requests.create',
        'shopping_lists.create',
        'shopping_lists.convert',
      ],
    },
    organization: null,
    impersonation: null,
  }),
}));
vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: {} }),
}));
vi.mock('../../lib/api/shopping-lists', () => ({
  getShoppingList: async () => ({
    id: 'l1',
    name: 'Site A',
    items: [{ id: 'i1', productId: 'p1', variantId: null, quantity: 4, note: null }],
  }),
  clearShoppingListItems: async () => undefined,
  convertShoppingListToCart: async () => ({ added: 0, skipped: [] }),
  convertShoppingListToRfq: async () => ({ rfqId: 'r', added: 0, skipped: [] }),
  removeShoppingListItem: async () => undefined,
  renameShoppingList: async () => undefined,
  updateShoppingListItem: async () => undefined,
}));
vi.mock('../../lib/api/catalog', () => ({
  getProductBySlug: async () => ({ name: 'Bolt', sku: 'BOLT-1', slug: 'bolt' }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { default: ShoppingListDetailPage } = await import('../../app/(account)/shopping-lists/[id]/page');

async function render(sp: Record<string, string>): Promise<string> {
  const tree = await ShoppingListDetailPage({
    params: Promise.resolve({ id: '00000000-0000-4000-8000-0000000000f1' }),
    searchParams: Promise.resolve(sp),
  });
  return renderToString(<>{tree}</>);
}

function qtyInput(html: string): string {
  const match = /<input[^>]*name="quantity"[^>]*>/.exec(html);
  expect(match).not.toBeNull();
  return match![0];
}

beforeEach(() => {
  locale = 'en-US';
});

describe('parseListQuantity', () => {
  it('accepts a whole number from 1 to 9999', () => {
    expect(parseListQuantity('1')).toBe(1);
    expect(parseListQuantity(' 12 ')).toBe(12);
    expect(parseListQuantity('9999')).toBe(9999);
  });

  it.each(['0', '-3', '2.5', '', 'abc', '10000', null])('refuses %j', (raw) => {
    expect(parseListQuantity(raw)).toBeNull();
  });
});

describe('shopping list — quantity input', () => {
  it('asks the browser not to validate the quantity form', () => {
    const page = readFileSync(resolve(import.meta.dirname, '../../app/(account)/shopping-lists/[id]/page.tsx'), 'utf8');
    expect(page).toMatch(/<form id=\{`sl-qty-\$\{it\.id\}`\} action=\{updateQtyAction\} noValidate>/);
    expect(page).toContain('parseListQuantity(formData.get(\'quantity\'))');
  });

  it.each([
    ['en-US', 'Quantity', 'Enter a whole number from 1 to 9999.', 'Save'],
    ['pl-PL', 'Ilość', 'Wpisz liczbę całkowitą od 1 do 9999.', 'Zapisz'],
  ])('%s: names the input, its save button, and words a refused quantity beside it', async (tag, label, message, save) => {
    locale = tag;
    const idle = await render({});
    expect(qtyInput(idle)).toContain(`aria-label="${label}"`);
    expect(idle).toMatch(new RegExp(`<button type="submit" form="sl-qty-i1"[^>]*>${save}</button>`));
    expect(qtyInput(idle)).not.toContain('aria-invalid');
    expect(idle).not.toContain(message);

    const refused = await render({ qtyError: 'i1' });
    const input = qtyInput(refused);
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="sl-qty-error-i1"');
    expect(refused).toMatch(new RegExp(`<p id="sl-qty-error-i1" role="status"[^>]*>${message}</p>`));
  });

  it('states no minimum beside the input', async () => {
    const html = await render({});
    expect(html).not.toContain('Minimum');
  });
});
