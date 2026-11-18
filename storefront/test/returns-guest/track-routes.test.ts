import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * `specs/181-guest-complaints/` T065, the transport half (FR-040, FR-042; research R-4,
 * R-5; design review F-2, F-5): how the storefront talks to the guest API, the tracking
 * page's three handlers, the headers of the secret-bearing pages, and the analytics that
 * must never see a token.
 */
const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'en-US',
    ctx: { locale: 'en-US', salesChannelCode: 'default' },
    urlState: { languages: [], aliases: [], current: 'en-US' },
  }),
}));
vi.mock('../../lib/api/channel-headers', () => ({
  activeChannelHeaders: async () => ({ 'x-sales-channel': 'default' }),
}));

const client = await import('../../lib/api/returns-guest');
const { POST: postComment } = await import('../../app/returns/track/[token]/comments/route');
const { POST: postAttachment } = await import('../../app/returns/track/[token]/attachments/route');
const { GET: getFile } = await import('../../app/returns/track/[token]/files/[attachmentId]/route');
const { isSecretBearingPath, redactSecretPath } = await import('../../lib/analytics/secret-paths');

const TOKEN = 'tok_abc-DEF';
const FILE_ID = '00000000-0000-4000-8000-0000000000f1';

function ok(status: number, data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
}
function refused(status: number, code: string, details?: unknown): Response {
  return new Response(JSON.stringify({ error: { code, message: code, ...(details ? { details } : {}) } }), { status });
}
const callOf = (i = 0): { url: string; init: RequestInit & { headers: Record<string, string> } } => {
  const [url, init] = fetchMock.mock.calls[i]!;
  return { url: String(url), init: init as RequestInit & { headers: Record<string, string> } };
};

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('the guest API client (research R-4, R-5)', () => {
  it('sends the tracking token as a header, never in the backend URL', async () => {
    fetchMock.mockResolvedValue(ok(200, { reference: '#1' }));
    await client.getTrackedCase(TOKEN, { ctx: { locale: 'pl-PL' } });
    const { url, init } = callOf();
    expect(url).toBe('http://api.test/api/v1/returns/track');
    expect(url).not.toContain(TOKEN);
    expect(init.headers['x-returns-tracking-token']).toBe(TOKEN);
    expect(init.headers['Accept-Language']).toBe('pl-PL');
    expect(init.headers['x-sales-channel']).toBe('default');
    // No session of any kind travels with a token.
    expect(init.headers['Cookie']).toBeUndefined();
  });

  it('forwards only the allow-listed guest cookie, never the customer session', async () => {
    fetchMock.mockResolvedValue(ok(200, { verifiedEmail: 'a@b.c' }));
    await client.getGuestFormConfig('guest-session', {});
    expect(callOf().init.headers['Cookie']).toBe('b2b_returns_guest=guest-session');
  });

  it('forwards the client address for the per-address limits', async () => {
    fetchMock.mockResolvedValue(ok(202, { linkValidMinutes: 60 }));
    await client.requestGuestVerification({ email: 'a@b.c' }, { forwardedFor: '203.0.113.9' });
    const { url, init } = callOf();
    expect(url).toBe('http://api.test/api/v1/returns/guest/verifications');
    expect(init.method).toBe('POST');
    expect(init.headers['x-forwarded-for']).toBe('203.0.113.9');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.c' });
  });

  it('throws the envelope as a StorefrontApiError, details kept', async () => {
    fetchMock.mockResolvedValue(refused(429, 'RETURN_GUEST_LIMIT_REACHED', { limit: 'comments_per_case' }));
    const error = await client.addTrackedComment(TOKEN, 'hi', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorefrontApiError);
    expect((error as StorefrontApiError).details).toEqual({ limit: 'comments_per_case' });
  });

  it('reads availability as off when it cannot be read', async () => {
    fetchMock.mockRejectedValue(new Error('down'));
    expect(await client.getGuestAvailability({})).toBe(false);
    fetchMock.mockResolvedValue(ok(200, { enabled: true }));
    expect(await client.getGuestAvailability({})).toBe(true);
  });
});

function form(fields: Record<string, string>, file?: File): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (file) f.append('file', file);
  return f;
}
const params = <T extends Record<string, string>>(p: T): { params: Promise<T> } => ({ params: Promise.resolve(p) });

describe('POST /returns/track/[token]/comments', () => {
  it('posts the comment with the token as a header and 303s back to the conversation', async () => {
    fetchMock.mockResolvedValue(ok(201, { id: 'c1' }));
    const res = await postComment(new Request('http://shop.test/x', { method: 'POST', body: form({ body: ' Any news? ' }) }), params({ token: TOKEN }));
    expect(callOf().url).toBe('http://api.test/api/v1/returns/track/comments');
    expect(callOf().init.headers['x-returns-tracking-token']).toBe(TOKEN);
    expect(JSON.parse(String(callOf().init.body))).toEqual({ body: 'Any news?' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/returns/track/${TOKEN}?comment=added#conversation`);
  });

  it.each([
    [refused(429, 'RETURN_GUEST_LIMIT_REACHED', { limit: 'comments_per_case' }), 'comments_per_case'],
    [refused(429, 'RATE_LIMITED'), 'rate_limited'],
    [refused(409, 'RETURN_COMMENTS_CLOSED', { returnCaseId: 'c1', statusCode: 'rejected' }), 'closed'],
    [refused(400, 'VALIDATION_FAILED'), 'refused'],
  ])('words a refusal as a code in the address', async (response, code) => {
    fetchMock.mockResolvedValue(response);
    const res = await postComment(new Request('http://shop.test/x', { method: 'POST', body: form({ body: 'x' }) }), params({ token: TOKEN }));
    expect(res.headers.get('location')).toBe(`/returns/track/${TOKEN}?comment=${code}#conversation`);
  });

  it('sends an invalid link to the neutral page', async () => {
    fetchMock.mockResolvedValue(refused(404, 'RETURN_TRACKING_LINK_INVALID'));
    const res = await postComment(new Request('http://shop.test/x', { method: 'POST', body: form({ body: 'x' }) }), params({ token: TOKEN }));
    expect(res.headers.get('location')).toBe(`/returns/track/${TOKEN}`);
  });
});

describe('POST /returns/track/[token]/attachments', () => {
  it('forwards the file, its type and the line, and 303s back to the files', async () => {
    fetchMock.mockResolvedValue(ok(201, { id: 'a1' }));
    const res = await postAttachment(
      new Request('http://shop.test/x', { method: 'POST', body: form({ type: 'photo', lineIndex: '0' }, new File(['png'], 'p.png', { type: 'image/png' })) }),
      params({ token: TOKEN }),
    );
    const { url, init } = callOf();
    expect(url).toBe('http://api.test/api/v1/returns/track/attachments');
    expect(init.headers['x-returns-tracking-token']).toBe(TOKEN);
    const sent = init.body as FormData;
    expect(sent.get('type')).toBe('photo');
    expect(sent.get('lineIndex')).toBe('0');
    expect((sent.get('file') as File).name).toBe('p.png');
    expect(res.headers.get('location')).toBe(`/returns/track/${TOKEN}?attachment=added#files`);
  });

  it('refuses a missing file without calling the API, and words a full case', async () => {
    const empty = await postAttachment(new Request('http://shop.test/x', { method: 'POST', body: form({ type: 'photo' }) }), params({ token: TOKEN }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(empty.headers.get('location')).toBe(`/returns/track/${TOKEN}?attachment=invalid#files`);
    fetchMock.mockResolvedValue(refused(422, 'RETURN_ATTACHMENT_REJECTED', { reason: 'too_many' }));
    const full = await postAttachment(
      new Request('http://shop.test/x', { method: 'POST', body: form({ type: 'photo' }, new File(['png'], 'p.png')) }),
      params({ token: TOKEN }),
    );
    expect(full.headers.get('location')).toBe(`/returns/track/${TOKEN}?attachment=too_many#files`);
  });

  it('words a finished case as closed (issue #625)', async () => {
    fetchMock.mockResolvedValue(refused(409, 'RETURN_CASE_CLOSED', { returnCaseId: 'c1', statusCode: 'rejected' }));
    const res = await postAttachment(
      new Request('http://shop.test/x', { method: 'POST', body: form({ type: 'photo' }, new File(['png'], 'p.png')) }),
      params({ token: TOKEN }),
    );
    expect(res.headers.get('location')).toBe(`/returns/track/${TOKEN}?attachment=closed#files`);
  });
});

describe('GET /returns/track/[token]/files/[attachmentId]', () => {
  it('streams the file with 180’s headers, the token as a header', async () => {
    fetchMock.mockResolvedValue(
      new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="r.pdf"' } }),
    );
    const res = await getFile(new Request('http://shop.test/x'), params({ token: TOKEN, attachmentId: FILE_ID }));
    expect(callOf().url).toBe(`http://api.test/api/v1/returns/track/attachments/${FILE_ID}/file`);
    expect(callOf().init.headers['x-returns-tracking-token']).toBe(TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await res.text()).toBe('%PDF');
  });

  it('answers 404 for a refused token or a malformed id', async () => {
    fetchMock.mockResolvedValue(refused(404, 'RETURN_TRACKING_LINK_INVALID'));
    expect((await getFile(new Request('http://shop.test/x'), params({ token: TOKEN, attachmentId: FILE_ID }))).status).toBe(404);
    expect((await getFile(new Request('http://shop.test/x'), params({ token: TOKEN, attachmentId: 'nope' }))).status).toBe(404);
  });
});

describe('the secret-bearing pages’ headers (F-5)', () => {
  it('sends no-referrer and noindex on the tracking and verification pages, prefixed or not', async () => {
    const { default: config } = (await import('../../next.config.js')) as { default: { headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> } };
    const rules = await config.headers();
    const headersFor = (source: string): Record<string, string> =>
      Object.fromEntries((rules.find((r) => r.source === source)?.headers ?? []).map((h) => [h.key, h.value]));
    for (const source of ['/returns/track/:path*', '/:lang/returns/track/:path*', '/returns/guest/verify', '/:lang/returns/guest/verify']) {
      expect(headersFor(source)).toMatchObject({ 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    }
    // The later rule wins: the specific ones come after the catch-all.
    const catchAll = rules.findIndex((r) => r.source === '/:path*');
    expect(rules.findIndex((r) => r.source === '/returns/track/:path*')).toBeGreaterThan(catchAll);
  });
});

describe('analytics never sees a token (F-2)', () => {
  it('recognises the secret-bearing paths, with or without a language prefix', () => {
    for (const path of ['/returns/track/tok', '/pl/returns/track/tok', '/returns/guest/verify', '/en/returns/guest/verify?token=x', '/returns/track/tok/files/1']) {
      expect(isSecretBearingPath(path)).toBe(true);
    }
    for (const path of ['/returns', '/returns/guest', '/returns/guest/new', '/returns/1234', '/track']) {
      expect(isSecretBearingPath(path)).toBe(false);
    }
  });

  it('replaces the token and drops the query', () => {
    expect(redactSecretPath('/returns/track/tok_abc?comment=added')).toBe('/returns/track/[token]');
    expect(redactSecretPath('/pl/returns/track/tok_abc/files/1')).toBe('/pl/returns/track/[token]');
    expect(redactSecretPath('/returns/guest/verify?token=abc&state=invalid')).toBe('/returns/guest/verify');
    expect(redactSecretPath('/returns/guest/new?error=refused')).toBe('/returns/guest/new?error=refused');
  });

  it('sends a redacted page_location for a client-side navigation into a secret path', async () => {
    const { pageLocationOf } = await import('../../lib/analytics/gtag');
    expect(pageLocationOf('https://shop.test/returns/track/tok_abc?x=1')).toBe('https://shop.test/returns/track/[token]');
    expect(pageLocationOf('https://shop.test/p/drill?x=1')).toBe('https://shop.test/p/drill?x=1');
  });
});
