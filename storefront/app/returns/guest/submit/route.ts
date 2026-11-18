import { isUuidShape, type CreateGuestComplaintRequest } from '@endora-commerce/contracts';
import { fileGuestComplaint, uploadGuestFile } from '../../../../lib/api/returns-guest';
import { StorefrontApiError } from '../../../../lib/api/client';
import { localizePath } from '../../../../lib/i18n/locale-path';
import { RETURN_ATTACHMENT_TYPES, RETURN_FORM_LIMITS } from '../../../../lib/returns/attachments';
import {
  OFF_PLATFORM_FORM_LINES,
  RETURNS_ATTEMPT_COOKIE,
  RETURNS_ATTEMPT_MAX_AGE,
  answersOf,
  encodeReturnsAttempt,
  lineFilesOf,
  lineUploadsOf,
  type ReturnsAttemptUpload,
} from '../../../../lib/returns/returnForm';
import {
  GUEST_FILED_MAX_AGE,
  GUEST_FORM_PATH,
  RETURNS_GUEST_FILED_COOKIE,
  RETURNS_GUEST_SESSION_COOKIE,
  encodeGuestFiled,
  forwardedForOf,
  guestBodyOf,
  requestCookie,
  setCookie,
} from '../../../../lib/returns/guest';
import { getServerContext } from '../../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `POST /returns/guest/submit` — the guest form's handler (`specs/181-guest-complaints/`
 * contracts G6, G7; research R-13; design review F-4, F-8, F-14). 180's
 * `/returns/submit` for a guest: it works without JavaScript, uploads each file part,
 * files the complaint with the upload ids, the clauses and the submission key, and answers
 * `303` either way.
 *
 * - Every backend call carries the guest session and nothing else of the browser's — not
 *   the customer session a signed-in browser also holds (research R-4).
 * - The body is the strict G7 shape (F-4): no `orderId`, and no `contact.email` — the
 *   address is the session's.
 * - Filed: `303` to `/returns/guest/submitted/<reference>`, the tracking link in a flash
 *   cookie only that page reads (F-8). A repeated submission key answers the case already
 *   filed, so a double submit lands on the same page.
 * - Refused: back to the form with 180's attempt cookie; a guest limit is named by its
 *   `details.limit`.
 * - The session expired or is missing: the answers are kept, the files are not — they were
 *   the session's (R-4) — and the entry asks for a new link (F-14).
 * - Over 30 MB: refused before it is read, with no cookie (180 D-9).
 */
function seeOther(location: string, ...cookies: string[]): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

/** The refusal code the form shows for an API error, as 180's handler reads it, plus the guest's. */
function refusalOf(error: unknown): string {
  if (error instanceof StorefrontApiError) {
    const details = error.details as Record<string, unknown> | undefined;
    const detail = details && !Array.isArray(details) ? details['code'] ?? details['reason'] : undefined;
    if (error.code === 'RETURN_GUEST_LIMIT_REACHED' && details && typeof details['limit'] === 'string') {
      return `guest_limit_${details['limit']}`;
    }
    if (typeof detail === 'string' && error.code === 'VALIDATION_FAILED') return detail;
    if (error.code === 'RETURN_CLAUSES_NOT_ACCEPTED' && typeof detail === 'string') return detail;
    return error.code;
  }
  return 'generic';
}

function attachmentOf(upload: ReturnsAttemptUpload, slots: readonly number[]): { uploadId: string; line?: number } {
  const line = upload.line === undefined ? -1 : slots.indexOf(upload.line);
  return line >= 0 ? { uploadId: upload.uploadId, line } : { uploadId: upload.uploadId };
}

export async function POST(request: Request): Promise<Response> {
  const { ctx, urlState } = await getServerContext();
  const at = (path: string): string => (urlState ? localizePath(path, urlState) : path);
  const secure = new URL(request.url).protocol === 'https:';
  const options = { ctx, forwardedFor: forwardedForOf(request) };

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > RETURN_FORM_LIMITS.maxSubmissionBytes) {
    return seeOther(at(`${GUEST_FORM_PATH}?error=too_large`));
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    form = new FormData();
  }

  const attemptCookie = (codes: string[], uploads: ReturnsAttemptUpload[]): string =>
    setCookie(RETURNS_ATTEMPT_COOKIE, encodeReturnsAttempt({ answers: answersOf(form), errors: codes, uploads }), {
      path: at('/returns'),
      maxAge: RETURNS_ATTEMPT_MAX_AGE,
      secure,
    });
  // F-14 — the answers come back after the new link; the files were the old session's.
  const expired = (): Response =>
    seeOther(
      // `from` is the form, `GUEST_FORM_PATH`, encoded: a literal address (issue #790).
      at('/returns/guest?reason=session_expired&from=%2Freturns%2Fguest%2Fnew'),
      attemptCookie(['session_expired'], []),
    );

  const session = requestCookie(request, RETURNS_GUEST_SESSION_COOKIE);
  if (!session) return expired();

  // The files already accepted on an earlier attempt, and the ones the JS field uploaded.
  const uploads: ReturnsAttemptUpload[] = [];
  for (const name of ['keepUpload', 'uploadId'] as const) {
    for (const value of form.getAll(name)) {
      if (typeof value === 'string' && isUuidShape(value.trim())) uploads.push({ uploadId: value.trim(), filename: '', type: 'other' });
    }
  }
  for (let slot = 0; slot < OFF_PLATFORM_FORM_LINES; slot += 1) {
    for (const id of lineUploadsOf(form, slot)) if (isUuidShape(id)) uploads.push({ uploadId: id, filename: '', type: 'photo', line: slot });
  }

  const { body, errors, slots } = guestBodyOf(form);
  const refuse = (error: unknown | string[]): Response => {
    if (error instanceof StorefrontApiError && error.status === 401) return expired();
    if (error instanceof StorefrontApiError && error.status === 403) return seeOther(at('/returns/guest?error=disabled'));
    const codes = Array.isArray(error) ? error : [refusalOf(error)];
    return seeOther(at(`${GUEST_FORM_PATH}?error=refused`), attemptCookie(codes, uploads));
  };
  if (errors.length > 0) return refuse(errors);

  try {
    for (const type of RETURN_ATTACHMENT_TYPES) {
      for (const value of form.getAll(`files_${type}`)) {
        if (typeof value === 'string' || value.size === 0) continue;
        const uploaded = await uploadGuestFile(session, { file: value, filename: value.name, type }, options);
        uploads.push({ uploadId: uploaded.uploadId, filename: value.name, type });
      }
    }
    for (const slot of slots) {
      for (const file of lineFilesOf(form, slot)) {
        const uploaded = await uploadGuestFile(session, { file, filename: file.name, type: 'photo' }, options);
        uploads.push({ uploadId: uploaded.uploadId, filename: file.name, type: 'photo', line: slot });
      }
    }
  } catch (error) {
    return refuse(error);
  }

  const submissionKey = String(form.get('submissionKey') ?? '');
  try {
    const filed = await fileGuestComplaint(
      session,
      {
        ...body,
        ...(uploads.length > 0 ? { attachments: uploads.map((u) => attachmentOf(u, slots)) } : {}),
        ...(isUuidShape(submissionKey) ? { submissionKey } : {}),
      } as CreateGuestComplaintRequest,
      options,
    );
    const ref = encodeURIComponent(filed.reference);
    return seeOther(
      at(`/returns/guest/submitted/${ref}`),
      setCookie(RETURNS_GUEST_FILED_COOKIE, encodeGuestFiled({ ref: filed.reference, trackingToken: filed.trackingToken, email: filed.email }), {
        path: at('/returns/guest/submitted'),
        maxAge: GUEST_FILED_MAX_AGE,
        secure,
      }),
    );
  } catch (error) {
    return refuse(error);
  }
}
