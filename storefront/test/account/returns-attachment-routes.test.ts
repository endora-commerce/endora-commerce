import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * `specs/180-off-platform-complaints/` T090 (FR-B20, FR-B22; research R-13): the JS upload,
 * the no-JS add to an open case, and the download proxy — each forwards the session and
 * nothing else.
 */
const uploadReturnFile = vi.fn();
const addReturnAttachment = vi.fn();
const openReturnAttachment = vi.fn();

vi.mock('../../lib/api/returns', () => ({
  uploadReturnFile: (...args: unknown[]) => uploadReturnFile(...args),
  addReturnAttachment: (...args: unknown[]) => addReturnAttachment(...args),
  openReturnAttachment: (...args: unknown[]) => openReturnAttachment(...args),
}));
vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'sess-1' }));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'en-US',
    ctx: { salesChannelCode: 'default', locale: 'en-US' },
    urlState: { languages: [{ languageCode: 'en-US', prefix: 'en', prefixed: false, isDefault: true }], aliases: [], current: 'en-US' },
  }),
}));

const ID = '3f9a21c0-7b1e-4d2a-9c3b-0123456789ab';
const A = '5b2c0d11-1111-4111-8111-111111111111';

function multipart(type: string): Request {
  const form = new FormData();
  form.append('type', type);
  form.append('file', new File(['%PDF'], 'receipt.pdf', { type: 'application/pdf' }));
  return new Request('http://shop.test/x', { method: 'POST', body: form });
}

beforeEach(() => {
  for (const fn of [uploadReturnFile, addReturnAttachment, openReturnAttachment]) fn.mockReset();
});

describe('POST /returns/uploads (the JS path)', () => {
  it('forwards one file with the session and answers the upload as JSON', async () => {
    uploadReturnFile.mockResolvedValue({ uploadId: 'up-1', type: 'proof_of_purchase' });
    const { POST } = await import('../../app/returns/uploads/route');
    const res = await POST(multipart('proof_of_purchase'));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { uploadId: 'up-1', type: 'proof_of_purchase' } });
    expect(uploadReturnFile).toHaveBeenCalledWith('sess-1', expect.objectContaining({ type: 'proof_of_purchase', filename: 'receipt.pdf' }), expect.anything());
  });

  it('passes a refusal through with its code', async () => {
    uploadReturnFile.mockRejectedValue(new StorefrontApiError(413, 'RETURN_ATTACHMENT_REJECTED', 'too big', undefined, { reason: 'too_large' }));
    const { POST } = await import('../../app/returns/uploads/route');
    const res = await POST(multipart('photo'));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: { code: 'RETURN_ATTACHMENT_REJECTED', reason: 'too_large' } });
  });
});

describe('POST /returns/[id]/attachments (the no-JS add)', () => {
  it('forwards the file and answers 303 back to the case', async () => {
    addReturnAttachment.mockResolvedValue({ id: A });
    const { POST } = await import('../../app/returns/[id]/attachments/route');
    const res = await POST(multipart('photo'), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/returns/${ID}?attachment=added`);
    expect(addReturnAttachment).toHaveBeenCalledWith('sess-1', ID, expect.objectContaining({ type: 'photo' }), expect.anything());
  });
});

describe('GET /returns/[id]/attachments/[attachmentId]', () => {
  it('streams the backend answer with its headers', async () => {
    openReturnAttachment.mockResolvedValue(
      new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="receipt.pdf"' } }),
    );
    const { GET } = await import('../../app/returns/[id]/attachments/[attachmentId]/route');
    const res = await GET(new Request('http://shop.test/x'), { params: Promise.resolve({ id: ID, attachmentId: A }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe('%PDF');
    expect(openReturnAttachment).toHaveBeenCalledWith('sess-1', ID, A, expect.anything());
  });

  it('passes a 404 through', async () => {
    openReturnAttachment.mockResolvedValue(new Response('{}', { status: 404 }));
    const { GET } = await import('../../app/returns/[id]/attachments/[attachmentId]/route');
    const res = await GET(new Request('http://shop.test/x'), { params: Promise.resolve({ id: ID, attachmentId: A }) });
    expect(res.status).toBe(404);
  });
});
