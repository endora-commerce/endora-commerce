import { isUuidShape } from '@endora-commerce/contracts';
import { openReturnAttachment } from '../../../../../lib/api/returns';
import { getSessionCookie } from '../../../../../lib/session';
import { getServerContext } from '../../../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `GET /returns/[id]/attachments/[attachmentId]` — a case's file, streamed from the backend
 * with the customer's session (`specs/180-off-platform-complaints/` customer-api.md §C5). The
 * backend decides the audience; a 404 passes through as one. The answer is never sniffed and
 * never cached.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<Response> {
  const { id, attachmentId } = await params;
  const session = await getSessionCookie();
  if (!session || !isUuidShape(id) || !isUuidShape(attachmentId)) return new Response('Not Found', { status: 404 });
  const { ctx } = await getServerContext();
  const upstream = await openReturnAttachment(session, id, attachmentId, ctx);
  if (!upstream.ok) return new Response('Not Found', { status: upstream.status === 404 ? 404 : 502 });
  const headers = new Headers({
    'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
    'Content-Disposition': upstream.headers.get('content-disposition') ?? 'attachment',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);
  return new Response(upstream.body, { status: 200, headers });
}
