import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { visibleText } from './i18n/text';

/**
 * `specs/180-off-platform-complaints/` T088 (FR-B01, FR-B02, FR-B12 – FR-B16, FR-B30,
 * D-1, D-12, D-14; design review R-1, R-2): the entry to the no-order path and the
 * no-order complaint form, server-rendered so it works without JavaScript.
 */
let locale = 'en-US';
let config: Record<string, unknown>;
let orders: Array<{ id: string; businessId: string; placedAt: string }>;
let session: string | null = 'session-cookie';
const redirects: string[] = [];

let attemptCookie: string | undefined;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'returns_attempt' && attemptCookie ? { value: attemptCookie } : undefined) }),
}));
vi.mock('../../lib/session', () => ({ getSessionCookie: async () => session }));
vi.mock('../../lib/server-context', () => ({ getServerContext: async () => ({ locale, ctx: { locale } }) }));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    redirects.push(to);
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/dictionary/pickers/CountryPicker', () => ({
  CountryPicker: (props: Record<string, unknown>) => <select {...props} />,
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: { id: 'me', email: 'anna@firma.pl', firstName: 'Anna', lastName: 'Nowak', permissions: ['returns.create'], organizationRole: { kind: 'custom' } },
    organization: { id: 'org-1', name: 'Endora sp. z o.o.', isPersonal: false },
    impersonation: null,
  }),
}));
vi.mock('../../lib/api/organization', () => ({
  listAddresses: async () => [
    { id: 'a1', organizationId: 'org-1', kind: 'delivery', recipientName: 'Anna Nowak', street: 'Długa 5', city: 'Warszawa', postalCode: '00-001', country: 'PL', phone: '+48 600 100 200', isDefault: true },
  ],
}));
vi.mock('../../lib/api/orders', () => ({ listMyOrders: async () => orders }));
vi.mock('../../lib/api/returns', () => ({
  getReturnFormConfig: async () => config,
  listReturnReasons: async () => [
    { id: 'r-complaint', label: { 'en-US': 'Defective', en: 'Defective' }, appliesTo: 'complaint', isActive: true, weight: 1 },
    { id: 'r-return', label: { en: 'Changed my mind' }, appliesTo: 'return', isActive: true, weight: 2 },
  ],
  getReturnable: async () => ({ eligible: true, freeReturnEligible: false, lines: [] }),
}));

const { default: NewReturnPage } = await import('../../app/(account)/returns/new/page');
const render = async (searchParams: Record<string, string> = {}): Promise<string> =>
  renderToString(<>{(await NewReturnPage({ searchParams: Promise.resolve(searchParams) })) as React.ReactElement}</>);

const CLAUSES = [
  { id: 'c1', revision: 2, mode: 'must_accept', label: 'Complaint terms', text: 'We inspect first.', linkUrl: 'https://shop.example/terms' },
  { id: 'c2', revision: 1, mode: 'inform_only', label: 'Please note', text: 'Shipping is on us.', linkUrl: null },
];

beforeEach(() => {
  attemptCookie = undefined;
  locale = 'en-US';
  session = 'session-cookie';
  redirects.length = 0;
  orders = [{ id: 'o1', businessId: 'ORD-1', placedAt: '2026-10-01T10:00:00Z' }];
  config = {
    offPlatformComplaintsEnabled: true,
    proofOfPurchaseRequired: false,
    confirmationEmailEnabled: true,
    today: '2026-11-13',
    clauses: CLAUSES,
    attachmentLimits: { maxFileBytes: 10485760, maxSubmissionBytes: 31457280, maxFilesPerCase: 10, acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
  };
});

describe('the entry to the no-order path (R-1)', () => {
  it('offers "Bought it somewhere else?" above the orders while enabled', async () => {
    const out = await render();
    expect(out).toContain('href="/returns/new?origin=elsewhere"');
    expect(visibleText(out)).toContain('Bought it somewhere else? File a complaint without an order');
    expect(out.indexOf('origin=elsewhere')).toBeLessThan(out.indexOf('ORD-1'));
  });

  it('offers nothing while disabled, and falls back to the order list for ?origin=elsewhere', async () => {
    config = { ...config, offPlatformComplaintsEnabled: false };
    expect(await render()).not.toContain('origin=elsewhere');
    const out = await render({ origin: 'elsewhere' });
    expect(out).toContain('ORD-1');
    expect(out).not.toContain('action="/returns/submit"');
  });

  it('makes the no-order path the main content when there is no order yet', async () => {
    orders = [];
    const text = visibleText(await render());
    expect(text).toContain('You haven’t ordered from us yet');
  });

  it('keeps the full path and query in next for a signed-out visit (D-14)', async () => {
    session = null;
    await expect(render({ origin: 'elsewhere' })).rejects.toThrow();
    expect(redirects).toEqual([`/login?next=${encodeURIComponent('/returns/new?origin=elsewhere')}`]);
  });
});

describe('the no-order complaint form (R-2)', () => {
  it('posts multipart to the route handler, with numbered fieldsets and a submission key', async () => {
    const out = await render({ origin: 'elsewhere' });
    expect(out).toMatch(/<form[^>]*action="\/returns\/submit"/);
    expect(out).toMatch(/enctype="multipart\/form-data"/i);
    expect(out).toMatch(/name="submissionKey" value="[0-9a-f-]{36}"/);
    expect(out).toMatch(/<input[^>]*type="hidden"[^>]*name="origin"[^>]*value="elsewhere"|name="origin"[^>]*value="elsewhere"/);
    const legends = [...out.matchAll(/<legend[^>]*>(.*?)<\/legend>/g)].map((m) => visibleText(m[1]!));
    expect(legends[0]).toMatch(/^1 · /);
    expect(legends.some((l) => l.startsWith('5 · '))).toBe(true);
  });

  it('renders the product as a model field without JavaScript, with quantity, reason, description and serial number', async () => {
    const out = await render({ origin: 'elsewhere' });
    expect(out).toContain('name="lines.0.modelName"');
    expect(out).toContain('name="lines.0.quantity"');
    expect(out).toContain('name="lines.0.description"');
    expect(out).toContain('name="lines.0.serialNumber"');
    // The one complaint reason is preselected, as text and a hidden input.
    expect(out).toMatch(/name="lines\.0\.reasonId" value="r-complaint"/);
    expect(out).not.toContain('r-return');
  });

  it('bounds the purchase date by the shop’s day (D-12) and asks for the receipt number', async () => {
    const out = await render({ origin: 'elsewhere' });
    expect(out).toMatch(/type="date"[^>]*max="2026-11-13"|max="2026-11-13"[^>]*type="date"/);
    expect(out).toContain('name="purchase.proofNumber"');
  });

  it('prefills the contact and the return address, saying the changes stay with this complaint', async () => {
    const out = await render({ origin: 'elsewhere' });
    expect(out).toMatch(/name="contact.name"[^>]*value="Anna Nowak"|value="Anna Nowak"[^>]*name="contact.name"/);
    expect(out).toMatch(/name="contact.email"[^>]*value="anna@firma.pl"|value="anna@firma.pl"[^>]*name="contact.email"/);
    expect(out).toContain('name="returnAddress.street"');
    expect(out).toContain('value="Długa 5"');
    expect(visibleText(out)).toContain('Changes here apply to this complaint only');
  });

  it('renders the clauses: a never-ticked checkbox for must_accept, text for inform_only, the link in a new tab (D-1)', async () => {
    const out = await render({ origin: 'elsewhere' });
    expect(out).toMatch(/<input[^>]*type="checkbox"[^>]*name="accept"[^>]*value="c1:2"/);
    expect(out).not.toMatch(/value="c1:2"[^>]*checked/);
    expect(out).not.toMatch(/name="accept"[^>]*value="c2:1"/);
    expect(out).toContain('name="shownClause" value="c1:2"');
    expect(out).toContain('name="shownClause" value="c2:1"');
    expect(out).toMatch(/href="https:\/\/shop.example\/terms"[^>]*target="_blank"/);
    expect(visibleText(out)).toContain('Shipping is on us.');
  });

  it('offers the typed file inputs without capture, listing the MIME types', async () => {
    const out = await render({ origin: 'elsewhere' });
    for (const type of ['proof_of_purchase', 'other']) expect(out).toContain(`name="files_${type}"`);
    // A defect photo belongs to its product: one photo control per line slot, none for the case.
    expect(out).toContain('name="lines.0.files_photo"');
    expect(out).not.toContain('name="files_photo"');
    expect(out).toContain('accept="image/jpeg,image/png,image/webp,application/pdf"');
    expect(out).not.toContain('capture');
  });

  it('speaks Polish', async () => {
    locale = 'pl-PL';
    const text = visibleText(await render({ origin: 'elsewhere' }));
    expect(text).toContain('Zmiany dotyczą tylko tej reklamacji');
  });
});

/**
 * Reversal of storefront simplification 6.1 — the catalogue product of a line, refused by
 * the API because the channel does not sell it, comes back as a field error and in the
 * summary, with the name kept as a typed model (design review Part 2, *Error copy*).
 */
describe('a catalogue product the channel does not sell', () => {
  it('renders the refusal in the error summary and on that line’s product field, not a crash', async () => {
    const { encodeReturnsAttempt } = await import('../../lib/returns/returnForm');
    attemptCookie = encodeReturnsAttempt({
      answers: { origin: 'elsewhere', 'lines.0.modelName': 'Drill X200', 'lines.0.productRefused': '1', 'lines.0.description': 'Swells' },
      errors: ['unknown_product'],
      uploads: [],
    });
    const out = await render({ origin: 'elsewhere', error: 'refused' });
    const sentence = 'We couldn’t find this product in our catalogue. Type its model name instead.';
    expect(out).toMatch(/<div id="returns-errors" role="alert"/);
    expect(visibleText(out)).toContain(sentence);
    const field = /<input[^>]*name="lines\.0\.modelName"[^>]*>/.exec(out)?.[0] ?? '';
    expect(field).toContain('aria-invalid="true"');
    expect(field).toContain('value="Drill X200"');
    expect(field).toContain('aria-describedby="line-0-model-hint line-0-model-error"');
    expect(out).toMatch(/<p id="line-0-model-error"[^>]*>We couldn’t find this product/);
    expect(out).not.toContain('lines.0.productId');
  });
});

describe('a started line with a required answer missing', () => {
  it('names what is missing in the summary and marks the field on that line, not the generic failure', async () => {
    const { encodeReturnsAttempt } = await import('../../lib/returns/returnForm');
    attemptCookie = encodeReturnsAttempt({
      answers: { origin: 'elsewhere', 'lines.0.modelName': 'Drill X200', 'lines.0.description': '' },
      errors: ['description_missing'],
      uploads: [],
    });
    const out = await render({ origin: 'elsewhere', error: 'refused' });
    const text = visibleText(out);
    expect(text).toContain('Describe the defect of each product: what happens, and since when.');
    expect(text).not.toContain('We couldn’t send your complaint');
    const field = /<textarea[^>]*name="lines\.0\.description"[^>]*>/.exec(out)?.[0] ?? '';
    expect(field).toContain('aria-invalid="true"');
    expect(field).toContain('aria-describedby="line-0-description-hint line-0-description-error"');
    // A line not started is not marked.
    expect(/<textarea[^>]*name="lines\.1\.description"[^>]*>/.exec(out)?.[0]).not.toContain('aria-invalid');
  });
});
