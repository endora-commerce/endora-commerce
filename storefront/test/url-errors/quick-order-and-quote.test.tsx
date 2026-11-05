import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const rfq: RfqDetail = {
  id: '11111111-2222-4333-8444-555555555555',
  businessId: 'RFQ-0001',
  organizationId: 'org-1',
  customerAccountId: 'acc-1',
  status: 'Quoted',
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
vi.mock('../../lib/api/quick-order', () => ({
  searchProducts: async () => [],
  buildQuickOrder: refuse,
  importQuickOrderCsv: refuse,
  importQuickOrderFile: refuse,
}));
vi.mock('../../lib/api/rfq', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/rfq')>('../../lib/api/rfq');
  return {
    ...actual,
    getRfqById: async () => rfq,
    acceptRevision: refuse,
    rejectRevision: refuse,
    convertRfqToOrder: refuse,
    resubmitRfq: refuse,
  };
});

const { default: QuickOrderPage } = await import('../../app/(account)/quick-order/page');
const { default: QuotePage } = await import('../../app/(account)/quote-requests/[id]/page');

const preview = Buffer.from(
  JSON.stringify({
    recognized: [{ line: 1, sku: 'BOLT-1', productId: 'p1', variantId: null, quantity: 4 }],
    rejected: [],
    summary: { recognizedCount: 1, rejectedCount: 0, mergedCount: 1, truncated: false },
  }),
  'utf8',
).toString('base64url');

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
});

describe('quick order — a crafted parameter never reaches the page', () => {
  it.each(['Zadzwoń pod 555 000 111, aby odblokować', 'SOMETHING_ELSE', 'constructor'])('?error=%s', async (crafted) => {
    const out = await quickText({ error: crafted });
    expect(out).not.toContain(crafted);
  });

  it.each(['Zadzwoń pod 555 000 111', 'constructor'])('?problem=%s reads as the generic failure', async (crafted) => {
    const out = await quickText({ problem: crafted });
    expect(out).not.toContain(crafted);
    expect(out).toContain('Something went wrong. Please try again.');
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
    const action = actionsOf(await quickTree({ preview })).get('confirmAction')!;
    expect(await redirectOf(() => action(form({ preview, target: 'cart' }) as never))).toBe(
      '/quick-order?problem=VALIDATION_FAILED.too_many_items',
    );
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
