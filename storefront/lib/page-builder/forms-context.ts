import { cookies, headers } from 'next/headers';
import type {
  CmsFormsContext,
  CmsFormsText,
  CmsRenderLocation,
} from '@endora-commerce/cms-components/components/render-context';
import { FORM_FIELD_ERROR_CODES, type FormFieldErrorCode } from '@endora-commerce/contracts';
import type { RequestContext } from '../api/client';
import { fetchDictionary } from '../dictionary/client';
import { tForLocale, type MessageKey } from '../i18n/messages';

/**
 * What a `forms.Form` block needs from the page beyond its block data (feature 170,
 * `specs/170-forms-module/` contracts/blocks-and-storefront.md §4, research R-10, R-11), computed
 * **on the server** so a shopper without JavaScript has all of it:
 *
 * - the built-in words in the page language (the `forms` catalogue namespace);
 * - the dictionary's countries, labelled in the page language;
 * - whether a customer is signed in, and where to sign in and come back;
 * - the page context hidden fields carry — the page's address, its title, the referring address
 *   (the request's `Referer`) and the query;
 * - a refused no-JS attempt's answers and errors, read from the `forms_attempt` cookie **only when
 *   the URL's `formsAttempt` names it**, so a reload of the clean URL shows nothing.
 *
 * The cookie's codec lives here too, beside its only reader, and the handler that writes it
 * (`app/forms/submit/route.ts`) imports it, so the two cannot disagree about the shape.
 */

/** The cookie a refused no-JS attempt is kept in for its page (research R-10). */
export const FORMS_ATTEMPT_COOKIE = 'forms_attempt';
/** Seconds the attempt is kept: long enough to read the page again, not to keep personal data. */
export const FORMS_ATTEMPT_MAX_AGE = 300;
/** The cookie value's budget in bytes, under every browser's 4 KiB per-cookie limit. */
export const FORMS_ATTEMPT_BUDGET = 3800;

export interface FormsAttempt {
  attemptId: string;
  blockId: string;
  errors: { fieldKey: string; code: string; message: string }[];
  answers: Record<string, string | string[]>;
  truncated: boolean;
}

function encode(value: FormsAttempt): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * The cookie value of a refused attempt: the errors, then the answers **in field order** for as
 * long as they fit the budget; the first answer that does not fit and every one after it are
 * dropped, and `truncated` says so — the block asks the shopper to enter those again.
 */
export function encodeFormsAttempt(input: {
  attemptId: string;
  blockId: string;
  errors: FormsAttempt['errors'];
  answers: readonly (readonly [string, string | string[]])[];
}): string {
  const attempt: FormsAttempt = { attemptId: input.attemptId, blockId: input.blockId, errors: input.errors, answers: {}, truncated: false };
  for (const [key, value] of input.answers) {
    const next = { ...attempt, answers: { ...attempt.answers, [key]: value }, truncated: true };
    if (encode(next).length > FORMS_ATTEMPT_BUDGET) {
      attempt.truncated = true;
      break;
    }
    attempt.answers[key] = value;
  }
  let value = encode(attempt);
  if (value.length > FORMS_ATTEMPT_BUDGET) {
    // Errors alone over the budget: keep the attempt id, so the outcome still shows.
    value = encode({ ...attempt, errors: [], answers: {}, truncated: true });
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The attempt in a cookie value, or `null` for anything that is not one. */
export function decodeFormsAttempt(raw: string | undefined): FormsAttempt | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed['attemptId'] !== 'string' || typeof parsed['blockId'] !== 'string') return null;
  const errors = Array.isArray(parsed['errors'])
    ? parsed['errors'].flatMap((error) =>
        isRecord(error) && typeof error['fieldKey'] === 'string' && typeof error['code'] === 'string'
          ? [{ fieldKey: error['fieldKey'], code: error['code'], message: typeof error['message'] === 'string' ? error['message'] : '' }]
          : [],
      )
    : [];
  const answers: Record<string, string | string[]> = {};
  if (isRecord(parsed['answers'])) {
    for (const [key, value] of Object.entries(parsed['answers'])) {
      if (typeof value === 'string') answers[key] = value;
      else if (Array.isArray(value)) answers[key] = value.filter((item): item is string => typeof item === 'string');
    }
  }
  return { attemptId: parsed['attemptId'], blockId: parsed['blockId'], errors, answers, truncated: parsed['truncated'] === true };
}

/** The block's built-in words in the page language. A language the catalogue lacks reads English. */
export function formsText(language: string): CmsFormsText {
  const t = tForLocale(language);
  const fieldErrors = Object.fromEntries(
    FORM_FIELD_ERROR_CODES.map((code) => [code, t(`forms.fieldError.${code}` as MessageKey)]),
  ) as Record<FormFieldErrorCode, string>;
  return {
    submit: t('forms.submit'),
    required: t('forms.required'),
    optional: t('forms.optional'),
    errorSummary: t('forms.errorSummary'),
    errorSummaryCount: t('forms.errorSummaryCount'),
    accepted: t('forms.accepted'),
    unavailable: t('forms.unavailable'),
    rateLimited: t('forms.rateLimited'),
    tooLarge: t('forms.tooLarge'),
    captchaFailed: t('forms.captchaFailed'),
    captchaUnavailable: t('forms.captchaUnavailable'),
    needsJavaScript: t('forms.needsJavaScript'),
    truncatedAnswers: t('forms.truncatedAnswers'),
    closed: t('forms.closed'),
    notYetOpen: t('forms.notYetOpen'),
    full: t('forms.full'),
    signIn: t('forms.signIn'),
    signInLink: t('forms.signInLink'),
    selectPlaceholder: t('forms.selectPlaceholder'),
    countryPlaceholder: t('forms.countryPlaceholder'),
    fieldErrors,
    addressParts: {
      street: t('forms.addressPart.street'),
      line2: t('forms.addressPart.line2'),
      postalCode: t('forms.addressPart.postalCode'),
      city: t('forms.addressPart.city'),
      country: t('forms.addressPart.country'),
    },
  };
}

/** The query keys the submit handler owns; never part of the page's own address. */
const OUTCOME_KEYS = ['formsBlock', 'formsOutcome', 'formsReason', 'formsAttempt'];

/** Plain text, capped as the backend caps a hidden value (research R-11). */
function capped(value: string): string {
  return value.slice(0, 1000);
}

export async function formsRenderContext(input: {
  language: string;
  location: CmsRenderLocation;
  pageTitle: string;
  ctx: RequestContext;
}): Promise<CmsFormsContext> {
  const { language, location, pageTitle, ctx } = input;
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(location.query)) {
    if (!OUTCOME_KEYS.includes(key)) query[key] = value;
  }
  const search = new URLSearchParams(query).toString();
  const pageUrl = `${location.path}${search ? `?${search}` : ''}`;

  const [requestHeaders, jar, countries] = await Promise.all([
    headers(),
    cookies(),
    fetchDictionary({ ctx })
      .then((registry) => registry.countries.map((country) => ({ code: country.code, label: country.label })))
      // Without the dictionary a country field lists no country; the form still renders.
      .catch(() => [] as { code: string; label: string }[]),
  ]);

  const attemptId = location.query['formsAttempt'];
  const stored = attemptId ? decodeFormsAttempt(jar.get(FORMS_ATTEMPT_COOKIE)?.value) : null;
  const attempt =
    stored && stored.attemptId === attemptId && location.query['formsBlock'] === stored.blockId
      ? { blockId: stored.blockId, errors: stored.errors, answers: stored.answers, truncated: stored.truncated }
      : null;

  return {
    text: formsText(language),
    countries,
    viewerSignedIn: ctx.viewerSession !== undefined && ctx.viewerSession !== '',
    signInPath: `/login?next=${encodeURIComponent(pageUrl)}`,
    pageContext: {
      pageUrl: capped(pageUrl),
      pageTitle: capped(pageTitle),
      referrer: capped(requestHeaders.get('referer') ?? ''),
      query: Object.fromEntries(Object.entries(query).map(([key, value]) => [key, capped(value)])),
    },
    attempt,
  };
}
