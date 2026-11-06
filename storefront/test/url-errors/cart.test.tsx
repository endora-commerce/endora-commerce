import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { CartSummary } from '../../lib/api/cart';
import { StorefrontApiError } from '../../lib/api/client';
import { visibleText } from '../account/i18n/text';
import { actionsOf, form, redirectOf } from './actions';

/**
 * Issue #745 — `/cart`'s `?error=` (its own actions', and the product page's
 * grouped, bundle and one-click actions', which land here) carries a code. A
 * crafted value never reaches the page; each known code reads in the page's
 * language.
 */

let locale = 'en-US';
let failure: Error | null = null;
let couponResult: unknown = null;

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session',
  getAnonCartCookie: async () => null,
  setAnonCartCookie: async () => undefined,
}));
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
vi.mock('../../lib/api/cart', () => ({
  CART_UNAVAILABLE: 'cart-unavailable',
  getCart: async () => ({ cart: basket() }),
  getCartUpsells: async () => [],
  touchCart: async () => undefined,
  removeCartItem: refuse,
  updateCartItem: refuse,
  applyCartCoupon: async () => couponResult ?? refuse(),
  clearCartCoupon: async () => undefined,
  convertCartToQuoteRequest: refuse,
  submitCartForApproval: refuse,
  saveCartItemToShoppingList: async () => {
    if (failure) throw failure;
  },
}));
vi.mock('../../lib/api/shopping-lists', () => ({
  listShoppingLists: async () => [{ id: 'sl1', name: 'Mine', isDefault: false }],
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      organizationRole: { id: 'role-1', kind: 'administrator', name: 'Administrator' },
      permissions: ['carts.create', 'quote_requests.create', 'shopping_lists.create', 'carts.order_without_approval'],
    },
    organization: { name: 'Acme', canTransact: true, status: 'active', moderationMessage: null },
  }),
}));
vi.mock('../../lib/api/pricing', () => ({
  PRICING_UNAVAILABLE: 'pricing-unavailable',
  getProductDisplayMode: async () => ({ displayMode: 'net_only' }),
}));

const { default: CartPage } = await import('../../app/(commerce)/cart/page');

function basket(): CartSummary {
  return {
    id: 'c1',
    customerAccountId: 'acc-1',
    organizationId: 'org-1',
    anonymousCartToken: null,
    items: [
      {
        id: 'l1',
        productId: 'p1',
        variantId: null,
        quantity: 12,
        unitPrice: { amount: 10, currency: 'PLN' },
        productName: 'Bolt',
        productSku: 'BOLT-1',
      },
      {
        id: 'l2',
        productId: 'p2',
        variantId: null,
        quantity: 3,
        unitPrice: { amount: 10, currency: 'PLN' },
        productName: 'Nut',
        productSku: 'NUT-1',
        packagingUnitName: 'Pallet',
      },
    ],
    itemCount: 2,
    subtotal: { amount: 150, currency: 'PLN' },
    status: 'active',
    approvalStatus: 'not_required',
    primaryCta: 'checkout',
  };
}

async function tree(sp: Record<string, string> = {}): Promise<unknown> {
  return CartPage({ searchParams: Promise.resolve(sp) });
}

async function text(sp: Record<string, string>): Promise<string> {
  return visibleText(renderToString(<>{(await tree(sp)) as React.ReactNode}</>));
}

async function action(name: string): Promise<(data: FormData) => unknown> {
  const found = actionsOf(await tree()).get(name);
  if (!found) throw new Error(`the cart page hands no ${name}`);
  return found as (data: FormData) => unknown;
}

beforeEach(() => {
  locale = 'en-US';
  failure = null;
  couponResult = null;
});

describe('a crafted ?error= never reaches the cart page', () => {
  it.each(['QA 745: dowolny tekst z linku', 'SOMETHING_ELSE', 'constructor'])('%s', async (crafted) => {
    const out = await text({ error: crafted });
    expect(out).not.toContain(crafted);
    expect(out).toContain('Something went wrong with your cart. Please try again.');
  });

  it('nor beside a line', async () => {
    const out = await text({ errorItem: 'l1', error: 'Wpisz 10 000 szt., aby wygrać', typed: '4' });
    expect(out).not.toContain('Wpisz 10 000 szt.');
    expect(out).toContain('Something went wrong with your cart. Please try again.');
  });
});

describe('each known code reads in English and Polish', () => {
  it.each([
    ['REMOVE_FAILED', 'Could not remove the line. Please try again.', 'Nie udało się usunąć pozycji. Spróbuj ponownie.'],
    ['MISSING_PRODUCT', 'Could not add the product to the cart.', 'Nie udało się dodać produktu do koszyka.'],
    [
      'CART_PRODUCT_QUOTE_ONLY',
      'This product is sold on request only, so it cannot be added to the cart. Ask for a quote instead.',
      'Ten produkt jest sprzedawany wyłącznie na zapytanie, dlatego nie można dodać go do koszyka. Wyślij zapytanie ofertowe.',
    ],
    [
      'SALES_CHANNEL_NOT_PERMITTED',
      'This account does not have access to this store.',
      'To konto nie ma dostępu do tego sklepu.',
    ],
    [
      'STOCK_UNAVAILABLE',
      'A product is not available in the quantity ordered. Reduce the quantity or remove the product from the order.',
      'Produkt nie jest dostępny w zamówionej ilości. Zmniejsz ilość albo usuń produkt z zamówienia.',
    ],
  ])('%s', async (code, en, pl) => {
    expect(await text({ error: code })).toContain(en);
    locale = 'pl-PL';
    expect(await text({ error: code })).toContain(pl);
  });

  it('a line below its minimum reads the minimum the action carried, beside that line', async () => {
    const sp = { errorItem: 'l1', error: 'PRODUCT_BELOW_MINIMUM_QUANTITY', min: '10', typed: '4' };
    expect(await text(sp)).toContain('Below the minimum (10 pcs)');
    locale = 'pl-PL';
    expect(await text(sp)).toContain('Poniżej minimum (10 szt.)');
  });

  it('a packaging-unit minimum names the line’s own unit', async () => {
    const sp = { errorItem: 'l2', error: 'PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY', min: '2' };
    expect(await text(sp)).toContain('Below the minimum (2 × Pallet)');
  });

  it('a minimum that is not a whole number reads as the bare minimum sentence', async () => {
    const out = await text({ errorItem: 'l1', error: 'PRODUCT_BELOW_MINIMUM_QUANTITY', min: '10 pcs, call 555' });
    expect(out).not.toContain('call 555');
    expect(out).toContain('Below the minimum order quantity');
  });
});

describe('the cart’s actions redirect with a code, never a sentence', () => {
  it('remove carries REMOVE_FAILED for a refusal the page cannot name', async () => {
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    const remove = await action('removeAction');
    expect(await redirectOf(() => remove(form({ itemId: 'l1' })))).toBe('/cart?error=REMOVE_FAILED');
  });

  it('a quantity edit below the minimum carries the code, the line and the minimum', async () => {
    failure = new StorefrontApiError(422, 'PRODUCT_BELOW_MINIMUM_QUANTITY', '"Bolt" has a minimum order quantity of 10 pcs.', undefined, {
      productName: 'Bolt',
      minimum: 10,
    });
    const update = await action('updateAction');
    const to = await redirectOf(() => update(form({ itemId: 'l1', quantity: '4' })));
    const params = Object.fromEntries(new URL(to, 'http://x').searchParams);
    expect(params).toEqual({ errorItem: 'l1', error: 'PRODUCT_BELOW_MINIMUM_QUANTITY', min: '10', typed: '4' });
  });

  it('submit for approval carries the API code it names', async () => {
    failure = new StorefrontApiError(409, 'CART_APPROVAL_ALREADY_SUBMITTED', 'Ten koszyk został już wysłany do akceptacji.');
    const submit = await action('submitForApprovalAction');
    expect(await redirectOf(() => submit(form({})))).toBe('/cart?error=CART_APPROVAL_ALREADY_SUBMITTED');
  });

  it('convert carries CONVERT_FAILED for a transport error', async () => {
    const convert = await action('convertToQrAction');
    expect(await redirectOf(() => convert(form({})))).toBe('/cart?error=CONVERT_FAILED');
  });
});

/**
 * Issue #790 — `?listAdded=` carried the list's name, so a crafted link put any text in the
 * cart's confirmation. It carries the list's id; the page reads the name of the buyer's own list.
 */
describe('?listAdded= carries a list id, never a name (issue #790)', () => {
  it('a crafted name never reaches the page', async () => {
    const out = await text({ listAdded: 'Zadzwoń pod 555 000 111, aby odebrać rabat' });
    expect(out).not.toContain('Zadzwoń pod 555');
    expect(out).not.toContain('Saved line to your');
  });

  it('the id of one of the buyer’s lists reads that list’s name', async () => {
    expect(await text({ listAdded: 'sl1' })).toContain('Saved line to your "Mine" list.');
    locale = 'pl-PL';
    expect(await text({ listAdded: 'sl1' })).toContain('Pozycja została zapisana na liście „Mine”.');
  });

  it('save to list redirects with the list id', async () => {
    const save = await action('saveToListAction');
    expect(await redirectOf(() => save(form({ itemId: 'l1' })))).toBe('/cart?listAdded=sl1');
  });
});

/**
 * Issue #791 — the cart's banner and its coupon refusal read their figures as
 * typed values, validated when read; a value out of shape is dropped, never
 * rendered as `NaN` or handed to `Intl`.
 */
describe('the cart reads a refusal’s figures as typed values (issue #791)', () => {
  it('a minimum refusal from outside the line (the product page) names the minimum in the banner', async () => {
    const sp = { error: 'PRODUCT_BELOW_MINIMUM_QUANTITY', min: '10' };
    expect(await text(sp)).toContain('A product is below its minimum order quantity (10 pcs). Increase the quantity and try again.');
    locale = 'pl-PL';
    expect(await text(sp)).toContain(
      'Ilość produktu jest poniżej minimalnej ilości zamówienia (10 szt.). Zwiększ ilość i spróbuj ponownie.',
    );
  });

  it('a credit-limit refusal (one-click buy) names both amounts in the banner', async () => {
    const sp = { error: 'LIMIT_INSUFFICIENT', available: '99.50', total: '120.00', currency: 'EUR' };
    expect(await text(sp)).toContain('The available credit limit (€99.50) does not cover this order (€120.00).');
  });

  it('a minimum out of shape reads as the bare sentence in the banner', async () => {
    const out = await text({ error: 'PRODUCT_BELOW_MINIMUM_QUANTITY', min: '0' });
    expect(out).toContain('A product is below its minimum order quantity. Increase the quantity and try again.');
  });

  it('a valid coupon shortfall reads as an amount', async () => {
    const sp = { couponError: 'below_min_spend', couponShortfall: '25.50', couponShortfallCurrency: 'PLN' };
    expect(await text(sp)).toContain('Add PLN 25.50 more to unlock this coupon.');
  });

  it.each([
    ['abc', 'PLN'],
    ['NaN', 'PLN'],
    ['Infinity', 'PLN'],
    ['-5', 'PLN'],
    ['1e3', 'PLN'],
    ['25.50', 'pln'],
    ['25.50', 'ZZZZ'],
    ['25.50', '$$$'],
    ['25.50', 'Zadzwoń'],
  ])('a shortfall of %s %s is dropped, never rendered', async (amount, currency) => {
    const out = await text({ couponError: 'below_min_spend', couponShortfall: amount, couponShortfallCurrency: currency });
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('Zadzwoń');
    expect(out).not.toContain('Add PLN');
    expect(out).toContain('Add more to your cart to unlock this coupon.');
  });

  it('the coupon action carries the shortfall only when it is in shape', async () => {
    const apply = await action('applyCouponAction');
    couponResult = { outcome: 'rejected', reason: 'below_min_spend', shortfall: { amount: 25.5, currency: 'PLN' } };
    expect(await redirectOf(() => apply(form({ code: 'SPRING' })))).toBe(
      '/cart?couponError=below_min_spend&couponShortfall=25.5&couponShortfallCurrency=PLN',
    );
    couponResult = { outcome: 'rejected', reason: 'below_min_spend', shortfall: { amount: 25.5, currency: 'zł' } };
    expect(await redirectOf(() => apply(form({ code: 'SPRING' })))).toBe('/cart?couponError=below_min_spend');
  });
});

/**
 * Architect ruling on PR #805, round 2 (Q4) — `?typed=` is read only when it is a whole
 * quantity (`^[1-9]\d{0,8}$`, the `min=` rule from #783); anything else is ignored.
 */
describe('?typed= is read only as a whole quantity (issue #790)', () => {
  async function html(sp: Record<string, string>): Promise<string> {
    return renderToString(<>{(await tree(sp)) as React.ReactNode}</>);
  }

  it('a crafted value never reaches the quantity field', async () => {
    const out = await html({ errorItem: 'l1', error: 'QUANTITY_INVALID', typed: '"><b>Zadzwoń pod 555</b>' });
    expect(out).not.toContain('Zadzwoń');
    expect(out).toContain('value="12"');
  });

  it.each(['0', '-3', '1.5', '1e3', '0012', '1234567890'])('%s is ignored', async (typed) => {
    expect(await html({ errorItem: 'l1', error: 'QUANTITY_INVALID', typed })).not.toContain(`value="${typed}"`);
  });

  it('a whole quantity is kept in its field', async () => {
    expect(await html({ errorItem: 'l1', error: 'QUANTITY_INVALID', typed: '7' })).toContain('value="7"');
  });
});
