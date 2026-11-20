import { isUuidShape } from '@endora-commerce/contracts';
import { createReturnCase, uploadReturnFile } from '../../../lib/api/returns';
import { StorefrontApiError } from '../../../lib/api/client';
import { localizePath } from '../../../lib/i18n/locale-path';
import { RETURN_ATTACHMENT_TYPES, RETURN_FORM_LIMITS } from '../../../lib/returns/attachments';
import {
  OFF_PLATFORM_FORM_LINES,
  RETURNS_ATTEMPT_COOKIE,
  RETURNS_ATTEMPT_MAX_AGE,
  answersOf,
  encodeReturnsAttempt,
  lineFilesOf,
  lineUploadsOf,
  offPlatformBodyOf,
  orderBodyOf,
  parseReturnKind,
  returnFormHref,
  type ReturnsAttemptUpload,
} from '../../../lib/returns/returnForm';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `POST /returns/submit` — the returns form's handler, both paths
 * (`specs/180-off-platform-complaints/` research R-13; the `forms/submit` precedent).
 *
 * It works without JavaScript: it uploads each file part to `POST /api/v1/returns/uploads`
 * with the customer's session, files the case with the upload ids, the clauses and the
 * submission key, and answers `303` to the case page. A refusal answers `303` back to the
 * form with the typed answers — never the files — in a short-lived attempt cookie scoped
 * to `/returns`, and the uploads already accepted are kept by id for the retry. A post
 * with no line is a refusal on both paths (D-15). A body over 30 MB is refused before it
 * is read, with no cookie, because nothing of it was read (D-9). The channel and the
 * organization are the request's: nothing of them is taken from the form.
 */

function seeOther(location: string, setCookie?: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store', ...(setCookie ? { 'Set-Cookie': setCookie } : {}) },
  });
}

function attemptCookie(value: string, secure: boolean): string {
  return `${RETURNS_ATTEMPT_COOKIE}=${value}; Path=/returns; Max-Age=${RETURNS_ATTEMPT_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** The refusal code a form shows for an API error: a detail code first, else the error code. */
function refusalOf(error: unknown): string {
  if (error instanceof StorefrontApiError) {
    const details = error.details as Record<string, unknown> | undefined;
    const code = details && !Array.isArray(details) ? details['code'] ?? details['reason'] : undefined;
    if (typeof code === 'string' && error.code === 'VALIDATION_FAILED') return code;
    if (error.code === 'RETURN_CLAUSES_NOT_ACCEPTED' && typeof code === 'string') return code;
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

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > RETURN_FORM_LIMITS.maxSubmissionBytes) {
    return seeOther(at('/returns/new?error=too_large'));
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    form = new FormData();
  }

  const elsewhere = form.get('origin') === 'elsewhere';
  const orderId = String(form.get('orderId') ?? '');
  const backTo = elsewhere
    ? '/returns/new?origin=elsewhere'
    : isUuidShape(orderId)
      ? returnFormHref(orderId, parseReturnKind(String(form.get('kind') ?? '')))
      : '/returns/new';

  const session = await getSessionCookie();
  if (!session) return seeOther(at(`/login?next=${encodeURIComponent(backTo)}`));

  // The files already accepted on an earlier attempt, and the ones the JS field uploaded —
  // for the whole case, and (no-order path) the defect photos of each line slot.
  const uploads: ReturnsAttemptUpload[] = [];
  for (const name of ['keepUpload', 'uploadId'] as const) {
    for (const value of form.getAll(name)) {
      if (typeof value === 'string' && isUuidShape(value.trim())) {
        uploads.push({ uploadId: value.trim(), filename: '', type: 'other' });
      }
    }
  }
  if (elsewhere) {
    for (let slot = 0; slot < OFF_PLATFORM_FORM_LINES; slot += 1) {
      for (const id of lineUploadsOf(form, slot)) {
        if (isUuidShape(id)) uploads.push({ uploadId: id, filename: '', type: 'photo', line: slot });
      }
    }
  }

  const { body, errors, slots = [] } = elsewhere ? offPlatformBodyOf(form) : { ...orderBodyOf(form), slots: undefined };
  // Issue #745/#790 — the address carries one fixed token; the refusal codes travel in the
  // path-scoped, HTTP-only attempt cookie beside the typed answers, never in the URL.
  const refuse = (codes: string[]): Response => {
    const answers = answersOf(form);
    if (codes.includes('unknown_product')) {
      // A catalogue product the channel does not sell (design review Part 2, *Error copy*):
      // its name stays as a typed model, so resubmitting is one click, and the line is marked.
      for (const key of Object.keys(answers)) {
        const line = /^lines\.(\d+)\.productId$/.exec(key);
        if (!line) continue;
        delete answers[key];
        answers[`lines.${line[1]}.productRefused`] = '1';
      }
    }
    const attempt = encodeReturnsAttempt({ answers, errors: codes, uploads });
    return seeOther(at(`${backTo}${backTo.includes('?') ? '&' : '?'}error=refused`), attemptCookie(attempt, secure));
  };
  if (errors.length > 0) return refuse(errors);

  try {
    for (const type of RETURN_ATTACHMENT_TYPES) {
      for (const value of form.getAll(`files_${type}`)) {
        if (typeof value === 'string' || value.size === 0) continue;
        const uploaded = await uploadReturnFile(session, { file: value, filename: value.name, type }, ctx);
        uploads.push({ uploadId: uploaded.uploadId, filename: value.name, type });
      }
    }
    for (const slot of slots) {
      for (const file of lineFilesOf(form, slot)) {
        const uploaded = await uploadReturnFile(session, { file, filename: file.name, type: 'photo' }, ctx);
        uploads.push({ uploadId: uploaded.uploadId, filename: file.name, type: 'photo', line: slot });
      }
    }
  } catch (error) {
    return refuse([refusalOf(error)]);
  }

  const submissionKey = String(form.get('submissionKey') ?? '');
  try {
    const created = await createReturnCase(
      session,
      {
        ...body,
        // A line's photo names its line by position in `lines`, not by its form slot.
        ...(uploads.length > 0 ? { attachments: uploads.map((u) => attachmentOf(u, slots)) } : {}),
        ...(isUuidShape(submissionKey) ? { submissionKey } : {}),
      } as never,
      ctx,
    );
    return seeOther(at(`/returns/${created.id}?submitted=1`));
  } catch (error) {
    return refuse([refusalOf(error)]);
  }
}
