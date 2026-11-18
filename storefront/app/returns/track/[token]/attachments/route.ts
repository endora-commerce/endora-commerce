import { addTrackedAttachment } from '../../../../../lib/api/returns-guest';
import { StorefrontApiError } from '../../../../../lib/api/client';
import { localizePath } from '../../../../../lib/i18n/locale-path';
import { RETURN_ATTACHMENT_TYPES, RETURN_FORM_LIMITS, type ReturnAttachmentType } from '../../../../../lib/returns/attachments';
import { forwardedForOf } from '../../../../../lib/returns/guest';
import { getServerContext } from '../../../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `POST /returns/track/[token]/attachments` — the tracking page's *Add a file* form, without
 * JavaScript (`specs/181-guest-complaints/` contract G10, FR-042): the file, its type and the
 * product it shows (`lineIndex`) forwarded with the token as a header, then `303` back to the
 * files with a fixed outcome code (180's `/returns/[id]/attachments`, for a guest).
 */
function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

/** The outcome codes, each a literal address suffix — never a value built into the URL (issues #790, #810). */
type Outcome = 'added' | 'too_many' | 'too_large' | 'invalid' | 'rate_limited' | 'closed' | 'refused';
const OUTCOMES: Readonly<Record<Outcome, string>> = {
  added: '?attachment=added#files',
  too_many: '?attachment=too_many#files',
  too_large: '?attachment=too_large#files',
  invalid: '?attachment=invalid#files',
  rate_limited: '?attachment=rate_limited#files',
  closed: '?attachment=closed#files',
  refused: '?attachment=refused#files',
};

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const { ctx, urlState } = await getServerContext();
  const page = urlState ? localizePath(`/returns/track/${token}`, urlState) : `/returns/track/${token}`;
  const result = (code: Outcome): Response => seeOther(`${page}${OUTCOMES[code]}`);
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > RETURN_FORM_LIMITS.maxFileBytes + 64 * 1024) return result('too_large');
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return result('invalid');
  }
  const file = form.get('file');
  const type = String(form.get('type') ?? 'photo');
  const line = Number(String(form.get('lineIndex') ?? ''));
  if (!file || typeof file === 'string' || file.size === 0 || !(RETURN_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    return result('invalid');
  }
  try {
    await addTrackedAttachment(
      token,
      {
        file,
        filename: file.name,
        type: type as ReturnAttachmentType,
        ...(String(form.get('lineIndex') ?? '') !== '' && Number.isInteger(line) && line >= 0 ? { lineIndex: line } : {}),
      },
      { ctx, forwardedFor: forwardedForOf(request) },
    );
    return result('added');
  } catch (error) {
    if (!(error instanceof StorefrontApiError)) return result('refused');
    const details = (error.details ?? {}) as Record<string, unknown>;
    if (error.status === 404) return seeOther(page);
    if (details['reason'] === 'too_many') return result('too_many');
    if (error.status === 429) return result('rate_limited');
    if (error.status === 409 || error.code === 'RETURN_CASE_CLOSED') return result('closed');
    return result('refused');
  }
}
