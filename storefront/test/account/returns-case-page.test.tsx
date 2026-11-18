import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { visibleText } from './i18n/text';

/**
 * `specs/180-off-platform-complaints/` T091 (FR-B17, FR-B20, FR-B23, FR-B31, FR-B37, D-4,
 * D-9, D-11; design review R-2.5, R-2.6, R-3): the attachment field, and the case page of
 * a complaint without a platform order.
 */
let locale = 'en-US';
let detail: Record<string, unknown>;
let confirmationEmailEnabled = true;

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session-cookie' }));
vi.mock('../../lib/server-context', () => ({ getServerContext: async () => ({ locale, ctx: { locale } }) }));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => { throw new Error(`redirect ${to}`); },
  localizedPath: async (path: string) => path,
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({ customerAccount: { id: 'me', email: 'anna@firma.pl', permissions: ['returns.create'] }, organization: null, impersonation: null }),
}));
vi.mock('../../lib/api/returns', () => ({
  getMyReturn: async () => detail,
  addReturnComment: async () => undefined,
  getReturnFormConfig: async () => ({ confirmationEmailEnabled, clauses: [], today: '2026-11-13' }),
}));

const ID = '3f9a21c0-7b1e-4d2a-9c3b-0123456789ab';
const OFF = {
  id: ID,
  rmaNumber: null,
  reference: '#3F9A21C0',
  kind: 'complaint',
  orderId: null,
  offPlatform: true,
  customerAccountId: 'me',
  statusCode: 'new',
  statusLabel: 'New',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-11-13T10:00:00.000Z',
  resolutionType: null,
  rejectionReason: null,
  freeReturnEligible: false,
  items: [{ id: 'i1', productId: null, productName: 'Drill X200', quantity: 1, description: 'Battery swells', serialNumber: 'SN-1', defaultRefundAmount: 0, approvedRefundAmount: 0 }],
  comments: [],
  purchase: { proofNumber: 'FV/1/2026', date: '2026-10-01' },
  contact: { name: 'Anna Nowak', email: 'anna@firma.pl', phone: null },
  returnAddress: { name: 'Anna Nowak', street: 'Długa 5', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
  attachments: [{ id: 'a1', returnCaseId: ID, type: 'proof_of_purchase', filename: 'receipt.pdf', mimeType: 'application/pdf', sizeBytes: 2048, createdAt: '2026-11-13T10:00:00.000Z' }],
  acceptedClauses: [{ clauseId: 'c1', revision: 2, mode: 'must_accept', language: 'en', label: 'Complaint terms', text: 'We inspect first.', linkUrl: null }],
  clausesAcceptedAt: '2026-11-13T10:00:00.000Z',
};

const { default: ReturnPage } = await import('../../app/(account)/returns/[id]/page');
const { AttachmentField } = await import('../../components/returns/AttachmentField');
const render = async (searchParams: Record<string, string> = {}): Promise<string> =>
  renderToString(
    <>{(await ReturnPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve(searchParams) })) as React.ReactElement}</>,
  );

beforeEach(() => {
  locale = 'en-US';
  detail = { ...OFF };
  confirmationEmailEnabled = true;
});

describe('AttachmentField', () => {
  it('names its type by the control, lists the MIME types and the limits, and never captures', () => {
    const out = renderToString(<AttachmentField type="photo" locale="en-US" id="photos" label="Photos" />);
    expect(out).toContain('name="files_photo"');
    expect(out).toContain('accept="image/jpeg,image/png,image/webp,application/pdf"');
    expect(out).toContain('multiple');
    expect(out).not.toContain('capture');
    expect(visibleText(out)).toContain('JPEG, PNG, WebP or PDF · up to 10 MB each · up to 30 MB and 10 files in total');
    // The budget region is mounted empty for the announcement (WCAG 4.1.3).
    expect(out).toMatch(/role="status"/);
  });
});

describe('the case page of a complaint without an order (R-3)', () => {
  it('titles it by its reference, marks it bought elsewhere and shows no order or refund column', async () => {
    const out = await render();
    expect(visibleText(out)).toContain('Complaint #3F9A21C0');
    expect(visibleText(out)).toContain('Bought elsewhere');
    expect(out).not.toContain('account.returns.col.refund');
    expect(visibleText(out)).not.toContain('Refund');
    expect(visibleText(out)).toContain('FV/1/2026');
    expect(visibleText(out)).toContain('SN-1');
    expect(visibleText(out)).toContain('Długa 5');
  });

  it('lists the attachments with download links and an add form', async () => {
    const out = await render();
    expect(out).toContain(`href="/returns/${ID}/attachments/a1"`);
    expect(out).toMatch(new RegExp(`<form[^>]*action="/returns/${ID}/attachments"`));
    expect(visibleText(out)).toContain('1 of 10 files');
  });

  it('shows the shown clauses in a details element', async () => {
    const out = await render();
    expect(out).toMatch(/<details[^>]*>\s*<summary[^>]*>[^<]*Complaint terms/);
  });

  it('confirms the submission with the reference and the e-mail only while it is enabled, promising no time (FR-B37, D-11)', async () => {
    const text = visibleText(await render({ submitted: '1' }));
    expect(text).toContain('We’ve received your complaint #3F9A21C0.');
    expect(text).toContain('A confirmation is on its way to anna@firma.pl.');
    expect(text).not.toMatch(/working days|within \d/i);
    confirmationEmailEnabled = false;
    expect(visibleText(await render({ submitted: '1' }))).not.toContain('A confirmation is on its way');
  });

  it('renders the over-30 MB refusal in English and Polish (D-9)', async () => {
    const { tooLargeSentence } = await import('../../lib/returns/attachments');
    expect(tooLargeSentence('en-US')).toBe(
      'Your files together were over 30 MB, so nothing was sent. Please fill in the form again and attach fewer or smaller files — you can add more files from the case page after submitting.',
    );
    expect(tooLargeSentence('pl-PL')).toBe(
      'Załączone pliki miały razem ponad 30 MB, więc nic nie zostało wysłane. Wypełnij formularz ponownie i dołącz mniej lub mniejsze pliki — kolejne pliki dodasz na stronie zgłoszenia po jego wysłaniu.',
    );
  });
});
