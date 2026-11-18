import { isUuidShape } from '@endora-commerce/contracts';
import { openTrackedFile } from '../../../../../../lib/api/returns-guest';
import { getServerContext } from '../../../../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `GET /returns/track/[token]/files/[attachmentId]` — a file of the token's case, streamed
 * from the backend with the token as a header (`specs/181-guest-complaints/` contract G10,
 * FR-035). The backend decides: a token that opens nothing, or a file of another case, is
 * one `404` here. Never sniffed, never cached, no referrer — 180's C5 headers.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; attachmentId: string }> },
): Promise<Response> {
  const { token, attachmentId } = await params;
  if (!token || !isUuidShape(attachmentId)) return new Response('Not Found', { status: 404 });
  const { ctx } = await getServerContext();
  const upstream = await openTrackedFile(token, attachmentId, { ctx });
  if (!upstream.ok) return new Response('Not Found', { status: upstream.status === 404 ? 404 : 502 });
  const headers = new Headers({
    'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    'Content-Disposition': upstream.headers.get('content-disposition') ?? 'attachment',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  return new Response(upstream.body, { status: 200, headers });
}
