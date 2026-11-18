import { isUuidShape } from '@endora-commerce/contracts';
import { addReturnAttachment } from '../../../../lib/api/returns';
import { StorefrontApiError } from '../../../../lib/api/client';
import { localizePath } from '../../../../lib/i18n/locale-path';
import { RETURN_ATTACHMENT_TYPES, RETURN_FORM_LIMITS, type ReturnAttachmentType } from '../../../../lib/returns/attachments';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `POST /returns/[id]/attachments` — the case page's *Add a file* form, without JavaScript
 * (`specs/180-off-platform-complaints/` research R-13, customer-api.md §C4): the file and its
 * type forwarded with the customer's session, then `303` back to the case, with an outcome
 * code — never a sentence — in the address.
 */
function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const { ctx, urlState } = await getServerContext();
  const at = (path: string): string => (urlState ? localizePath(path, urlState) : path);
  if (!isUuidShape(id)) return seeOther(at('/returns'));
  const session = await getSessionCookie();
  if (!session) return seeOther(at(`/login?next=${encodeURIComponent(`/returns/${id}`)}`));
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > RETURN_FORM_LIMITS.maxFileBytes + 64 * 1024) {
    return seeOther(at(`/returns/${id}?attachment=too_large`));
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return seeOther(at(`/returns/${id}?attachment=invalid`));
  }
  const file = form.get('file');
  const type = String(form.get('type') ?? 'photo');
  // The product the file shows, when the customer chose one; the API checks it is this case's.
  const item = String(form.get('item') ?? '');
  if (!file || typeof file === 'string' || file.size === 0 || !(RETURN_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    return seeOther(at(`/returns/${id}?attachment=invalid`));
  }
  try {
    await addReturnAttachment(
      session,
      id,
      { file, filename: file.name, type: type as ReturnAttachmentType, ...(isUuidShape(item) ? { returnCaseItemId: item } : {}) },
      ctx,
    );
    return seeOther(at(`/returns/${id}?attachment=added`));
  } catch (error) {
    // A fixed token, never the API's text (issue #790): a full case, or any other refusal.
    const details = error instanceof StorefrontApiError ? ((error.details ?? {}) as Record<string, unknown>) : {};
    if (details['reason'] === 'too_many') return seeOther(at(`/returns/${id}?attachment=too_many`));
    return seeOther(at(`/returns/${id}?attachment=refused`));
  }
}
