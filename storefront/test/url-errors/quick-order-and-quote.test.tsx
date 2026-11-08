import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { QUICK_ORDER_PREVIEW_MAX_LINES } from '@endora-commerce/contracts';
import { isValidElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { RfqDetail } from '../../lib/api/rfq';
import { StorefrontApiError } from '../../lib/api/client';
import { visibleText } from '../account/i18n/text';
import { actionsOf, form, redirectOf } from './actions';

/**
 * Issue #745 — `/quick-order` rendered `?error=` as the API's sentence beside
 * its own `?problem=` codes, and `/quote-requests/:id` rendered `?error=` as
 * given. Both carry a code now.
 */

let locale = 'en-US';
let failure: Error | null = null;
let imported: unknown = null;
let buildResult: unknown = null;
let rfqLookupFails = false;
let found: Array<{ productId: string; sku: string; name: string }> = [];

// Issue #809 — the preview is the backend's, one per buyer session; this double keeps it per
// session and refuses a write over the line cap, as `PUT /api/v1/quick-order/preview` does.
const previews = vi.hoisted(() => new Map<string, unknown>());
const previewApi = vi.hoisted(() => ({ refuseWrites: false, readFails: false }));
vi.mock('../../lib/api/quick-order-preview', () => ({
  readQuickOrderPreview: async (session: string) => {
    if (previewApi.readFails) throw new Error('fetch failed');
    return previews.has(session) ? structuredClone(previews.get(session)) : null;
  },
  writeQuickOrderPreview: async (session: string, preview: { recognized: unknown[]; rejected: unknown[] }) => {
    if (previewApi.refuseWrites) return false;
    if (preview.recognized.length + preview.rejected.length > 2_000) return false;
    previews.set(session, structuredClone(preview));
    return true;
  },
  clearQuickOrderPreview: async (session: string) => void previews.delete(session),
}));
// Issue #809 — the storefront writes no cookie for the preview any more.
const cookiesWritten = vi.hoisted(() => [] as string[]);
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set: (name: string) => void cookiesWritten.push(name),
    delete: (name: string) => void cookiesWritten.push(name),
  }),
}));

const rfq: RfqDetail = {
  id: '11111111-2222-4333-8444-555555555555',
  businessId: 'RFQ-0001',
  organizationId: 'org-1',
  customerAccountId: 'acc-1',
  status: 'Approved',
  awaitingCustomerRevisionAcceptance: true,
  currentRevisionNumber: 2,
  lastCustomerSeenRevisionNumber: 1,
  headerNote: null,
  cancellationReason: null,
  items: [],
  events: [],
  comparisonAgainstLastSeen: null,
  submittedAt: '2026-10-01T10:00:00.000Z',
  approvedAt: null,
  canceledAt: null,
  completedAt: null,
  expiredAt: null,
  expiresAt: null,
  convertedOrderId: null,
  taxRate: 0.23,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  version: 1,
};

vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale } }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      organizationRole: { id: 'role-admin', kind: 'administrator', name: 'Administrator' },
      permissions: ['carts.create', 'quote_requests.create', 'quote_requests.accept', 'shopping_lists.create', 'shopping_lists.convert'],
    },
    organization: null,
    impersonation: null,
  }),
}));
const refuse = async (): Promise<never> => {
  throw failure ?? new Error('fetch failed');
};
const importOrRefuse = async (): Promise<unknown> => imported ?? refuse();
vi.mock('../../lib/api/quick-order', () => ({
  searchProducts: async () => found,
  buildQuickOrder: async () => buildResult ?? refuse(),
  importQuickOrderCsv: importOrRefuse,
  importQuickOrderFile: importOrRefuse,
}));
vi.mock('../../lib/api/rfq', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/rfq')>('../../lib/api/rfq');
  return {
    ...actual,
    getRfqById: async () => {
      if (rfqLookupFails) throw new Error('fetch failed');
      return rfq;
    },
    acceptRevision: refuse,
    rejectRevision: refuse,
    convertRfqToOrder: refuse,
    resubmitRfq: refuse,
  };
});

const { default: QuickOrderPage } = await import('../../app/(account)/quick-order/page');
const { default: QuotePage } = await import('../../app/(account)/quote-requests/[id]/page');

const previewState = {
  recognized: [{ line: 1, sku: 'BOLT-1', productId: 'p1', variantId: null, quantity: 4 }],
  rejected: [],
  summary: { recognizedCount: 1, rejectedCount: 0, mergedCount: 1, truncated: false },
};

/** The preview the import action wrote, for the session the page mock signs in with. */
function seedPreview(state: unknown = previewState): void {
  previews.set('session-cookie', structuredClone(state));
}

/** A preview of `rows` lines with distinct product ids. */
function previewOf(rows: number): typeof previewState {
  return {
    recognized: Array.from({ length: rows }, (_, index) => ({
      line: index + 1,
      sku: `SKU-${index}`,
      productId: createHash('sha256').update(String(index)).digest('hex').slice(0, 36),
      variantId: null,
      quantity: index + 1,
    })),
    rejected: [],
    summary: { recognizedCount: rows, rejectedCount: 0, mergedCount: 0, truncated: false },
  };
}

/** The longest {@link previewOf} the backend keeps: the import's 2 000 lines (issue #809). */
function fullPreview(): typeof previewState {
  return previewOf(QUICK_ORDER_PREVIEW_MAX_LINES);
}

async function quickTree(sp: Record<string, string> = {}): Promise<unknown> {
  return QuickOrderPage({ searchParams: Promise.resolve(sp) });
}
async function quickText(sp: Record<string, string>): Promise<string> {
  return visibleText(renderToString(<>{(await quickTree(sp)) as React.ReactNode}</>));
}
async function quoteTree(sp: Record<string, string> = {}): Promise<unknown> {
  return QuotePage({ params: Promise.resolve({ id: rfq.id }), searchParams: Promise.resolve(sp) });
}
async function quoteText(sp: Record<string, string>): Promise<string> {
  return visibleText(renderToString(<>{(await quoteTree(sp)) as React.ReactElement}</>));
}

beforeEach(() => {
  locale = 'en-US';
  failure = null;
  imported = null;
  buildResult = null;
  rfqLookupFails = false;
  found = [];
  previews.clear();
  previewApi.refuseWrites = false;
  previewApi.readFails = false;
  cookiesWritten.length = 0;
});

describe('quick order — a crafted parameter never reaches the page', () => {
  it.each(['Zadzwoń pod 555 000 111, aby odblokować', 'SOMETHING_ELSE', 'constructor'])('?error=%s', async (crafted) => {
    const out = await quickText({ error: crafted });
    expect(out).not.toContain(crafted);
  });

  // The page's standing rule (`quick-order-locale.test.tsx`): a code it does not know shows nothing.
  it.each(['Zadzwoń pod 555 000 111', 'constructor'])('?problem=%s shows nothing', async (crafted) => {
    const out = await quickText({ problem: crafted });
    expect(out).not.toContain(crafted);
    expect(out).not.toContain('b2b-auth__error');
  });
});

describe('quick order — each known code reads in English and Polish', () => {
  it.each([
    ['import_failed', 'Import failed.', 'Import nie powiódł się.'],
    [
      'VALIDATION_FAILED.too_many_items',
      'Too many lines to build at once. Split the list and build it in parts.',
      'Za dużo pozycji naraz. Podziel listę i utwórz ją w częściach.',
    ],
    [
      'ORGANIZATION_PERMISSION_REQUIRED',
      'Your role does not allow this. Ask an administrator of your organization for this permission.',
      'Twoja rola na to nie pozwala. Poproś administratora swojej organizacji o to uprawnienie.',
    ],
  ])('%s', async (code, en, pl) => {
    expect(await quickText({ problem: code })).toContain(en);
    locale = 'pl-PL';
    expect(await quickText({ problem: code })).toContain(pl);
  });
});

describe('quick order — the actions redirect with a code', () => {
  it('import carries import_failed for an API refusal it cannot name', async () => {
    failure = new StorefrontApiError(422, 'VALIDATION_FAILED', 'body/csv must NOT have more than 200000 characters');
    const action = actionsOf(await quickTree()).get('importAction')!;
    expect(await redirectOf(() => action(form({ csv: 'sku,quantity\nBOLT-1,4' }) as never))).toBe(
      '/quick-order?problem=import_failed',
    );
  });

  it('build carries the refinement it names', async () => {
    failure = new StorefrontApiError(422, 'VALIDATION_FAILED', 'At most 500 items can be built at once.', undefined, {
      code: 'too_many_items',
      maximum: 500,
    });
    seedPreview();
    const action = actionsOf(await quickTree()).get('confirmAction')!;
    expect(await redirectOf(() => action(form({ target: 'cart' }) as never))).toBe(
      '/quick-order?problem=VALIDATION_FAILED.too_many_items',
    );
  });
});

/** Issue #791 — a minimum refusal carries the minimum as a typed value, validated when read. */
describe('quick order — a minimum refusal names the minimum (issue #791)', () => {
  it('the build carries the minimum beside the code', async () => {
    failure = new StorefrontApiError(422, 'PRODUCT_BELOW_MINIMUM_QUANTITY', '"Bolt" has a minimum…', undefined, {
      productName: 'Bolt',
      minimum: 10,
    });
    seedPreview();
    const action = actionsOf(await quickTree()).get('confirmAction')!;
    expect(await redirectOf(() => action(form({ target: 'quote_request' }) as never))).toBe(
      '/quick-order?problem=PRODUCT_BELOW_MINIMUM_QUANTITY&min=10',
    );
  });

  it('the page reads it in English and Polish', async () => {
    const sp = { problem: 'PRODUCT_BELOW_MINIMUM_QUANTITY', min: '10' };
    expect(await quickText(sp)).toContain('A product is below its minimum order quantity (10 pcs).');
    locale = 'pl-PL';
    expect(await quickText(sp)).toContain('Ilość produktu jest poniżej minimalnej ilości zamówienia (10 szt.).');
  });

  it('a minimum out of shape reads as the bare sentence', async () => {
    const out = await quickText({ problem: 'PRODUCT_BELOW_MINIMUM_QUANTITY', min: '10; call 555' });
    expect(out).not.toContain('call 555');
    expect(out).toContain('A product is below its minimum order quantity. Increase the quantity and try again.');
  });
});

describe('quote request — a crafted ?error= never reaches the page', () => {
  it.each(['Oferta wygasła — przelej zaliczkę na 00 1111', 'SOMETHING_ELSE', 'constructor'])('%s', async (crafted) => {
    const out = await quoteText({ error: crafted });
    expect(out).not.toContain(crafted);
    expect(out).toContain('Something went wrong with this quote request. Please try again.');
  });
});

describe('quote request — each known code reads in English and Polish', () => {
  it.each([
    [
      'RFQ_EXPIRED',
      'This quote is no longer valid — its validity period has ended. Ask your sales representative for a new quote, or submit the request again.',
      'Ta oferta straciła ważność — termin jej ważności upłynął. Poproś opiekuna handlowego o nową ofertę lub złóż zapytanie ponownie.',
    ],
    [
      'VERSION_CONFLICT',
      'This quote request was changed in the meantime. Refresh the page and try again.',
      'To zapytanie ofertowe zostało w międzyczasie zmienione. Odśwież stronę i spróbuj ponownie.',
    ],
  ])('%s', async (code, en, pl) => {
    expect(await quoteText({ error: code })).toContain(en);
    locale = 'pl-PL';
    expect(await quoteText({ error: code })).toContain(pl);
  });
});

describe('quote request — the actions redirect with a code', () => {
  async function run(name: string): Promise<string> {
    const action = actionsOf(await quoteTree()).get(name);
    if (!action) throw new Error(`the quote page hands no ${name}`);
    return redirectOf(() => action(form({ rfqId: rfq.id, expectedRevisionNumber: '2' }) as never));
  }

  it('accept carries the API code it names', async () => {
    failure = new StorefrontApiError(409, 'RFQ_EXPIRED', 'Ta oferta straciła ważność…');
    expect(await run('acceptAction')).toBe(`/quote-requests/${rfq.id}?error=RFQ_EXPIRED`);
  });

  it.each([
    ['acceptAction', 'ACCEPT_FAILED'],
    ['rejectAction', 'REJECT_FAILED'],
    ['convertAction', 'CONVERT_FAILED'],
    ['resubmitAction', 'RESUBMIT_FAILED'],
  ])('%s carries %s for a refusal it cannot name', async (name, code) => {
    failure = new StorefrontApiError(500, 'INTERNAL', 'Database exploded.');
    expect(await run(name)).toBe(`/quote-requests/${rfq.id}?error=${code}`);
  });
});

/**
 * Issue #790 — the preview (the buyer's CSV, its raw rejected lines included) travelled in the
 * URL, so a crafted `?preview=` put any text on the page. Since issue #809 the backend keeps it,
 * bound to the buyer session; neither the URL nor a cookie carries any of it.
 */
describe('quick order — the preview never travels in the URL (issue #790)', () => {
  const crafted = Buffer.from(
    JSON.stringify({
      recognized: [{ line: 1, sku: 'Zadzwoń pod 555 000 111', productId: 'p1', variantId: null, quantity: 4 }],
      rejected: [{ line: 2, raw: 'Przelej 100 zł na 00 1111', reason: 'product_not_found' }],
      summary: { recognizedCount: 1, rejectedCount: 1, mergedCount: 0, truncated: false },
    }),
    'utf8',
  ).toString('base64url');

  it('a crafted ?preview= never reaches the page', async () => {
    const out = await quickText({ preview: crafted });
    expect(out).not.toContain('Zadzwoń pod 555');
    expect(out).not.toContain('Przelej 100 zł');
  });

  it('the import keeps its preview out of the URL and the page shows it', async () => {
    imported = { ...previewState, rejected: [{ line: 2, raw: 'NOPE,1', reason: 'product_not_found' }] };
    const action = actionsOf(await quickTree()).get('importAction')!;
    expect(await redirectOf(() => action(form({ csv: 'sku,quantity\nBOLT-1,4' }) as never))).toBe('/quick-order');
    const out = await quickText({});
    expect(out).toContain('BOLT-1');
    expect(out).toContain('NOPE,1');
    expect(cookiesWritten).toEqual([]);
  });

  it('holds an import of 2 000 lines, far past the old cookie budget', async () => {
    imported = previewOf(QUICK_ORDER_PREVIEW_MAX_LINES);
    const action = actionsOf(await quickTree()).get('importAction')!;
    expect(await redirectOf(() => action(form({ csv: 'sku,quantity' }) as never))).toBe('/quick-order');
    const out = await quickText({});
    expect(out).toContain('SKU-0');
    expect(out).toContain(`SKU-${QUICK_ORDER_PREVIEW_MAX_LINES - 1}`);
  });

  /** The page's actions, the preview panel's included (a component `actionsOf` does not render). */
  async function quickActions(sp: Record<string, string>): Promise<Map<string, (...args: never[]) => unknown>> {
    const tree = (await quickTree(sp)) as React.ReactElement<{ children: React.ReactNode[] }>;
    const panel = tree.props.children.find(
      (child): child is React.ReactElement => isValidElement(child) && (child.type as { name?: string }).name === 'PreviewPanel',
    );
    const actions = actionsOf(tree);
    if (panel) for (const [name, run] of actionsOf((panel.type as (props: unknown) => unknown)(panel.props))) actions.set(name, run);
    return actions;
  }

  it('editing the preview keeps it out of the URL', async () => {
    seedPreview();
    const actions = await quickActions({ q: 'bolt' });
    expect(await redirectOf(() => actions.get('updateQuantityAction')!(form({ line: '1', quantity: '9' }) as never))).toBe(
      '/quick-order',
    );
    expect(renderToString(<>{(await quickTree({})) as React.ReactNode}</>)).toContain('value="9"');
    expect(await redirectOf(() => actions.get('searchAction')!(form({ q: 'nut' }) as never))).toBe('/quick-order?q=nut');
    expect(await redirectOf(() => actions.get('removeRecognizedAction')!(form({ line: '1' }) as never))).toBe(
      '/quick-order',
    );
    expect(await quickText({})).not.toContain('BOLT-1');
  });

  it('no form on the page carries the preview', async () => {
    seedPreview();
    const html = renderToString(<>{(await quickTree({})) as React.ReactNode}</>);
    expect(html).toContain('BOLT-1');
    expect(html).not.toContain('name="preview"');
  });

  it('a list too long to keep is refused in words, not cut short', async () => {
    imported = previewOf(QUICK_ORDER_PREVIEW_MAX_LINES + 1);
    const action = actionsOf(await quickTree()).get('importAction')!;
    expect(await redirectOf(() => action(form({ csv: 'sku,quantity' }) as never))).toBe(
      '/quick-order?problem=preview_too_large',
    );
    expect(await quickText({ problem: 'preview_too_large' })).toContain(
      'This list is too long to review here. Split it into smaller files and import them one at a time.',
    );
    locale = 'pl-PL';
    expect(await quickText({ problem: 'preview_too_large' })).toContain(
      'Ta lista jest zbyt długa, by przejrzeć ją tutaj. Podziel ją na mniejsze pliki i zaimportuj je po kolei.',
    );
  });

  it('a failed import does not leave the last preview beside its refusal', async () => {
    seedPreview();
    const action = actionsOf(await quickTree()).get('importAction')!;
    expect(await redirectOf(() => action(form({ csv: 'sku,quantity' }) as never))).toBe('/quick-order?problem=import_failed');
    expect(await quickText({ problem: 'import_failed' })).not.toContain('BOLT-1');
  });

  it('a successful build clears the preview', async () => {
    seedPreview();
    const action = actionsOf(await quickTree()).get('confirmAction')!;
    buildResult = { target: 'cart', cartId: 'c1', rejected: [] };
    expect(await redirectOf(() => action(form({ target: 'cart' }) as never))).toBe('/quick-order?built=cart');
    expect(previews.size).toBe(0);
  });

  it('adding from search to a full preview is refused with its own advice, and the preview kept', async () => {
    const full = fullPreview();
    seedPreview(full);
    // The line that would make it one longer than the backend keeps.
    const next = previewOf(full.recognized.length + 1).recognized.at(-1)!;
    found = [{ productId: next.productId, sku: next.sku, name: 'Nut' }];
    const add = (await quickActions({ q: 'nut' })).get('addSearchResultAction')!;
    const data = form({ q: 'nut', productId: next.productId, sku: next.sku, quantity: String(next.quantity) });
    expect(await redirectOf(() => add(data as never))).toBe('/quick-order?problem=preview_full');
    const out = await quickText({ problem: 'preview_full' });
    expect(out).toContain('The list is full, so no more lines fit here. Build what you have, then add the rest.');
    expect(out).toContain(full.recognized[0]!.sku);
    locale = 'pl-PL';
    expect(await quickText({ problem: 'preview_full' })).toContain(
      'Lista jest pełna i nie zmieści więcej pozycji. Utwórz koszyk lub zapytanie z tego, co już jest, a potem dodaj resztę.',
    );
  });

  it('a partial cart build carries counts only and keeps exactly the lines the cart did not take', async () => {
    seedPreview({
      ...previewState,
      recognized: [
        { line: 1, sku: 'BOLT-1', productId: 'p1', variantId: null, quantity: 4 },
        { line: 2, sku: 'NUT-2', productId: 'p2', variantId: null, quantity: 50 },
      ],
      rejected: [{ line: 3, raw: 'NOPE,1', reason: 'product_not_found' }],
    });
    buildResult = {
      target: 'cart',
      cartId: 'c1',
      rejected: [
        {
          productId: 'p1',
          variantId: null,
          quantity: 4,
          productName: 'Anchor bolt',
          reason: 'below_minimum',
          kind: 'packaging_unit',
          minimum: 2,
          packagingUnitName: 'Pallet',
        },
      ],
    };
    const confirm = actionsOf(await quickTree()).get('confirmAction')!;
    const to = await redirectOf(() => confirm(form({ target: 'cart' }) as never));
    expect(to).toBe('/quick-order?built=cart&sent=2&rejected=1');
    const out = await quickText(Object.fromEntries(new URL(to, 'http://x').searchParams));
    expect(out).toContain('Cart built from your import: 1 of 2 lines added.');
    // The server-written preview carries the build's names (architect ruling, round 2, Q3).
    expect(out).toContain('Anchor bolt (BOLT-1) × 4 — Below the minimum (2 × Pallet)');
    // The preview now holds the line to retry, and nothing the cart took or the import refused.
    expect(out).not.toContain('NUT-2');
    expect(out).not.toContain('NOPE,1');
  });

  it('a rewrite the backend refuses clears the preview and reports the counts only', async () => {
    const full = previewOf(40);
    seedPreview(full);
    previewApi.refuseWrites = true;
    buildResult = {
      target: 'cart',
      cartId: 'c1',
      rejected: full.recognized.map((row, index) => ({
        productId: row.productId,
        variantId: null,
        quantity: row.quantity,
        productName: createHash('sha256').update(`name ${index}`).digest('hex').repeat(3),
        reason: 'below_minimum',
        kind: 'pieces',
        minimum: 1000,
      })),
    };
    const rows = full.recognized.length;
    const confirm = actionsOf(await quickTree()).get('confirmAction')!;
    const to = await redirectOf(() => confirm(form({ target: 'cart' }) as never));
    expect(to).toBe(`/quick-order?built=cart&sent=${rows}&rejected=${rows}`);
    expect(previews.has('session-cookie')).toBe(false);
    const out = await quickText(Object.fromEntries(new URL(to, 'http://x').searchParams));
    expect(out).toContain('No lines were added to your cart.');
    expect(out).toContain(`+${rows} more`);
  });

  it('a crafted ?notAdded= is not read', async () => {
    const crafted = Buffer.from(
      JSON.stringify({ lines: [{ productName: 'Zadzwoń pod 555', quantity: 1, kind: 'pieces', minimum: 2 }], more: 0 }),
      'utf8',
    ).toString('base64url');
    const out = await quickText({ built: 'cart', sent: '2', notAdded: crafted });
    expect(out).not.toContain('Zadzwoń');
  });

  it('a preview written for another session is not shown', async () => {
    previews.set('someone-else', structuredClone(previewState));
    expect(await quickText({})).not.toContain('BOLT-1');
  });
});

/**
 * Issue #809 — the backend keeps a preview for an hour after it was last written. A buyer who
 * comes back to an edit, a removal or a build after that is told to paste the list again, in
 * their language, instead of a bare "nothing to do".
 */
describe('quick order — an expired preview asks for the list again (issue #809)', () => {
  const EN = 'Your list has expired. Paste it or upload the file again to review it.';
  const PL = 'Twoja lista wygasła. Wklej ją lub prześlij plik ponownie, aby ją przejrzeć.';

  /** The panel's actions, rendered against a preview that is then gone. */
  async function actionsOfAnExpiredPreview(): Promise<Map<string, (...args: never[]) => unknown>> {
    seedPreview();
    const tree = (await quickTree({})) as React.ReactElement<{ children: React.ReactNode[] }>;
    const panel = tree.props.children.find(
      (child): child is React.ReactElement => isValidElement(child) && (child.type as { name?: string }).name === 'PreviewPanel',
    )!;
    const actions = actionsOf(tree);
    for (const [name, run] of actionsOf((panel.type as (props: unknown) => unknown)(panel.props))) actions.set(name, run);
    previews.clear();
    return actions;
  }

  it.each([
    ['updateQuantityAction', { line: '1', quantity: '9' }],
    ['removeRecognizedAction', { line: '1' }],
    ['confirmAction', { target: 'cart' }],
  ])('%s says so', async (name, fields) => {
    const actions = await actionsOfAnExpiredPreview();
    expect(await redirectOf(() => actions.get(name)!(form(fields) as never))).toBe('/quick-order?problem=preview_expired');
  });

  it('the page words it in English and Polish', async () => {
    expect(await quickText({ problem: 'preview_expired' })).toContain(EN);
    locale = 'pl-PL';
    expect(await quickText({ problem: 'preview_expired' })).toContain(PL);
  });

  it('an action that cannot reach the preview says so, rather than calling it expired', async () => {
    const actions = await actionsOfAnExpiredPreview();
    previewApi.readFails = true;
    expect(await redirectOf(() => actions.get('confirmAction')!(form({ target: 'cart' }) as never))).toBe(
      '/quick-order?problem=preview_unavailable',
    );
    expect(await quickText({ problem: 'preview_unavailable' })).toContain(
      'Your list could not be loaded just now. Try again in a moment.',
    );
    locale = 'pl-PL';
    expect(await quickText({ problem: 'preview_unavailable' })).toContain(
      'Nie udało się teraz wczytać Twojej listy. Spróbuj ponownie za chwilę.',
    );
  });

  it('a page that cannot reach the preview still renders the import', async () => {
    previewApi.readFails = true;
    const out = await quickText({});
    expect(out).toContain('Quick order');
  });
});

describe('quick order — the quote reference is read, never carried (issue #790)', () => {
  it('a quote build redirects with the request id', async () => {
    seedPreview();
    buildResult = { target: 'quote_request', quoteRequestId: rfq.id, quoteRequestBusinessId: 'RFQ-0001' };
    const confirm = actionsOf(await quickTree()).get('confirmAction')!;
    expect(await redirectOf(() => confirm(form({ target: 'quote_request' }) as never))).toBe(
      `/quick-order?built=quote&rfqId=${rfq.id}`,
    );
  });

  it('the page reads the reference of the request the id names', async () => {
    expect(await quickText({ built: 'quote', rfqId: rfq.id })).toContain('Quote request created (#RFQ-0001).');
  });

  it('a lookup that fails shows the confirmation without a reference', async () => {
    rfqLookupFails = true;
    const out = await quickText({ built: 'quote', rfqId: rfq.id });
    expect(out).toContain('Quote request created.');
    expect(out).not.toContain('(#');
  });

  it('a crafted ?rfq= or ?rfqId= never reaches the page', async () => {
    const out = await quickText({ built: 'quote', rfq: 'Zadzwoń pod 555 000 111', rfqId: 'Zadzwoń pod 555' });
    expect(out).not.toContain('Zadzwoń');
    expect(out).toContain('Quote request created.');
  });
});

describe('quick order — the search text is capped where the page reads it (issue #790)', () => {
  it('a ?q= longer than the search accepts is cut', async () => {
    const html = renderToString(<>{(await quickTree({ q: 'x'.repeat(5000) })) as React.ReactNode}</>);
    expect(html).toContain(`value="${'x'.repeat(120)}"`);
    expect(html).not.toContain('x'.repeat(121));
  });
});
