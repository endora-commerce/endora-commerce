import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { visibleText } from './i18n/text';

/**
 * `specs/180-off-platform-complaints/` T113 (FR-B36, D-3, D-4; design review R-3.7): the
 * customer's list names each case by its reference, its product and, for a purchase
 * made elsewhere, its date — never `—` as the link text.
 */
let locale = 'en-US';
const base = {
  kind: 'complaint',
  customerAccountId: 'me',
  statusCode: 'new',
  statusLabel: 'New',
  currency: 'PLN',
  submittedAt: '2026-11-01T10:00:00.000Z',
  totalRefundAmount: 0,
};
const CASES = [
  { ...base, id: 'c1', rmaNumber: null, reference: '#3F9A21C0', orderId: null, offPlatform: true, productLabel: 'Drill X200', lineCount: 3, purchaseDate: '2026-10-01' },
  { ...base, id: 'c2', rmaNumber: 'RMA-7', reference: 'RMA-7', orderId: 'o1', offPlatform: false, productLabel: 'Widget', lineCount: 1, purchaseDate: null, totalRefundAmount: 12.5 },
];

vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../lib/server-context', () => ({ getServerContext: async () => ({ locale, ctx: { locale } }) }));
vi.mock('../../lib/i18n/navigation', () => ({ localeRedirect: async (to: string) => { throw new Error(`redirect ${to}`); } }));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({ customerAccount: { id: 'me', permissions: ['returns.create'], organizationRole: { kind: 'custom' } }, organization: null, impersonation: null }),
}));
vi.mock('../../lib/api/returns', () => ({ listMyReturns: async () => CASES }));

const { default: ReturnsPage } = await import('../../app/(account)/returns/page');
const html = async (): Promise<string> => renderToString(<>{(await ReturnsPage()) as React.ReactElement}</>);

beforeEach(() => {
  locale = 'en-US';
});

describe('the customer’s returns list (180 T113)', () => {
  it('uses the reference as the link text, never a dash', async () => {
    const out = await html();
    expect(out).toMatch(/<a[^>]*href="\/returns\/c1"[^>]*>#3F9A21C0<\/a>/);
    expect(out).toMatch(/<a[^>]*href="\/returns\/c2"[^>]*>RMA-7<\/a>/);
  });

  it('shows the product with "+N more", and the purchase date and "Bought elsewhere" for an off-platform case', async () => {
    const text = visibleText(await html());
    expect(text).toContain('Drill X200 +2 more');
    expect(text).toContain('Widget');
    expect(text).toContain('Bought elsewhere');
    expect(text).toContain('10/1/2026');
  });

  it('says the refund does not apply to an off-platform case', async () => {
    const out = await html();
    expect(out).toContain('Not applicable');
    expect(visibleText(out)).toMatch(/12[.,]50/);
  });

  it('speaks Polish', async () => {
    locale = 'pl-PL';
    const text = visibleText(await html());
    expect(text).toContain('Kupione gdzie indziej');
    expect(text).toContain('+2 więcej');
  });
});
