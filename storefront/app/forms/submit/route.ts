/**
 * `POST /forms/submit` — the storefront handler behind the `forms.Form` Page Builder block
 * (`specs/170-forms-module/` contracts/public-api.md §3, FR-037, research R-9, R-10).
 *
 * The block is a plain `<form method="post">`, so a form can be sent without JavaScript: the
 * handler submits to the `forms` module's public API and answers `303` back to the page it came
 * from, with the outcome addressed to the block (`?formsBlock=<block id>&formsOutcome=…`) and the
 * section's anchor as the fragment; a refusal of the answers also keeps them, with their errors, in
 * a short-lived cookie scoped to that page (`forms_attempt`), which the page reads back only for the
 * attempt id on the URL. An accepted submission whose confirmation is a redirect or a CMS page goes
 * there instead. With JavaScript the block posts with `Accept: application/json` and gets the
 * outcome as JSON; no cookie is set.
 *
 * The backend is the authority on every answer (FR-034): this handler only reads the post, keeps
 * the shopper on the shop, forwards the session and the address, and words the outcome. While
 * `forms` is absent it answers `404`, as the block is already gone from every page; `/forms/contact`
 * (feature 169) is a separate handler and is not touched.
 */

import { randomUUID } from 'node:crypto';
import { SECTION_ANCHOR_RE, type FormSubmitBody } from '@endora-commerce/contracts';
import { getModulePresence } from '../../../lib/api/module-presence';
import { submitFormEntry, type FormSubmitOutcome } from '../../../lib/api/forms';
import { localizePath } from '../../../lib/i18n/locale-path';
import {
  FORMS_ATTEMPT_COOKIE,
  FORMS_ATTEMPT_MAX_AGE,
  encodeFormsAttempt,
} from '../../../lib/page-builder/forms-context';
import { getServerContext } from '../../../lib/server-context';

export const dynamic = 'force-dynamic';

/** The backend's body limit (FR-036); a post over it is refused before it is read. */
const BODY_LIMIT = 262_144;

const FORM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A block id as the Page Builder writes it. */
const BLOCK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The query keys this handler owns on the page it returns to; `contact`/`form` are feature 169's. */
const OUTCOME_KEYS = ['formsBlock', 'formsOutcome', 'formsReason', 'formsAttempt'] as const;

/** The posted names that are the block's own, not answers. */
const RESERVED = new Set(['formId', 'blockId', 'returnTo', 'anchor', 'hp_extra', 'cf-turnstile-response', 'h-captcha-response']);

type Reason = 'invalid' | 'captcha' | 'captcha_unavailable' | 'not_accepting' | 'rate_limited' | 'unavailable' | 'too_large';

/**
 * A same-origin path, or `/`. Anything that could leave the storefront — an absolute URL, `//host`,
 * `/\host`, a scheme, a control character — falls back to the home page (feature 169's rule).
 */
function safeReturnTo(raw: string): URL {
  const base = 'http://storefront.invalid';
  const fallback = new URL('/', base);
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || raw[index] === '\\') return fallback;
  }
  try {
    const url = new URL(raw, base);
    if (url.origin !== base) return fallback;
    for (const key of OUTCOME_KEYS) url.searchParams.delete(key);
    return url;
  } catch {
    return fallback;
  }
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** Every answer, by name and in the order posted; a repeated name is a list. */
function answersOf(form: FormData): [string, string | string[]][] {
  const answers = new Map<string, string | string[]>();
  for (const [name, value] of form.entries()) {
    if (RESERVED.has(name) || typeof value !== 'string') continue;
    const previous = answers.get(name);
    if (previous === undefined) answers.set(name, value);
    else answers.set(name, Array.isArray(previous) ? [...previous, value] : [previous, value]);
  }
  return [...answers.entries()];
}

function noStore(init: ResponseInit = {}): ResponseInit {
  return { ...init, headers: { 'Cache-Control': 'no-store', ...(init.headers as Record<string, string> | undefined) } };
}

/** The JSON answer of a refusal (the block reads it, `form-block-state.ts`). */
function jsonRefusal(outcome: Exclude<FormSubmitOutcome, { kind: 'accepted' }>): Response {
  switch (outcome.kind) {
    case 'invalid':
      return Response.json({ error: 'invalid', fields: outcome.fields }, noStore({ status: 400 }));
    case 'captcha':
      return Response.json({ error: 'captcha' }, noStore({ status: 400 }));
    case 'captcha_unavailable':
      return Response.json({ error: 'captcha_unavailable' }, noStore({ status: 503 }));
    case 'not_accepting':
      return Response.json({ error: 'not_accepting', reason: outcome.reason }, noStore({ status: 400 }));
    case 'rate_limited':
      return Response.json({ error: 'rate_limited' }, noStore({ status: 429 }));
    case 'too_large':
      return Response.json({ error: 'too_large' }, noStore({ status: 413 }));
    case 'unavailable':
      return Response.json({ error: 'unavailable' }, noStore({ status: 503 }));
  }
}

/** A relative `Location`: the browser resolves it against the page it posted from. */
function seeOther(location: string, setCookie?: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store', ...(setCookie ? { 'Set-Cookie': setCookie } : {}) },
  });
}

function backTo(
  returnTo: URL,
  blockId: string | null,
  anchor: string | null,
  outcome: { accepted: true } | { reason: Reason; attemptId: string },
): string {
  const target = new URL(returnTo.href);
  if (blockId) target.searchParams.set('formsBlock', blockId);
  if ('accepted' in outcome) {
    target.searchParams.set('formsOutcome', 'accepted');
  } else {
    target.searchParams.set('formsOutcome', 'error');
    target.searchParams.set('formsReason', outcome.reason);
    target.searchParams.set('formsAttempt', outcome.attemptId);
  }
  return `${target.pathname}${target.search}${anchor ? `#${anchor}` : ''}`;
}

export async function POST(request: Request): Promise<Response> {
  const modules = await getModulePresence();
  if (!modules.isPresent('forms')) {
    return new Response('Not Found', { status: 404 });
  }

  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > BODY_LIMIT) {
    // Not read, so neither the page nor the block is known: home, with the reason.
    return wantsJson
      ? jsonRefusal({ kind: 'too_large' })
      : seeOther(backTo(safeReturnTo('/'), null, null, { reason: 'too_large', attemptId: randomUUID() }));
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    form = new FormData();
  }

  const returnTo = safeReturnTo(field(form, 'returnTo'));
  const rawAnchor = field(form, 'anchor');
  const anchor = SECTION_ANCHOR_RE.test(rawAnchor) ? rawAnchor : null;
  const rawBlockId = field(form, 'blockId');
  const blockId = BLOCK_ID_RE.test(rawBlockId) ? rawBlockId : null;
  const formId = field(form, 'formId');
  const answers = answersOf(form);

  let outcome: FormSubmitOutcome;
  const { ctx, urlState } = await getServerContext();
  if (!FORM_ID_RE.test(formId)) {
    outcome = { kind: 'unavailable' };
  } else {
    const hp = field(form, 'hp_extra');
    const captchaToken = field(form, 'cf-turnstile-response') || field(form, 'h-captcha-response');
    const pageUrl = `${returnTo.pathname}${returnTo.search}`;
    const body: FormSubmitBody = {
      values: Object.fromEntries(answers),
      ...(pageUrl.length <= 2048 ? { pageUrl } : {}),
      // The honeypot travels only when a bot filled it; the backend answers it as accepted.
      ...(hp !== '' ? { hp } : {}),
      ...(captchaToken !== '' ? { captchaToken } : {}),
    };
    try {
      outcome = await submitFormEntry({
        formId,
        body,
        channelCode: ctx.salesChannelCode ?? 'default',
        locale: ctx.locale ?? 'en-US',
        sessionCookie: ctx.viewerSession ?? null,
        forwardedFor: request.headers.get('x-forwarded-for'),
      });
    } catch {
      outcome = { kind: 'unavailable' };
    }
  }

  if (wantsJson) {
    return outcome.kind === 'accepted'
      ? Response.json({ status: 'accepted', confirmation: outcome.confirmation }, noStore({ status: 200 }))
      : jsonRefusal(outcome);
  }

  if (outcome.kind === 'accepted') {
    const confirmation = outcome.confirmation;
    if (confirmation.type === 'redirect') return seeOther(confirmation.url);
    if (confirmation.type === 'page') return seeOther(localizePath(confirmation.path, urlState));
    return seeOther(backTo(returnTo, blockId, anchor, { accepted: true }));
  }

  const attemptId = randomUUID();
  const location = backTo(returnTo, blockId, anchor, { reason: outcome.kind, attemptId });
  if (outcome.kind !== 'invalid' || !blockId) return seeOther(location);

  // FR-037: the answers and errors come back with the page — in the shopper's own browser, unreadable
  // by script, for this page only and for five minutes (research R-10).
  const value = encodeFormsAttempt({ attemptId, blockId, errors: outcome.fields, answers });
  const secure =
    new URL(request.url).protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const cookie = [
    `${FORMS_ATTEMPT_COOKIE}=${value}`,
    `Path=${returnTo.pathname}`,
    `Max-Age=${FORMS_ATTEMPT_MAX_AGE}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
  return seeOther(location, cookie);
}
