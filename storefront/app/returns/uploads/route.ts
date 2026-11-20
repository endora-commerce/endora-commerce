import { uploadReturnFile } from '../../../lib/api/returns';
import { StorefrontApiError } from '../../../lib/api/client';
import { RETURN_ATTACHMENT_TYPES, type ReturnAttachmentType } from '../../../lib/returns/attachments';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `POST /returns/uploads` — the attachment field's upload with JavaScript
 * (`specs/180-off-platform-complaints/` research R-13): one file and its type, forwarded to
 * `POST /api/v1/returns/uploads` with the customer's session, answered as JSON so the field
 * can show the file attached or refused.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSessionCookie();
  if (!session) return Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  const { ctx } = await getServerContext();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: { code: 'VALIDATION_FAILED' } }, { status: 400 });
  }
  const file = form.get('file');
  const type = String(form.get('type') ?? '');
  if (!file || typeof file === 'string' || !(RETURN_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    return Response.json({ error: { code: 'VALIDATION_FAILED' } }, { status: 400 });
  }
  try {
    const data = await uploadReturnFile(session, { file, filename: file.name, type: type as ReturnAttachmentType }, ctx);
    return Response.json({ data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof StorefrontApiError) {
      const details = (error.details ?? {}) as Record<string, unknown>;
      return Response.json(
        { error: { code: error.code, ...(typeof details['reason'] === 'string' ? { reason: details['reason'] } : {}) } },
        { status: error.status },
      );
    }
    return Response.json({ error: { code: 'UNAVAILABLE' } }, { status: 503 });
  }
}
