import { uploadGuestFile } from '../../../../lib/api/returns-guest';
import { StorefrontApiError } from '../../../../lib/api/client';
import { RETURN_ATTACHMENT_TYPES, type ReturnAttachmentType } from '../../../../lib/returns/attachments';
import { RETURNS_GUEST_SESSION_COOKIE, forwardedForOf, requestCookie } from '../../../../lib/returns/guest';
import { getServerContext } from '../../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `POST /returns/guest/uploads` — the guest form's attachment field with JavaScript
 * (`specs/181-guest-complaints/` contract G6): one file and its type, forwarded with the
 * guest session — the upload is the session's (FR-035) — and answered as JSON, as 180's
 * `/returns/uploads` answers the customer's field.
 */
export async function POST(request: Request): Promise<Response> {
  const session = requestCookie(request, RETURNS_GUEST_SESSION_COOKIE);
  if (!session) return Response.json({ error: { code: 'RETURN_GUEST_SESSION_REQUIRED' } }, { status: 401 });
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
    const data = await uploadGuestFile(
      session,
      { file, filename: file.name, type: type as ReturnAttachmentType },
      { ctx, forwardedFor: forwardedForOf(request) },
    );
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
