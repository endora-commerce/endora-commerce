import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { ProductSummary } from '@endora-commerce/contracts';
import type { ModulePresenceSet } from '../../lib/api/module-presence';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Issue #672 — Principle XVII, item 5: a module that is off contributes no
 * storefront element. Issue #666 gated the navigation; the in-page actions the
 * same modules contribute were still rendered whatever presence said, so a
 * buyer was offered "Add to shopping list", "Add to comparison" and "Add to
 * quote" against an API that answered 503, or a page that answered 404.
 *
 * Each action is asserted absent while its own module is off and the others
 * are on, so a gate wired to the wrong id fails here, and present again with
 * every module on. The role gate (`specs/170-organization-roles/`) stays: the
 * member below holds every code, so what disappears is presence's doing.
 *
 * `CompareToggle` and `ProductCardActions` are client islands that render
 * nothing until they have hydrated, so they are stubbed with a marker carrying
 * the props the server parent hands them; what the card island does with its
 * `presence` is pinned through `withModulePresence` below.
 */

const en = tForLocale('en-US');

/** A presence set in which exactly the named modules are off. */
function presenceWithout(...absent: string[]): ModulePresenceSet {
  return { isPresent: (id: string) => !absent.includes(id), presentIds: [], absentIds: absent };
}

let modules: ModulePresenceSet = presenceWithout();
let oneClick: { enabled: boolean } = { enabled: true };
let oneClickCalls = 0;
let product: Record<string, unknown> = {};

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session',
  getAnonCartCookie: async () => null,
  setAnonCartCookie: async () => undefined,
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'b2b_session' ? { value: 'session' } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
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
vi.mock('../../lib/dictionary/DictionaryProvider', () => ({
  useDictionary: () => ({ countries: [], currencies: [], languages: [], resolveByCode: async () => null }),
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale: 'en-US', ctx: { salesChannelCode: 'web' }, modules }),
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      id: 'member-1',
      email: 'member@example.test',
      organizationRole: { id: 'role-1', kind: 'custom', name: 'Buyer' },
      permissions: [
        'carts.create',
        'quote_requests.create',
        'shopping_lists.create',
        'shopping_lists.convert',
        'quick_order.one_click',
        'carts.order_without_approval',
      ],
    },
    organization: { name: 'Acme', canTransact: true, status: 'active', moderationMessage: null, isPersonal: false },
    impersonation: null,
  }),
}));
vi.mock('../../app/(catalog)/p/[slug]/resolution', () => ({
  productIdForKey: async () => 'p1',
  productById: async () => product,
  alternateLanguages: () => null,
}));
vi.mock('../../lib/api/rfq', () => ({
  getStorefrontQuoteRequestSettings: async () => ({ showAddToQuoteOnPdp: true }),
}));
vi.mock('../../lib/api/inventory', () => ({ getStorefrontProductStock: async () => null }));
vi.mock('../../lib/api/pricing', () => ({
  PRICING_UNAVAILABLE: 'pricing-unavailable',
  getResolvedPrice: async () => 'pricing-unavailable',
}));
vi.mock('../../lib/api/cart', () => ({ addCartItem: async () => ({}) }));
vi.mock('../../lib/api/quick-order', () => ({
  getOneClickEligibility: async () => {
    oneClickCalls += 1;
    return oneClick;
  },
  placeOneClickOrder: async () => ({}),
}));
vi.mock('../../components/Hook', () => ({ Hook: () => null }));
vi.mock('../../components/CompareToggle', () => ({
  CompareToggle: (props: { productId: string; variant?: string }) => (
    <button type="button" data-island="compare" data-variant={props.variant ?? 'card'}>
      compare {props.productId}
    </button>
  ),
  CompareCounterLink: () => <a href="/compare">compare</a>,
}));
vi.mock('../../components/ProductCardActions', () => ({
  ProductCardActions: (props: { presence?: unknown }) => (
    <div data-island="card-actions" data-presence={JSON.stringify(props.presence ?? null)} />
  ),
}));
vi.mock('../../components/SearchAutocomplete', () => ({
  SearchAutocomplete: (props: { requestQuoteLabel: string }) => (
    <div data-island="search" data-request-quote-label={props.requestQuoteLabel} />
  ),
}));

const { default: ProductPage } = await import('../../app/(catalog)/p/[slug]/page');
const { ProductCard } = await import('../../components/ProductCard');
const { ProductRow } = await import('../../components/ProductRow');
const { ProductGrid } = await import('../../components/ProductGrid');
const { Header } = await import('../../components/Header');
const { cardActionVisibility, commerceAbilities, VISITOR_ABILITIES } = await import(
  '../../lib/commerce-permissions'
);

function html(node: unknown): string {
  return renderToString(<>{node as ReactNode}</>).replaceAll('<!-- -->', '');
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
    resolvedPrice: { basePrice: { amount: '10.0000', currency: 'PLN' }, salePrice: null, displayMode: 'net_only' },
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

const QUOTE_ONLY = { price: null, resolvedPrice: { basePrice: null, salePrice: null, displayMode: 'none' } };

async function pdp(): Promise<string> {
  return html(await ProductPage({ params: Promise.resolve({ slug: 'bolt' }) }));
}

beforeEach(() => {
  modules = presenceWithout();
  oneClick = { enabled: true };
  oneClickCalls = 0;
  product = simpleProduct();
});

const ADD_TO_LIST = en('card.list.add');
const ADD_TO_QUOTE = en('product.quote.add');
const COMPARE = 'data-island="compare"';
const ONE_CLICK = en('commerce.pdp.oneClick');
const ADD_TO_CART = `>${en('product.addToCart')}<`;

describe('product page — module presence of its in-page actions (issue #672)', () => {
  const PDP_ACTIONS = [
    { moduleId: 'shopping_lists', marker: ADD_TO_LIST },
    { moduleId: 'comparisons', marker: COMPARE },
    { moduleId: 'quote_requests', marker: ADD_TO_QUOTE },
    { moduleId: 'quick_order', marker: ONE_CLICK },
  ] as const;

  it('offers every action while every module is present', async () => {
    const out = await pdp();
    for (const { marker } of PDP_ACTIONS) expect(out).toContain(marker);
    expect(out).toContain(ADD_TO_CART);
  });

  for (const { moduleId, marker } of PDP_ACTIONS) {
    it(`drops its ${moduleId} action while ${moduleId} is off, and only that one`, async () => {
      modules = presenceWithout(moduleId);
      const out = await pdp();
      expect(out).not.toContain(marker);
      for (const other of PDP_ACTIONS.filter((a) => a.moduleId !== moduleId)) expect(out).toContain(other.marker);
      expect(out).toContain(ADD_TO_CART);
    });
  }

  it('does not ask quick order about one-click buying while quick_order is off', async () => {
    modules = presenceWithout('quick_order');
    await pdp();
    expect(oneClickCalls).toBe(0);
  });

  it('drops the shopping-list heart and the compare toggle without a buy row as well', async () => {
    // No price and no quote action: the heart and the toggle render on their own.
    product = simpleProduct({ price: null, resolvedPrice: null });
    modules = presenceWithout('quote_requests');
    const present = await pdp();
    expect(present).toContain(ADD_TO_LIST);
    expect(present).toContain(COMPARE);
    modules = presenceWithout('quote_requests', 'shopping_lists', 'comparisons');
    const absent = await pdp();
    expect(absent).not.toContain(ADD_TO_LIST);
    expect(absent).not.toContain(COMPARE);
  });

  it('drops the quote-only call to action while quote_requests is off', async () => {
    product = simpleProduct(QUOTE_ONLY);
    expect(await pdp()).toContain(ADD_TO_QUOTE);
    modules = presenceWithout('quote_requests');
    const out = await pdp();
    expect(out).not.toContain(ADD_TO_QUOTE);
    expect(out).not.toContain(en('commerce.quoteCta.hint'));
  });
});

// ── the product card, row and grid ────────────────────────────────────────

function summary(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    id: 'p1',
    slug: 'bolt',
    name: 'Bolt',
    sku: 'BOLT-1',
    primaryAssetUrl: null,
    price: { amount: 10, currency: 'PLN' },
    stockLevel: null,
    stockIndicator: null,
    minOrderQuantity: null,
    ...overrides,
  } as unknown as ProductSummary;
}

const ALL_PRESENT = { shoppingLists: true, comparisons: true, quoteRequests: true } as const;

function card(presence = ALL_PRESENT, overrides: Partial<ProductSummary> = {}, resolved?: unknown): string {
  return html(
    <ProductCard
      product={summary(overrides)}
      locale="en-US"
      salesChannelCode="web"
      presence={presence}
      {...(resolved !== undefined ? { resolved: resolved as never } : {})}
    />,
  );
}

describe('product card — module presence of its actions (issue #672)', () => {
  it('renders the compare toggle while comparisons is present, and not while it is off', () => {
    expect(card()).toContain(COMPARE);
    expect(card({ ...ALL_PRESENT, comparisons: false })).not.toContain(COMPARE);
  });

  it('hands its action island what is present, so the island never asks the browser', () => {
    const presence = { shoppingLists: false, comparisons: true, quoteRequests: false };
    expect(card(presence)).toContain(`data-presence="${JSON.stringify(presence).replaceAll('"', '&quot;')}"`);
  });

  it('offers "price on request" as a link to the quote only while quote_requests is present', () => {
    const none = { basePrice: null, salePrice: null, displayMode: 'none' };
    const present = card(ALL_PRESENT, { price: null }, none);
    expect(present).toContain('href="/p/bolt#quote"');
    const absent = card({ ...ALL_PRESENT, quoteRequests: false }, { price: null }, none);
    expect(absent).not.toContain('#quote');
    expect(absent).toContain(en('commerce.common.priceOnRequest'));
  });

  it('invites a quote for an unpriced product only while quote_requests is present', () => {
    expect(card(ALL_PRESENT, { price: null })).toContain(en('product.requestQuote'));
    const absent = card({ ...ALL_PRESENT, quoteRequests: false }, { price: null });
    expect(absent).not.toContain(en('product.requestQuote'));
    expect(absent).toContain(en('commerce.common.priceOnRequest'));
  });
});

describe('product row and grid — module presence (issue #672)', () => {
  it('the row invites a quote for an unpriced product only while quote_requests is present', () => {
    const row = (presence: typeof ALL_PRESENT | { shoppingLists: boolean; comparisons: boolean; quoteRequests: boolean }): string =>
      html(<ProductRow product={summary({ price: null })} locale="en-US" presence={presence} />);
    expect(row(ALL_PRESENT)).toContain(en('product.requestQuote'));
    const absent = row({ ...ALL_PRESENT, quoteRequests: false });
    expect(absent).not.toContain(en('product.requestQuote'));
    expect(absent).toContain(en('commerce.common.priceOnRequest'));
  });

  it('the grid hands each card and each row the presence it was given', () => {
    const presence = { shoppingLists: true, comparisons: false, quoteRequests: false };
    const grid = html(
      <ProductGrid products={[summary({ price: null })]} locale="en-US" salesChannelCode="web" presence={presence} />,
    );
    expect(grid).not.toContain(COMPARE);
    expect(grid).not.toContain(en('product.requestQuote'));
    const list = html(
      <ProductGrid
        products={[summary({ price: null })]}
        locale="en-US"
        salesChannelCode="web"
        view="list"
        presence={presence}
      />,
    );
    expect(list).not.toContain(en('product.requestQuote'));
  });
});

describe('header search — the "request a quote" result label (issue #672)', () => {
  const header = (): string =>
    html(
      <Header
        config={{ defaultLanguageCode: 'en-US' } as never}
        locale="en-US"
        salesChannelCode="web"
        cartItemCount={0}
        megamenu={null}
        user={null}
        modules={modules}
      />,
    );

  it('labels an unpriced result "request a quote" only while quote_requests is present', () => {
    expect(header()).toContain(`data-request-quote-label="${en('product.requestQuote')}"`);
    modules = presenceWithout('quote_requests');
    expect(header()).toContain(`data-request-quote-label="${en('commerce.common.priceOnRequest')}"`);
  });
});

// ── the rule the card island applies ──────────────────────────────────────

describe('withModulePresence — the role gate and the presence gate, both', () => {
  let moduleActionPresence: typeof import('../../lib/module-action-presence').moduleActionPresence;
  let withModulePresence: typeof import('../../lib/module-action-presence').withModulePresence;
  beforeAll(async () => {
    ({ moduleActionPresence, withModulePresence } = await import('../../lib/module-action-presence'));
  });
  it('reads the three modules from the request’s presence set', () => {
    expect(moduleActionPresence(presenceWithout())).toEqual(ALL_PRESENT);
    expect(moduleActionPresence(presenceWithout('comparisons', 'quote_requests'))).toEqual({
      shoppingLists: true,
      comparisons: false,
      quoteRequests: false,
    });
  });

  it('leaves every ability alone while every module is present', () => {
    expect(withModulePresence(VISITOR_ABILITIES, ALL_PRESENT)).toEqual(VISITOR_ABILITIES);
  });

  it('withdraws the quote abilities while quote_requests is off', () => {
    const a = withModulePresence(VISITOR_ABILITIES, { ...ALL_PRESENT, quoteRequests: false });
    expect(a.requestQuote).toBe(false);
    expect(a.convertListToQuote).toBe(false);
    expect(a.editCart).toBe(true);
    expect(a.editShoppingLists).toBe(true);
    expect(a.convertListToCart).toBe(true);
  });

  it('withdraws the shopping-list abilities while shopping_lists is off', () => {
    const a = withModulePresence(VISITOR_ABILITIES, { ...ALL_PRESENT, shoppingLists: false });
    expect(a.editShoppingLists).toBe(false);
    expect(a.convertListToCart).toBe(false);
    expect(a.convertListToQuote).toBe(false);
    expect(a.requestQuote).toBe(true);
  });

  it('never grants what the role withholds', () => {
    const roleless = commerceAbilities({ permissions: [] });
    expect(withModulePresence(roleless, ALL_PRESENT)).toEqual(roleless);
  });

  it('drops the card’s list and quote buttons with their modules', () => {
    const allOn = { showAddToCart: true, showAddToShoppingList: true, showAddToQuote: true };
    expect(
      cardActionVisibility(allOn, withModulePresence(VISITOR_ABILITIES, { ...ALL_PRESENT, shoppingLists: false }), true),
    ).toEqual({ cart: true, list: false, quote: true });
    expect(
      cardActionVisibility(allOn, withModulePresence(VISITOR_ABILITIES, { ...ALL_PRESENT, quoteRequests: false }), true),
    ).toEqual({ cart: true, list: true, quote: false });
  });
});
