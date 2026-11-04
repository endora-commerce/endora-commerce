import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Feature 155, U4 (owner ruling S8 A) — the quick-order page speaks the page's language. Its
 * minimum reports were catalogue copy while every heading, column, button and notice around
 * them was an English literal, so a Polish buyer read a Polish refusal inside an English page.
 *
 * The page is an async server component: it is awaited and its tree rendered on the server,
 * with the session, the request context and the search mocked (as in
 * `order-page-purchase-tracking.test.tsx`).
 */
let locale = 'en-US';
let results: Array<{ productId: string; sku: string; name: string }> = [];

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
vi.mock('../../lib/api/quick-order', () => ({
  searchProducts: async () => results,
  buildQuickOrder: async () => ({}),
  importQuickOrderCsv: async () => ({}),
  importQuickOrderFile: async () => ({}),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

const { default: QuickOrderPage } = await import('../../app/(account)/quick-order/page');

const preview = Buffer.from(
  JSON.stringify({
    recognized: [{ line: 1, sku: 'BOLT-1', productId: 'p1', variantId: null, quantity: 4 }],
    rejected: [{ line: 2, raw: 'NOPE,1', reason: 'product_not_found' }],
    summary: { recognizedCount: 1, rejectedCount: 1, mergedCount: 2, truncated: true },
  }),
  'utf8',
).toString('base64url');

async function render(sp: Record<string, string>): Promise<string> {
  const tree = await QuickOrderPage({ searchParams: Promise.resolve(sp) });
  return renderToString(<>{tree}</>).replaceAll('<!-- -->', '');
}

beforeEach(() => {
  locale = 'en-US';
  results = [];
});

const COPY = {
  'en-US': {
    heading: '<h2>Quick order</h2>',
    intro: 'Paste a CSV with <code>sku,quantity</code> headers',
    template: 'Download CSV template',
    dropzone: 'Drag a CSV or Excel file here, or click to choose',
    paste: '…or paste CSV',
    previewButton: '>Preview</button>',
    find: '<h3>Find products</h3>',
    placeholder: 'placeholder="Search products…"',
    search: '>Search</button>',
    none: 'No products matched &quot;bolt&quot;.',
    add: '>Add</button>',
    qtyFor: 'aria-label="Quantity for BOLT-1"',
    columns: ['<th>SKU</th>', '<th>Name</th>', '<th>Qty</th>'],
    previewHeading: '<h3>Preview</h3>',
    pills: ['</strong> recognised', '</strong> invalid', '</strong> units'],
    truncated: 'The file exceeded the import row limit — extra rows were rejected.',
    merged: '2 duplicate row(s) merged (quantities summed).',
    recognisedRows: '1 row(s) recognised — choose how to proceed.',
    previewColumns: ['<th>Line</th>', '<th>Variant</th>', '<th>Quantity</th>', '<th>Reason</th>', '<th>Raw</th>'],
    update: '>Update</button>',
    remove: '>Remove</button>',
    addAll: '>Add all to cart</button>',
    sendQuote: '>Send as quote request</button>',
    rejected: '<h4>Rejected rows</h4>',
    barRecognised: '>Recognised</span>',
    barUnits: '4 units',
    barAdd: 'Add 1 to cart',
    builtCart: 'Cart built from your import.',
    openCart: '>Open cart</a>',
    checkout: '>Go to checkout</a>',
    builtQuote: 'Quote request created (#RFQ-7).',
    viewQuotes: '>View quote requests</a>',
    problem: 'Nothing to build.',
  },
  'pl-PL': {
    heading: '<h2>Szybkie zamówienie</h2>',
    intro: 'Wklej CSV z nagłówkami <code>sku,quantity</code>',
    template: 'Pobierz szablon CSV',
    dropzone: 'Przeciągnij tutaj plik CSV lub Excel albo kliknij, aby go wybrać',
    paste: '…albo wklej CSV',
    previewButton: '>Pokaż podgląd</button>',
    find: '<h3>Znajdź produkty</h3>',
    placeholder: 'placeholder="Szukaj produktów…"',
    search: '>Szukaj</button>',
    none: 'Żaden produkt nie pasuje do „bolt”.',
    add: '>Dodaj</button>',
    qtyFor: 'aria-label="Ilość dla BOLT-1"',
    columns: ['<th>SKU</th>', '<th>Nazwa</th>', '<th>Ilość</th>'],
    previewHeading: '<h3>Podgląd</h3>',
    pills: ['</strong> rozpoznane', '</strong> błędne', '</strong> szt.'],
    truncated: 'Plik przekroczył limit wierszy importu — nadmiarowe wiersze odrzucono.',
    merged: 'Scalone powtórzone wiersze: 2 (ilości zsumowano).',
    recognisedRows: 'Rozpoznane wiersze: 1 — wybierz, co dalej.',
    previewColumns: ['<th>Wiersz</th>', '<th>Wariant</th>', '<th>Ilość</th>', '<th>Powód</th>', '<th>Dane z pliku</th>'],
    update: '>Zmień</button>',
    remove: '>Usuń</button>',
    addAll: '>Dodaj wszystko do koszyka</button>',
    sendQuote: '>Wyślij jako zapytanie ofertowe</button>',
    rejected: '<h4>Odrzucone wiersze</h4>',
    barRecognised: '>Rozpoznane</span>',
    barUnits: '4 szt.',
    barAdd: 'Dodaj do koszyka (1)',
    builtCart: 'Koszyk utworzony z importu.',
    openCart: '>Otwórz koszyk</a>',
    checkout: '>Przejdź do kasy</a>',
    builtQuote: 'Utworzono zapytanie ofertowe (#RFQ-7).',
    viewQuotes: '>Zobacz zapytania ofertowe</a>',
    problem: 'Nie ma z czego utworzyć koszyka ani zapytania.',
  },
} as const;

describe.each(Object.entries(COPY))('quick order — %s', (tag, copy) => {
  beforeEach(() => {
    locale = tag;
  });

  it('words the page chrome, the import and the search', async () => {
    const html = await render({});
    for (const text of [
      copy.heading,
      copy.intro,
      copy.template,
      copy.dropzone,
      copy.paste,
      copy.previewButton,
      copy.find,
      copy.placeholder,
      copy.search,
    ]) {
      expect(html).toContain(text);
    }
  });

  it('words an empty search', async () => {
    expect(await render({ q: 'bolt' })).toContain(copy.none);
  });

  it('words the search results table and names each quantity input', async () => {
    results = [{ productId: 'p1', sku: 'BOLT-1', name: 'Bolt' }];
    const html = await render({ q: 'bolt' });
    for (const text of [...copy.columns, copy.add, copy.qtyFor]) expect(html).toContain(text);
  });

  it('words the preview, its rows, its actions and the mobile bar', async () => {
    const html = await render({ preview });
    for (const text of [
      copy.previewHeading,
      ...copy.pills,
      copy.truncated,
      copy.merged,
      copy.recognisedRows,
      ...copy.previewColumns,
      copy.qtyFor,
      copy.update,
      copy.remove,
      copy.addAll,
      copy.sendQuote,
      copy.rejected,
      copy.barRecognised,
      copy.barUnits,
      copy.barAdd,
    ]) {
      expect(html).toContain(text);
    }
  });

  it('words the build confirmations', async () => {
    const cart = await render({ built: 'cart' });
    for (const text of [copy.builtCart, copy.openCart, copy.checkout]) expect(cart).toContain(text);
    const quote = await render({ built: 'quote', rfq: 'RFQ-7' });
    for (const text of [copy.builtQuote, copy.viewQuotes]) expect(quote).toContain(text);
  });

  it("words the page's own refusals from a code, never from the URL's text", async () => {
    expect(await render({ problem: 'nothing_to_build' })).toContain(copy.problem);
    expect(await render({ problem: '<script>' })).not.toContain('b2b-auth__error');
  });
});

describe('quick order — Polish page carries no English chrome', () => {
  it('renders none of the old literals', async () => {
    locale = 'pl-PL';
    results = [{ productId: 'p1', sku: 'BOLT-1', name: 'Bolt' }];
    const html = await render({ q: 'bolt', preview });
    for (const literal of [
      'Quick order',
      'Find products',
      'Search products',
      'Download CSV template',
      'or paste CSV',
      'Rejected rows',
      'Add all to cart',
      'Send as quote request',
      'Quantity for',
      'recognised',
      ' units',
    ]) {
      expect(html).not.toContain(literal);
    }
  });
});

describe("quick order — the actions' refusals travel as codes", () => {
  const page = readFileSync(resolve(import.meta.dirname, '../../app/(account)/quick-order/page.tsx'), 'utf8');

  it.each([
    'Nothing+to+update.',
    'Nothing+to+remove.',
    'Provide+a+file+or+paste+CSV.',
    'Nothing+to+build.',
    "'Import failed.'",
    "'Build failed.'",
  ])('no longer writes %s into the address', (literal) => {
    expect(page).not.toContain(literal);
  });
});
