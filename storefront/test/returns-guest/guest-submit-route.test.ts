import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';
import { RETURN_FORM_LIMITS } from '../../lib/returns/attachments';

/**
 * `specs/181-guest-complaints/` T064, the handler half (FR-030 – FR-036; contract G6, G7;
 * design review F-4, F-8, F-14): `POST /returns/guest/submit` and `POST
 * /returns/guest/uploads`.
 *
 * - Every call to the backend carries the guest session cookie, and nothing else of the
 *   browser's (research R-4).
 * - The body is the strict G7 shape: no `orderId`, no `contact.email` (F-4).
 * - Success is a `303` to the success page with the tracking link in a flash cookie only
 *   that page reads (F-8); a refusal keeps the answers in 180's attempt cookie; an expired
 *   session keeps the answers but not the files, and asks for a new link (F-14).
 * - The 30 MB rule is 180's.
 */
const uploadGuestFile = vi.fn();
const fileGuestComplaint = vi.fn();

vi.mock('../../lib/api/returns-guest', () => ({
  uploadGuestFile: (...a: unknown[]) => uploadGuestFile(...a),
  fileGuestComplaint: (...a: unknown[]) => fileGuestComplaint(...a),
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'en-US',
    ctx: { salesChannelCode: 'default', locale: 'en-US' },
    urlState: { languages: [], aliases: [], current: 'en-US' },
  }),
}));

const KEY = '9b2d3c4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const REASON = '00000000-0000-4000-8000-0000000000a1';
const BASE: Record<string, string> = {
  submissionKey: KEY,
  'lines.0.modelName': 'Drill X200',
  'lines.0.quantity': '1',
  'lines.0.reasonId': REASON,
  'lines.0.description': 'Battery swells',
  'purchase.date': '2026-10-01',
  'contact.name': 'Anna Nowak',
  'contact.phone': '+48 600 100 200',
  'returnAddress.name': 'Anna Nowak',
  'returnAddress.street': 'Długa 5',
  'returnAddress.postalCode': '00-001',
  'returnAddress.city': 'Warszawa',
  'returnAddress.country': 'PL',
};

const { POST: submit } = await import('../../app/returns/guest/submit/route');
const { POST: upload } = await import('../../app/returns/guest/uploads/route');
const { decodeGuestFiled } = await import('../../lib/returns/guest');

function request(url: string, form: FormData, cookie = 'b2b_returns_guest=guest-session; b2b_session=customer', contentLength?: string): Request {
  const base = new Request(`http://shop.test${url}`, { method: 'POST', body: form });
  const headers = new Headers(base.headers);
  headers.set('cookie', cookie);
  if (contentLength) headers.set('content-length', contentLength);
  return new Request(base, { headers });
}

function formOf(fields: Record<string, string | string[]>, files: Array<[string, File]> = []): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) form.append(key, v);
  for (const [name, file] of files) form.append(name, file);
  return form;
}

const setCookies = (res: Response): string[] => (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie();
const cookieValue = (res: Response, name: string): string | undefined =>
  setCookies(res)
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]!
    .slice(name.length + 1);
const attemptOf = (res: Response): Record<string, unknown> | null => {
  const value = cookieValue(res, 'returns_attempt');
  return value ? (JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>) : null;
};

beforeEach(() => {
  uploadGuestFile.mockReset();
  fileGuestComplaint.mockReset();
  uploadGuestFile.mockImplementation(async (_s: string, input: { type: string }) => ({ uploadId: `up-${input.type}` }));
  fileGuestComplaint.mockResolvedValue({ reference: '#3F9A21C0', trackingToken: 'tok_abc', email: 'anna@example.test' });
});

describe('POST /returns/guest/submit', () => {
  it('uploads each file and files the strict G7 body with the guest session, then 303s to the success page', async () => {
    const res = await submit(
      request(
        '/returns/guest/submit',
        formOf({ ...BASE, 'contact.email': 'mallory@example.test', orderId: 'x', shownClause: 'c1:1', accept: 'c1:1', hp: '' }, [
          ['files_proof_of_purchase', new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' })],
        ]),
      ),
    );
    expect(uploadGuestFile).toHaveBeenCalledWith('guest-session', expect.objectContaining({ type: 'proof_of_purchase', filename: 'receipt.pdf' }), expect.anything());
    const [sessionArg, body] = fileGuestComplaint.mock.calls[0]!;
    expect(sessionArg).toBe('guest-session');
    expect(body).toEqual({
      kind: 'complaint',
      lines: [{ modelName: 'Drill X200', quantity: 1, reasonId: REASON, description: 'Battery swells' }],
      purchase: { date: '2026-10-01' },
      contact: { name: 'Anna Nowak', phone: '+48 600 100 200' },
      returnAddress: { name: 'Anna Nowak', street: 'Długa 5', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL', phone: '+48 600 100 200' },
      shownClauses: [{ id: 'c1', revision: 1 }],
      acceptedClauses: [{ id: 'c1', revision: 1 }],
      attachments: [{ uploadId: 'up-proof_of_purchase' }],
      submissionKey: KEY,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/returns/guest/submitted/${encodeURIComponent('#3F9A21C0')}`);
    // The tracking link travels in a cookie only the success page reads (F-8).
    const flash = setCookies(res).find((c) => c.startsWith('b2b_returns_guest_filed='))!;
    expect(flash).toMatch(/HttpOnly/);
    expect(flash).toMatch(/Path=\/returns\/guest\/submitted/);
    expect(flash).toMatch(/Max-Age=1800/);
    expect(decodeGuestFiled(cookieValue(res, 'b2b_returns_guest_filed'))).toEqual({ ref: '#3F9A21C0', trackingToken: 'tok_abc', email: 'anna@example.test' });
    expect(res.headers.get('location')).not.toContain('tok_abc');
  });

  it('forwards a honeypot hit, which the API answers like a success', async () => {
    await submit(request('/returns/guest/submit', formOf({ ...BASE, hp: 'bot' })));
    expect((fileGuestComplaint.mock.calls[0]![1] as Record<string, unknown>)['hp']).toBe('bot');
  });

  it('does not ask for an e-mail on the form: a missing name is the only contact refusal', async () => {
    const res = await submit(request('/returns/guest/submit', formOf({ ...BASE, 'contact.name': '' })));
    expect(res.headers.get('location')).toBe('/returns/guest/new?error=refused');
    expect(attemptOf(res)!['errors']).toEqual(['contact']);
    expect(fileGuestComplaint).not.toHaveBeenCalled();
  });

  it('keeps the answers and the accepted uploads in 180’s attempt cookie on a refusal', async () => {
    fileGuestComplaint.mockRejectedValue(new StorefrontApiError(422, 'RETURN_PROOF_OF_PURCHASE_REQUIRED', 'attach'));
    const res = await submit(request('/returns/guest/submit', formOf(BASE, [['files_photo', new File(['png'], 'p.png', { type: 'image/png' })]])));
    expect(res.headers.get('location')).toBe('/returns/guest/new?error=refused');
    const attempt = attemptOf(res)!;
    expect(attempt['errors']).toEqual(['RETURN_PROOF_OF_PURCHASE_REQUIRED']);
    expect(attempt['answers']).toMatchObject({ 'contact.name': 'Anna Nowak' });
    expect(attempt['uploads']).toEqual([{ uploadId: 'up-photo', filename: 'p.png', type: 'photo' }]);
    expect(setCookies(res).find((c) => c.startsWith('returns_attempt='))).toMatch(/Path=\/returns/);
  });

  it.each([
    ['cases_per_session', 'guest_limit_cases_per_session'],
    ['cases_per_address', 'guest_limit_cases_per_address'],
  ])('names the guest limit %s in the attempt', async (limit, code) => {
    fileGuestComplaint.mockRejectedValue(new StorefrontApiError(429, 'RETURN_GUEST_LIMIT_REACHED', 'limit', undefined, { limit }));
    const res = await submit(request('/returns/guest/submit', formOf(BASE)));
    expect(attemptOf(res)!['errors']).toEqual([code]);
  });

  it('answers an expired session with a new-link request, the answers kept and the files not (F-14)', async () => {
    fileGuestComplaint.mockRejectedValue(new StorefrontApiError(401, 'RETURN_GUEST_SESSION_REQUIRED', 'again'));
    const res = await submit(request('/returns/guest/submit', formOf({ ...BASE, keepUpload: '7c3d0e22-2222-4222-8222-222222222222' })));
    expect(res.headers.get('location')).toBe(`/returns/guest?reason=session_expired&from=${encodeURIComponent('/returns/guest/new')}`);
    const attempt = attemptOf(res)!;
    expect(attempt['answers']).toMatchObject({ 'contact.name': 'Anna Nowak' });
    expect(attempt['uploads']).toEqual([]);
    expect(attempt['errors']).toEqual(['session_expired']);
  });

  it('answers a browser with no guest session the same way, before anything is uploaded', async () => {
    const res = await submit(request('/returns/guest/submit', formOf(BASE, [['files_photo', new File(['png'], 'p.png')]]), 'b2b_session=customer'));
    expect(res.headers.get('location')).toBe(`/returns/guest?reason=session_expired&from=${encodeURIComponent('/returns/guest/new')}`);
    expect(uploadGuestFile).not.toHaveBeenCalled();
  });

  it('answers the setting off with the disabled notice', async () => {
    fileGuestComplaint.mockRejectedValue(new StorefrontApiError(403, 'RETURN_GUEST_COMPLAINTS_DISABLED', 'off'));
    const res = await submit(request('/returns/guest/submit', formOf(BASE)));
    expect(res.headers.get('location')).toBe('/returns/guest?error=disabled');
  });

  it('refuses a body over 30 MB before reading it, as 180 does (D-9)', async () => {
    const res = await submit(request('/returns/guest/submit', formOf(BASE), undefined, String(RETURN_FORM_LIMITS.maxSubmissionBytes + 1)));
    expect(res.headers.get('location')).toBe('/returns/guest/new?error=too_large');
    expect(setCookies(res)).toEqual([]);
    expect(fileGuestComplaint).not.toHaveBeenCalled();
  });
});

describe('POST /returns/guest/uploads', () => {
  it('forwards one file with the guest session and answers JSON', async () => {
    const res = await upload(request('/returns/guest/uploads', formOf({ type: 'photo' }, [['file', new File(['png'], 'p.png', { type: 'image/png' })]])));
    expect(res.status).toBe(201);
    expect(uploadGuestFile).toHaveBeenCalledWith('guest-session', expect.objectContaining({ type: 'photo', filename: 'p.png' }), expect.anything());
    expect(((await res.json()) as { data: { uploadId: string } }).data.uploadId).toBe('up-photo');
  });

  it('passes a refusal through with its reason, and 401 without a guest session', async () => {
    uploadGuestFile.mockRejectedValue(new StorefrontApiError(422, 'RETURN_ATTACHMENT_REJECTED', 'no', undefined, { reason: 'too_many' }));
    const refused = await upload(request('/returns/guest/uploads', formOf({ type: 'photo' }, [['file', new File(['png'], 'p.png')]])));
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: { code: 'RETURN_ATTACHMENT_REJECTED', reason: 'too_many' } });
    const none = await upload(request('/returns/guest/uploads', formOf({ type: 'photo' }, [['file', new File(['png'], 'p.png')]]), 'b2b_session=customer'));
    expect(none.status).toBe(401);
  });
});
