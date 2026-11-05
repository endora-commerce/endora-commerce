import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ShoppingList } from '../../lib/api/shopping-lists';
import { tForLocale } from '../../lib/i18n/messages';
import { CartLine, type CartLineViewModel } from '../../components/CartLine';
import {
  cardActionVisibility,
  commerceAbilities,
  memberSession,
  VISITOR_ABILITIES,
} from '../../lib/commerce-permissions';

/**
 * `specs/170-organization-roles/` T100 (FR-030, FR-040, FR-047, FR-048, FR-051, FR-057; owner
 * rulings PR-4 and Q2(b); research R-12, R-35) — every commerce action a signed-in member's role
 * does not allow is hidden or disabled, and a signed-out visitor keeps add-to-cart and cart
 * editing exactly as before.
 *
 * The rule has one spelling (`lib/commerce-permissions.ts`, over `can(session, code)`), and the
 * pages are rendered with their reads mocked so the tests see what a member is actually offered:
 * the product page, the quick-order page and the shopping-list pages. The cart page's half is in
 * `test/checkout/cart-approval-submit.test.tsx`, which already renders that page.
 */

const en = tForLocale('en-US');

// ── the session the pages read ────────────────────────────────────────────

let sessionCookie: string | null = 'session';
let permissions: string[] | null = [];

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => sessionCookie,
  getAnonCartCookie: async () => null,
  setAnonCartCookie: async () => undefined,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'b2b_session' && sessionCookie ? { value: sessionCookie } : undefined),
  }),
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      id: 'member-1',
      email: 'member@example.test',
      organizationRole: { id: 'role-1', kind: 'custom', name: 'Buyer' },
      permissions: permissions ?? undefined,
    },
    organization: { name: 'Acme', canTransact: true, status: 'active', moderationMessage: null, isPersonal: false },
    impersonation: null,
  }),
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale: 'en-US', ctx: { salesChannelCode: 'web' }, modules: { isPresent: () => true, presentIds: [], absentIds: [] } }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  permanentRedirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

// ── the product page's reads ──────────────────────────────────────────────

let oneClick: { enabled: boolean; reason?: string } = { enabled: false, reason: 'permission_required' };
let showAddToQuoteOnPdp = true;
let product: Record<string, unknown> = {};

vi.mock('../../app/(catalog)/p/[slug]/resolution', () => ({
  productIdForKey: async () => 'p1',
  productById: async () => product,
  alternateLanguages: () => null,
}));
vi.mock('../../lib/api/rfq', () => ({
  getStorefrontQuoteRequestSettings: async () => ({ showAddToQuoteOnPdp }),
}));
vi.mock('../../lib/api/inventory', () => ({ getStorefrontProductStock: async () => null }));
vi.mock('../../lib/api/pricing', () => ({
  PRICING_UNAVAILABLE: 'pricing-unavailable',
  getResolvedPrice: async () => 'pricing-unavailable',
}));
vi.mock('../../lib/api/cart', () => ({ addCartItem: async () => ({}) }));
vi.mock('../../lib/api/quick-order', () => ({
  getOneClickEligibility: async () => oneClick,
  placeOneClickOrder: async () => ({}),
  searchProducts: async () => [],
  buildQuickOrder: async () => ({}),
  importQuickOrderCsv: async () => ({}),
  importQuickOrderFile: async () => ({}),
}));
vi.mock('../../components/Hook', () => ({ Hook: () => null }));

// ── the shopping-list pages' reads ────────────────────────────────────────

const list: ShoppingList = {
  id: 'l1',
  organizationId: 'org-1',
  customerAccountId: 'member-1',
  name: 'Site A',
  isDefault: false,
  items: [{ id: 'i1', productId: 'p1', variantId: null, quantity: 4, note: null }] as ShoppingList['items'],
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};
vi.mock('../../lib/api/shopping-lists', () => ({
  listShoppingLists: async () => [list],
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
vi.mock('../../lib/api/catalog', () => ({
  getProductBySlug: async () => ({ name: 'Bolt', sku: 'BOLT-1', slug: 'bolt' }),
  resolveProductKey: async () => ({ kind: 'product', productId: 'p1' }),
}));

const { default: ProductPage } = await import('../../app/(catalog)/p/[slug]/page');
const { default: QuickOrderPage } = await import('../../app/(account)/quick-order/page');
const { default: ShoppingListsPage } = await import('../../app/(account)/shopping-lists/page');
const { default: ShoppingListDetailPage } = await import('../../app/(account)/shopping-lists/[id]/page');

function html(node: unknown): string {
  return renderToString(<>{node as React.ReactNode}</>).replaceAll('<!-- -->', '');
}

function simpleProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    slug: 'bolt',
    name: 'Bolt',
    sku: 'BOLT-1',
    type: 'simple',
    categories: [],
    variants: [],
    assets: [],
    gallery: null,
    primaryAssetUrl: null,
    price: { amount: 10, currency: 'PLN' },
    resolvedPrice: {
      basePrice: { amount: '10.0000', currency: 'PLN' },
      salePrice: null,
      displayMode: 'net_only',
    },
    packagingUnits: [],
    minOrderQuantity: null,
    description: null,
    attributeValues: {},
    links: null,
    paths: { canonical: '/p/bolt' },
    structuredDataJsonLd: {},
    ...overrides,
  };
}

async function renderPdp(): Promise<string> {
  return html(await ProductPage({ params: Promise.resolve({ slug: 'bolt' }) }));
}

const ALL = [
  'carts.create',
  'quote_requests.create',
  'shopping_lists.create',
  'shopping_lists.convert',
  'quick_order.one_click',
  'carts.order_without_approval',
];
const without = (...codes: string[]): string[] => ALL.filter((c) => !codes.includes(c));

beforeEach(() => {
  sessionCookie = 'session';
  permissions = [...ALL];
  oneClick = { enabled: false, reason: 'permission_required' };
  showAddToQuoteOnPdp = true;
  product = simpleProduct();
});

// ── the rule ──────────────────────────────────────────────────────────────

describe('commerceAbilities — one spelling of what a member may do', () => {
  it('a signed-out visitor keeps add-to-cart and cart editing (PR-4, R-35)', () => {
    expect(commerceAbilities(null)).toEqual(VISITOR_ABILITIES);
    expect(VISITOR_ABILITIES.editCart).toBe(true);
  });

  it('a signed-in member is judged per code, exact match', () => {
    const a = commerceAbilities({ permissions: ['shopping_lists.create'] });
    expect(a).toEqual({
      editCart: false,
      requestQuote: false,
      editShoppingLists: true,
      convertListToCart: false,
      convertListToQuote: false,
      useQuickOrder: false,
    });
  });

  it('a session that answers no permissions can nothing', () => {
    expect(commerceAbilities({}).editCart).toBe(false);
    expect(commerceAbilities({ permissions: null }).requestQuote).toBe(false);
  });

  it('a list conversion needs `shopping_lists.convert` and the target’s create code (FR-048)', () => {
    expect(commerceAbilities({ permissions: ['shopping_lists.convert'] }).convertListToCart).toBe(false);
    expect(
      commerceAbilities({ permissions: ['shopping_lists.convert', 'carts.create'] }).convertListToCart,
    ).toBe(true);
    expect(
      commerceAbilities({ permissions: ['shopping_lists.convert', 'carts.create'] }).convertListToQuote,
    ).toBe(false);
    expect(
      commerceAbilities({ permissions: ['shopping_lists.convert', 'quote_requests.create'] }).convertListToQuote,
    ).toBe(true);
  });

  it('quick order is open to `carts.create` OR `quote_requests.create` (owner ruling Q2(b))', () => {
    expect(commerceAbilities({ permissions: ['carts.create'] }).useQuickOrder).toBe(true);
    expect(commerceAbilities({ permissions: ['quote_requests.create'] }).useQuickOrder).toBe(true);
    expect(commerceAbilities({ permissions: ['shopping_lists.create'] }).useQuickOrder).toBe(false);
  });

  it('memberSession reads the customer of `/api/v1/me`, and nothing for no answer', () => {
    expect(memberSession(null)).toBeNull();
    const session = memberSession({
      customerAccount: { permissions: ['carts.create'], organizationRole: { kind: 'member' } },
    });
    expect(session?.permissions).toEqual(['carts.create']);
    expect(session?.organizationRole?.kind).toBe('member');
  });
});

describe('cardActionVisibility — the product card’s three buttons', () => {
  const allOn = { showAddToCart: true, showAddToShoppingList: true, showAddToQuote: true };

  it('keeps every switched-on button for a visitor', () => {
    expect(cardActionVisibility(allOn, VISITOR_ABILITIES, true)).toEqual({ cart: true, list: true, quote: true });
  });

  it('drops each button the member’s role does not allow', () => {
    expect(
      cardActionVisibility(allOn, commerceAbilities({ permissions: ['quote_requests.create'] }), true),
    ).toEqual({ cart: false, list: false, quote: true });
  });

  it('still honours the settings toggles and a non-buyable product', () => {
    expect(
      cardActionVisibility({ ...allOn, showAddToQuote: false }, VISITOR_ABILITIES, false),
    ).toEqual({ cart: false, list: true, quote: false });
  });
});

// ── the cart line ─────────────────────────────────────────────────────────

describe('CartLine — read-only for a member without `carts.create`', () => {
  const line: CartLineViewModel = {
    id: 'l1',
    productId: 'p1',
    variantId: null,
    quantity: 3,
    unitPrice: { amount: 10, currency: 'PLN' },
    lineTotal: { amount: 30, currency: 'PLN' },
    productName: 'Bolt',
  };
  const strings = {
    qtyLabel: 'Quantity',
    unitPriceLabel: 'Unit price',
    lineTotalLabel: 'Line total',
    removeLabel: 'Remove',
    saveToListLabel: 'Save to list',
    netSuffix: 'net',
    grossSuffix: 'gross',
    unavailable: { out_of_stock: 'oos', not_purchasable: 'np', no_price_in_customer_list: 'nop' },
  };
  const noop = async (): Promise<void> => undefined;
  const render = (props: { editable?: boolean; canSaveToList?: boolean }): string =>
    html(
      <CartLine
        line={line}
        updateAction={noop}
        removeAction={noop}
        saveToListAction={noop}
        locale="en-US"
        strings={strings}
        {...props}
      />,
    );

  it('offers the stepper and remove by default', () => {
    const out = render({});
    expect(out).toContain('name="step"');
    expect(out).toContain('aria-label="Remove"');
    expect(out).toContain('Save to list');
  });

  it('shows the quantity without a stepper or remove when not editable', () => {
    const out = render({ editable: false });
    expect(out).not.toContain('name="step"');
    expect(out).not.toContain('name="quantity"');
    expect(out).not.toContain('aria-label="Remove"');
    expect(out).toContain('>3<');
  });

  it('drops save-to-list for a member without `shopping_lists.create`', () => {
    expect(render({ canSaveToList: false })).not.toContain('Save to list');
  });
});

// ── the product page ──────────────────────────────────────────────────────

describe('product page — actions per the member’s role (FR-057)', () => {
  const addToCart = `>${en('product.addToCart')}<`;
  const addToQuote = en('product.quote.add');
  const addToList = en('card.list.add');
  const buyOneClick = en('commerce.pdp.oneClick');

  it('a signed-out visitor still sees add-to-cart (PR-4)', async () => {
    sessionCookie = null;
    const out = await renderPdp();
    expect(out).toContain(addToCart);
    expect(out).toContain(addToQuote);
  });

  it('a member holding every code sees every action', async () => {
    const out = await renderPdp();
    expect(out).toContain(addToCart);
    expect(out).toContain(addToQuote);
    expect(out).toContain(addToList);
  });

  it('hides add-to-cart without `carts.create`', async () => {
    permissions = without('carts.create');
    const out = await renderPdp();
    expect(out).not.toContain(addToCart);
    expect(out).toContain(addToQuote);
  });

  it('hides add-to-quote without `quote_requests.create`', async () => {
    permissions = without('quote_requests.create');
    const out = await renderPdp();
    expect(out).toContain(addToCart);
    expect(out).not.toContain(addToQuote);
  });

  it('hides the shopping-list button without `shopping_lists.create`', async () => {
    permissions = without('shopping_lists.create');
    expect(await renderPdp()).not.toContain(addToList);
  });

  it('hides the quote-only CTA without `quote_requests.create`', async () => {
    product = simpleProduct({
      price: null,
      resolvedPrice: { basePrice: null, salePrice: null, displayMode: 'none' },
    });
    expect(await renderPdp()).toContain(addToQuote);
    permissions = without('quote_requests.create');
    expect(await renderPdp()).not.toContain(addToQuote);
  });

  it('does not render the one-click button when eligibility answers disabled (FR-051)', async () => {
    oneClick = { enabled: false, reason: 'permission_required' };
    expect(await renderPdp()).not.toContain(buyOneClick);
    oneClick = { enabled: false, reason: 'cart_approval_required' };
    expect(await renderPdp()).not.toContain(buyOneClick);
    oneClick = { enabled: true };
    expect(await renderPdp()).toContain(buyOneClick);
  });

  it('hides the grouped add-to-cart without `carts.create`', async () => {
    product = simpleProduct({
      type: 'grouped',
      groupedItems: [
        {
          id: 'g1',
          position: 0,
          quantity: 1,
          product: { id: 'p2', sku: 'NUT-1', slug: 'nut', name: 'Nut', primaryAssetUrl: null, price: null },
        },
      ],
    });
    const grouped = en('product.grouped.addBundleToCart');
    expect(await renderPdp()).toContain(grouped);
    permissions = without('carts.create');
    expect(await renderPdp()).not.toContain(grouped);
  });
});

// ── quick order ───────────────────────────────────────────────────────────

describe('quick-order page — open to `carts.create` OR `quote_requests.create` (Q2(b))', () => {
  const preview = Buffer.from(
    JSON.stringify({
      recognized: [{ line: 1, sku: 'BOLT-1', productId: 'p1', variantId: null, quantity: 4 }],
      rejected: [],
      summary: { recognizedCount: 1, rejectedCount: 0, mergedCount: 0, truncated: false },
    }),
    'utf8',
  ).toString('base64url');
  const render = async (sp: Record<string, string> = {}): Promise<string> =>
    html(await QuickOrderPage({ searchParams: Promise.resolve(sp) }));
  const addAll = `>${en('quickOrder.preview.addAll')}</button>`;
  const sendQuote = `>${en('quickOrder.preview.sendAsQuote')}</button>`;
  const importButton = `>${en('quickOrder.page.preview')}</button>`;
  const barAdd = en('quickOrder.bar.addToCart').replace('{count}', '1');

  it('a member with both codes gets the import and both targets', async () => {
    const out = await render({ preview });
    expect(out).toContain(importButton);
    expect(out).toContain(addAll);
    expect(out).toContain(sendQuote);
    expect(out).toContain(barAdd);
  });

  it('a quote-only member keeps the import and loses the cart target', async () => {
    permissions = without('carts.create');
    const out = await render({ preview });
    expect(out).toContain(importButton);
    expect(out).not.toContain(addAll);
    expect(out).not.toContain(barAdd);
    expect(out).toContain(sendQuote);
  });

  it('a cart-only member keeps the import and loses the quote target', async () => {
    permissions = without('quote_requests.create');
    const out = await render({ preview });
    expect(out).toContain(importButton);
    expect(out).toContain(addAll);
    expect(out).not.toContain(sendQuote);
  });

  it('a member with neither code is told why, and offered no import', async () => {
    permissions = without('carts.create', 'quote_requests.create');
    const out = await render({ preview });
    expect(out).toContain(en('commerce.quickOrder.notAllowed'));
    expect(out).not.toContain(importButton);
    expect(out).not.toContain(addAll);
    expect(out).not.toContain(sendQuote);
  });
});

// ── shopping lists ────────────────────────────────────────────────────────

describe('shopping-list pages — editing and conversions per the member’s role (FR-047, FR-048)', () => {
  const renderIndex = async (): Promise<string> =>
    html(await ShoppingListsPage({ searchParams: Promise.resolve({}) }));
  const renderDetail = async (): Promise<string> =>
    html(await ShoppingListDetailPage({ params: Promise.resolve({ id: '00000000-0000-4000-8000-0000000000f1' }), searchParams: Promise.resolve({}) }));
  const createList = `>${en('account.shoppingLists.create.submit')}</button>`;
  const rename = `>${en('account.shoppingList.rename.submit')}</button>`;
  const toCart = en('account.shoppingList.toCart.all');
  const toQuote = en('account.shoppingList.toQuote.all');
  const readOnly = en('commerce.shoppingLists.readOnlyNote');

  it('a member holding every code may create, rename and convert', async () => {
    expect(await renderIndex()).toContain(createList);
    const detail = await renderDetail();
    expect(detail).toContain(rename);
    expect(detail).toContain(toCart);
    expect(detail).toContain(toQuote);
    expect(detail).not.toContain(readOnly);
  });

  it('without `shopping_lists.create` the lists are read-only and say so', async () => {
    permissions = without('shopping_lists.create');
    const index = await renderIndex();
    expect(index).not.toContain(createList);
    expect(index).toContain(readOnly);
    const detail = await renderDetail();
    expect(detail).not.toContain(rename);
    expect(detail).not.toContain(`>${en('account.common.remove')}</button>`);
    expect(detail).toContain(readOnly);
  });

  it('without `shopping_lists.convert` no conversion is offered', async () => {
    permissions = without('shopping_lists.convert');
    const detail = await renderDetail();
    expect(detail).not.toContain(toCart);
    expect(detail).not.toContain(toQuote);
  });

  it('each conversion also needs its target’s create code', async () => {
    permissions = without('carts.create');
    let detail = await renderDetail();
    expect(detail).not.toContain(toCart);
    expect(detail).toContain(toQuote);
    permissions = without('quote_requests.create');
    detail = await renderDetail();
    expect(detail).toContain(toCart);
    expect(detail).not.toContain(toQuote);
  });
});
