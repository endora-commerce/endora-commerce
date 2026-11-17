import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * `specs/180-off-platform-complaints/` T089 (FR-B20, D-9, D-15; research R-13): the
 * storefront handler behind the returns form — it uploads each file, files the case with
 * the upload ids, the clauses and the submission key, and answers with a 303 either way.
 */
const uploadReturnFile = vi.fn();
const createReturnCase = vi.fn();
let session: string | null = 'sess-1';

vi.mock('../../lib/api/returns', () => ({
  uploadReturnFile: (...args: unknown[]) => uploadReturnFile(...args),
  createReturnCase: (...args: unknown[]) => createReturnCase(...args),
}));
vi.mock('../../lib/session', () => ({ getSessionCookie: async () => session }));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'en-US',
    ctx: { salesChannelCode: 'default', locale: 'en-US' },
    urlState: { languages: [{ languageCode: 'en-US', prefix: 'en', prefixed: false, isDefault: true }], aliases: [], current: 'en-US' },
  }),
}));

const KEY = '9b2d3c4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const BASE: Record<string, string> = {
  origin: 'elsewhere',
  submissionKey: KEY,
  'lines.0.modelName': 'Drill X200',
  'lines.0.quantity': '1',
  'lines.0.reasonId': '00000000-0000-4000-8000-0000000000r1'.replace('r1', 'a1'),
  'lines.0.description': 'Battery swells',
  'purchase.date': '2026-10-01',
  'contact.name': 'Anna Nowak',
  'contact.email': 'anna@firma.pl',
  'returnAddress.name': 'Anna Nowak',
  'returnAddress.street': 'Długa 5',
  'returnAddress.postalCode': '00-001',
  'returnAddress.city': 'Warszawa',
  'returnAddress.country': 'PL',
};

async function post(fields: Record<string, string | string[]>, files: Array<[string, File]> = [], contentLength?: string): Promise<Response> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) form.append(key, v);
  for (const [name, file] of files) form.append(name, file);
  const request = new Request('http://shop.test/returns/submit', { method: 'POST', body: form });
  const headers = new Headers(request.headers);
  if (contentLength) headers.set('content-length', contentLength);
  const { POST } = await import('../../app/returns/submit/route');
  return POST(new Request(request, { headers }));
}

function attemptOf(response: Response): Record<string, unknown> | null {
  const cookie = response.headers.get('set-cookie') ?? '';
  const value = /returns_attempt=([^;]+)/.exec(cookie)?.[1];
  return value ? JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) : null;
}

beforeEach(() => {
  session = 'sess-1';
  uploadReturnFile.mockReset();
  createReturnCase.mockReset();
  uploadReturnFile.mockImplementation(async (_s: string, input: { type: string }) => ({ uploadId: `up-${input.type}` }));
  createReturnCase.mockResolvedValue({ id: 'case-1' });
});

describe('POST /returns/submit', () => {
  it('uploads each file, files the case with the ids, the clauses and the key, and answers 303 to the case', async () => {
    const res = await post(
      { ...BASE, shownClause: ['c1:2', 'c2:1'], accept: 'c1:2', keepUpload: '7c3d0e22-2222-4222-8222-222222222222' },
      [['files_proof_of_purchase', new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' })]],
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/returns/case-1?submitted=1');
    expect(uploadReturnFile).toHaveBeenCalledWith('sess-1', expect.objectContaining({ type: 'proof_of_purchase', filename: 'receipt.pdf' }), expect.anything());
    const [sessionArg, body] = createReturnCase.mock.calls[0]!;
    expect(sessionArg).toBe('sess-1');
    expect(body).toMatchObject({
      orderId: null,
      kind: 'complaint',
      submissionKey: KEY,
      lines: [{ modelName: 'Drill X200', quantity: 1, description: 'Battery swells' }],
      purchase: { date: '2026-10-01' },
      contact: { name: 'Anna Nowak', email: 'anna@firma.pl' },
      returnAddress: { street: 'Długa 5', countryCode: 'PL' },
      shownClauses: [{ id: 'c1', revision: 2 }, { id: 'c2', revision: 1 }],
      acceptedClauses: [{ id: 'c1', revision: 2 }],
    });
    expect((body as { attachments: Array<{ uploadId: string }> }).attachments.map((a) => a.uploadId).sort()).toEqual(['7c3d0e22-2222-4222-8222-222222222222', 'up-proof_of_purchase']);
    // Never a channel or an organization from the form.
    expect(JSON.stringify(body)).not.toMatch(/salesChannel|organizationId/);
  });

  it('answers a refusal with a 303 back and the typed answers in a path-scoped attempt cookie, keeping the uploads', async () => {
    createReturnCase.mockRejectedValue(
      new StorefrontApiError(422, 'RETURN_PROOF_OF_PURCHASE_REQUIRED', 'Attach a proof of purchase.'),
    );
    const res = await post(BASE, [['files_photo', new File(['png'], 'p.png', { type: 'image/png' })]]);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/returns/new?origin=elsewhere&error=refused');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/Path=\/returns/);
    expect(cookie).toMatch(/Max-Age=\d+/);
    const attempt = attemptOf(res)!;
    // The code travels in the cookie, never in the address (issues #745, #790).
    expect(attempt['errors']).toEqual(['RETURN_PROOF_OF_PURCHASE_REQUIRED']);
    expect(attempt['answers']).toMatchObject({ 'contact.name': 'Anna Nowak' });
    expect(attempt['uploads']).toEqual([{ uploadId: 'up-photo', filename: 'p.png', type: 'photo' }]);
    expect(JSON.stringify(attempt)).not.toContain('png\u0000');
  });

  it('refuses a post with no line, on both paths, with an error rather than a silent redirect (D-15)', async () => {
    const noLine = { ...BASE, 'lines.0.modelName': '', 'lines.0.description': '' };
    const res = await post(noLine);
    expect(res.headers.get('location')).toBe('/returns/new?origin=elsewhere&error=refused');
    expect(attemptOf(res)!['errors']).toEqual(['no_line']);
    expect(createReturnCase).not.toHaveBeenCalled();
    const order = await post({ orderId: '11111111-2222-4333-8444-555555555555', kind: 'return', submissionKey: KEY });
    expect(order.headers.get('location')).toBe('/returns/new?orderId=11111111-2222-4333-8444-555555555555&error=refused');
    expect(attemptOf(order)!['errors']).toEqual(['no_line']);
  });

  it('refuses a started line without its reason or its description by name, before the API (not a bare validation failure)', async () => {
    const res = await post({ ...BASE, 'lines.0.reasonId': '', 'lines.0.description': '' });
    expect(res.headers.get('location')).toBe('/returns/new?origin=elsewhere&error=refused');
    expect(attemptOf(res)!['errors']).toEqual(['reason_missing', 'description_missing']);
    const noDescription = await post({ ...BASE, 'lines.0.description': '' });
    expect(attemptOf(noDescription)!['errors']).toEqual(['description_missing']);
    const noProduct = await post({ ...BASE, 'lines.0.modelName': '' });
    expect(attemptOf(noProduct)!['errors']).toEqual(['product_missing']);
    expect(createReturnCase).not.toHaveBeenCalled();
  });

  it('ties each line’s photos to its line by position, skipping the empty slots, and keeps case files case-level', async () => {
    createReturnCase.mockResolvedValue({ id: 'case-1' });
    uploadReturnFile.mockResolvedValue({ uploadId: 'up-nojs' });
    const PHOTO_A = '33333333-3333-4333-8333-333333333333';
    const PHOTO_C = '44444444-4444-4444-8444-444444444444';
    const RECEIPT = '55555555-5555-4555-8555-555555555555';
    await post(
      {
        ...BASE,
        'lines.0.uploadId': PHOTO_A,
        // Slot 1 left empty; slot 2 is the second line sent.
        'lines.2.modelName': 'Saw S1',
        'lines.2.reasonId': BASE['lines.0.reasonId']!,
        'lines.2.description': 'Blade loose',
        'lines.2.uploadId': PHOTO_C,
        uploadId: RECEIPT,
      },
      [['lines.2.files_photo', new File(['x'], 'saw.jpg', { type: 'image/jpeg' })]],
    );
    const body = createReturnCase.mock.calls[0]![1] as { lines: unknown[]; attachments: Array<{ uploadId: string; line?: number }> };
    expect(body.lines).toHaveLength(2);
    expect(body.attachments).toEqual(
      expect.arrayContaining([
        { uploadId: RECEIPT },
        { uploadId: PHOTO_A, line: 0 },
        { uploadId: PHOTO_C, line: 1 },
        { uploadId: 'up-nojs', line: 1 },
      ]),
    );
    expect(body.attachments).toHaveLength(4);
    expect(uploadReturnFile.mock.calls[0]![1]).toMatchObject({ filename: 'saw.jpg', type: 'photo' });
  });

  it('refuses a body over 30 MB before reading it, with no cookie (D-9)', async () => {
    const res = await post(BASE, [], String(31 * 1024 * 1024));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/returns/new?error=too_large');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(createReturnCase).not.toHaveBeenCalled();
  });

  // Reversal of storefront simplification 6.1 — the catalogue product of a line.
  const PRODUCT = '11111111-1111-4111-8111-111111111111';

  it('forwards a chosen catalogue product as productId, never with the model name beside it', async () => {
    await post({ ...BASE, 'lines.0.productId': PRODUCT, 'lines.0.modelName': 'Drill X200' });
    const body = createReturnCase.mock.calls[0]![1] as { lines: Array<Record<string, unknown>> };
    expect(body.lines[0]).toMatchObject({ productId: PRODUCT });
    expect(body.lines[0]).not.toHaveProperty('modelName');
  });

  it('forwards a typed model with no productId when none was chosen', async () => {
    await post(BASE);
    const body = createReturnCase.mock.calls[0]![1] as { lines: Array<Record<string, unknown>> };
    expect(body.lines[0]).toMatchObject({ modelName: 'Drill X200' });
    expect(body.lines[0]).not.toHaveProperty('productId');
  });

  it('answers a product the channel does not sell with a refusal on that line, keeping its name as a typed model', async () => {
    createReturnCase.mockRejectedValue(
      new StorefrontApiError(422, 'VALIDATION_FAILED', 'Unknown product.', undefined, { code: 'unknown_product' }),
    );
    const res = await post({
      ...BASE,
      'lines.0.productId': PRODUCT,
      'lines.0.modelName': 'Drill X200',
      'lines.1.modelName': 'Saw S1',
      'lines.1.reasonId': BASE['lines.0.reasonId']!,
      'lines.1.description': 'Blade loose',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/returns/new?origin=elsewhere&error=refused');
    const attempt = attemptOf(res)!;
    expect(attempt['errors']).toEqual(['unknown_product']);
    const answers = attempt['answers'] as Record<string, string>;
    // One click to resubmit: the name stays, as a typed model, and the product is dropped.
    expect(answers['lines.0.modelName']).toBe('Drill X200');
    expect(answers).not.toHaveProperty('lines.0.productId');
    expect(answers['lines.0.productRefused']).toBe('1');
    expect(answers).not.toHaveProperty('lines.1.productRefused');
  });

  it('sends a signed-out post to sign in', async () => {
    session = null;
    const res = await post(BASE);
    expect(res.headers.get('location')).toMatch(/^\/login\?next=/);
  });
});
