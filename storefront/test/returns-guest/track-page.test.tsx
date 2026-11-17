import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StorefrontApiError } from '../../lib/api/client';
import { tForLocale } from '../../lib/i18n/messages';
import { visibleText } from '../account/i18n/text';

/**
 * `specs/181-guest-complaints/` T065, the page half (US2; FR-040 – FR-043; owner ruling
 * O-1; design review S-7, S-8, F-6, F-12, F-15): `/returns/track/[token]`.
 *
 * - The view renders as the account case page does: the reference, the status, the
 *   products, the purchase, the contact, the files and the conversation.
 * - A closed case is read-only and says until when the page works; a rejected one says why.
 * - Every invalid link is `notFound()` from the page, so the segment's neutral page renders,
 *   and nothing on it depends on the token.
 */
const en = tForLocale('en-US');

const getTrackedCase = vi.fn();
const NOT_FOUND = 'NEXT_NOT_FOUND';
const TOKEN = 'tok_abc-DEF';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'en-US',
    ctx: { locale: 'en-US', salesChannelCode: 'default' },
    modules: { isPresent: () => true, presentIds: [], absentIds: [] },
    urlState: { languages: [], aliases: [], current: 'en-US' },
  }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  localizedPath: async (path: string) => path,
}));
vi.mock('../../lib/api/returns-guest', () => ({
  getTrackedCase: (...a: unknown[]) => getTrackedCase(...a),
}));

const { default: TrackPage } = await import('../../app/returns/track/[token]/page');
const { default: TrackNotFound } = await import('../../app/returns/track/[token]/not-found');

const VIEW = {
  reference: '#3F9A21C0',
  kind: 'complaint',
  status: { code: 'new', label: 'New' },
  isClosed: false,
  submittedAt: '2026-11-16T10:00:00.000Z',
  lines: [{ productName: 'Drill X200', quantity: 1, reasonLabel: 'Defective', description: 'Battery swells', serialNumber: 'SN-1' }],
  purchase: { proofNumber: 'FV/1', date: '2026-10-01' },
  contact: { name: 'Anna Nowak', email: 'anna@example.test', phone: null },
  returnAddress: { name: 'Anna Nowak', street: 'Długa 5', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' },
  rmaNumber: null,
  comments: [
    { id: '00000000-0000-4000-8000-000000000001', authorKind: 'you', body: 'Please hurry', createdAt: '2026-11-16T10:00:00.000Z' },
    { id: '00000000-0000-4000-8000-000000000002', authorKind: 'shop', body: 'We are checking it', createdAt: '2026-11-16T11:00:00.000Z' },
  ],
  attachments: [{ id: '00000000-0000-4000-8000-0000000000f1', type: 'proof_of_purchase', filename: 'receipt.pdf', sizeBytes: 2048, lineIndex: null }],
  linkValidUntil: null,
  rejectionReason: null,
};

const render = async (query: Record<string, string> = {}): Promise<string> =>
  renderToString(
    <>{(await TrackPage({ params: Promise.resolve({ token: TOKEN }), searchParams: Promise.resolve(query) })) as React.ReactElement}</>,
  );

beforeEach(() => {
  getTrackedCase.mockReset();
  getTrackedCase.mockResolvedValue(VIEW);
});

describe('the tracking page (S-7)', () => {
  it('renders the case the token opens, as the account case page does', async () => {
    const out = await render();
    expect(getTrackedCase.mock.calls[0]![0]).toBe(TOKEN);
    const text = visibleText(out);
    expect(out).toMatch(/<h1[^>]*>Complaint #3F9A21C0<\/h1>/);
    expect(text).toContain('New');
    expect(text).toContain(en('returns.boughtElsewhere'));
    expect(text).toContain('Drill X200');
    expect(text).toContain('Battery swells');
    expect(text).toContain('SN-1');
    expect(text).toContain('FV/1');
    expect(text).toContain('Długa 5');
    expect(text).toContain('anna@example.test');
    // Comments: the shop and the guest, never staff names.
    expect(text).toContain(`${en('returns.guest.track.authorShop')} ·`);
    expect(text).toContain(`${en('returns.guest.track.authorYou')} ·`);
    // FR-041 — anyone with the link can see the case, said on every visit.
    expect(text).toContain(en('returns.guest.track.anyone'));
  });

  it('downloads through the storefront’s own route, never an image preview through the token URL (F-12)', async () => {
    const out = await render();
    expect(out).toContain(`href="/returns/track/${TOKEN}/files/00000000-0000-4000-8000-0000000000f1"`);
    expect(out).not.toMatch(/<img[^>]*\/returns\/track\//);
  });

  it('offers a comment and a file while the case is open, with focusable result anchors (F-15)', async () => {
    const out = await render({ comment: 'added' });
    expect(out).toMatch(/<form[^>]*action="\/returns\/track\/tok_abc-DEF\/comments"/);
    expect(out).toMatch(/<form[^>]*action="\/returns\/track\/tok_abc-DEF\/attachments"[^>]*enctype="multipart\/form-data"|<form[^>]*enctype="multipart\/form-data"[^>]*action="\/returns\/track\/tok_abc-DEF\/attachments"/i);
    expect(out).toMatch(/id="conversation"[^>]*tabindex="-1"|tabindex="-1"[^>]*id="conversation"/i);
    expect(out).toMatch(/id="files"[^>]*tabindex="-1"|tabindex="-1"[^>]*id="files"/i);
    expect(visibleText(out)).toContain(en('returns.guest.track.commentAdded'));
  });

  it('is read-only once closed, and says until when the page works (FR-042)', async () => {
    getTrackedCase.mockResolvedValue({ ...VIEW, isClosed: true, status: { code: 'closed', label: 'Closed' }, linkValidUntil: '2027-02-14T10:00:00.000Z' });
    const out = await render();
    expect(out).not.toContain('/comments"');
    expect(out).not.toContain('/attachments"');
    const text = visibleText(out);
    expect(text).toContain('2/14/2027');
    expect(text).toContain(en('returns.guest.track.closedTail'));
  });

  it('says why a rejected complaint was rejected (owner ruling O-1)', async () => {
    getTrackedCase.mockResolvedValue({ ...VIEW, isClosed: true, status: { code: 'rejected', label: 'Rejected' }, rejectionReason: 'No defect found', linkValidUntil: '2027-02-14T10:00:00.000Z' });
    expect(visibleText(await render())).toContain('Rejection reason: No defect found');
  });

  it.each([
    ['comments_per_case', 'returns.guest.track.commentLimit'],
    ['closed', 'returns.guest.track.closedMeanwhile'],
    ['rate_limited', 'returns.guest.errors.rate_limited'],
  ] as const)('words the comment result %s', async (code, key) => {
    expect(visibleText(await render({ comment: code }))).toContain(en(key));
  });

  it('answers every invalid link with notFound(), so the neutral page renders (FR-043, F-6)', async () => {
    getTrackedCase.mockRejectedValue(new StorefrontApiError(404, 'RETURN_TRACKING_LINK_INVALID', 'gone'));
    await expect(render()).rejects.toThrow(NOT_FOUND);
  });

  it('does not swallow another failure as an invalid link', async () => {
    getTrackedCase.mockRejectedValue(new StorefrontApiError(503, 'UNAVAILABLE', 'down'));
    await expect(render()).rejects.toThrow(/UNAVAILABLE/);
  });
});

describe('the neutral invalid-link page (S-8)', () => {
  it('says the link does not work, without saying whether the case exists, and depends on no token', async () => {
    const out = renderToString(<>{(await TrackNotFound()) as React.ReactElement}</>);
    const text = visibleText(out);
    expect(text).toContain(en('returns.guest.notFound.heading'));
    expect(text).toContain(en('returns.guest.notFound.body'));
    expect(text).not.toMatch(/erased|not found|deleted/i);
    expect(out).not.toContain('<form');
  });
});
