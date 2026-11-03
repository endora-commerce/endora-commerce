import {
  visibleElements,
  type AvailablePublicFormDefinition,
  type PublicFormField,
  type VisibilitySource,
} from '@endora-commerce/contracts';
import type { CmsFormsContext, CmsFormsText, CmsRenderLocation } from '../render-context.js';

/**
 * The state of one `forms.Form` block between the shopper and the storefront handler
 * (`specs/170-forms-module/` contracts/public-api.md §3, contracts/blocks-and-storefront.md §5,
 * research R-10): which outcome on the URL is this block's, what to come back to, how a JSON answer
 * reads, and the navigation of a redirect or page confirmation. Plain functions, so the block stays
 * synchronous and the server render and hydration agree.
 */

/** Where the block posts, before the page language's prefix (`localizePath`). */
export const FORMS_SUBMIT_PATH = '/forms/submit';

/** The query keys the handler owns on the page it returns to; `contact`/`form` (feature 169) are not its. */
export const FORMS_OUTCOME_KEYS = ['formsBlock', 'formsOutcome', 'formsReason', 'formsAttempt'] as const;

/** Why a submission was refused, as the handler words it. */
export const FORMS_REFUSAL_REASONS = [
  'invalid',
  'captcha',
  'captcha_unavailable',
  'not_accepting',
  'rate_limited',
  'unavailable',
  'too_large',
] as const;
export type FormsRefusalReason = (typeof FORMS_REFUSAL_REASONS)[number];

/** One refused answer, as the handler hands it on: the field key (or `<key>.<part>`), code and words. */
export interface FormsFieldError {
  readonly fieldKey: string;
  readonly code: string;
  readonly message: string;
}

export type FormsOutcome =
  | { readonly kind: 'accepted'; readonly message?: string | undefined }
  | {
      readonly kind: 'refused';
      readonly reason: FormsRefusalReason;
      /** The `not_accepting` token (closed, full, …), when the handler gave one. */
      readonly notAccepting?: string | undefined;
      readonly fields: readonly FormsFieldError[];
    }
  | null;

/** The page to come back to: its path and query, without an earlier outcome of this handler. */
export function formsReturnPathOf(path: string, query: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!(FORMS_OUTCOME_KEYS as readonly string[]).includes(key)) params.append(key, value);
  }
  const search = params.toString();
  return `${path}${search ? `?${search}` : ''}`;
}

function isReason(value: unknown): value is FormsRefusalReason {
  return (FORMS_REFUSAL_REASONS as readonly unknown[]).includes(value);
}

/**
 * The outcome the handler put on the URL — only when it names **this** block (US2-7), so two forms
 * on a page, or one form placed twice, never show each other's outcome. A refusal's answers and
 * errors come from the render context's `attempt`, which the storefront fills only when the URL's
 * attempt id matches its cookie, and only for this block.
 */
export function formsOutcomeFromLocation(
  location: CmsRenderLocation | undefined,
  blockId: string,
  attempt: CmsFormsContext['attempt'] | undefined,
): FormsOutcome {
  const query = location?.query;
  if (!query || blockId === '' || query['formsBlock'] !== blockId) return null;
  if (query['formsOutcome'] === 'accepted') return { kind: 'accepted' };
  if (query['formsOutcome'] !== 'error') return null;
  const reason = isReason(query['formsReason']) ? query['formsReason'] : 'unavailable';
  const fields = attempt && attempt.blockId === blockId ? attempt.errors : [];
  return { kind: 'refused', reason, fields };
}

/** The confirmation of an accepted JSON answer. */
export type FormsConfirmation =
  | { readonly type: 'message'; readonly message: string }
  | { readonly type: 'redirect'; readonly url: string }
  | { readonly type: 'page'; readonly path: string };

export type FormsJsonAnswer =
  | { readonly kind: 'accepted'; readonly confirmation: FormsConfirmation }
  | Exclude<FormsOutcome, null | { kind: 'accepted' }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldErrors(value: unknown): FormsFieldError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isRecord(item) && typeof item['fieldKey'] === 'string' && typeof item['code'] === 'string'
      ? [{ fieldKey: item['fieldKey'], code: item['code'], message: typeof item['message'] === 'string' ? item['message'] : '' }]
      : [],
  );
}

/** The handler's JSON answer (contracts/public-api.md §3) as the block acts on it. */
export function readFormsJsonAnswer(body: unknown): FormsJsonAnswer {
  if (isRecord(body) && body['status'] === 'accepted' && isRecord(body['confirmation'])) {
    const confirmation = body['confirmation'];
    if (confirmation['type'] === 'redirect' && typeof confirmation['url'] === 'string') {
      return { kind: 'accepted', confirmation: { type: 'redirect', url: confirmation['url'] } };
    }
    if (confirmation['type'] === 'page' && typeof confirmation['path'] === 'string') {
      return { kind: 'accepted', confirmation: { type: 'page', path: confirmation['path'] } };
    }
    const message = typeof confirmation['message'] === 'string' ? confirmation['message'] : '';
    return { kind: 'accepted', confirmation: { type: 'message', message } };
  }
  const error = isRecord(body) ? body['error'] : undefined;
  const reason = isReason(error) ? error : 'unavailable';
  return {
    kind: 'refused',
    reason,
    notAccepting: isRecord(body) && typeof body['reason'] === 'string' ? body['reason'] : undefined,
    fields: reason === 'invalid' && isRecord(body) ? fieldErrors(body['fields']) : [],
  };
}

/** The sentence of a refusal that is not about one answer. */
export function formsRefusalText(
  text: CmsFormsText,
  reason: FormsRefusalReason,
  notAccepting: string | undefined,
  formTexts: { closed?: string | undefined; notYetOpen?: string | undefined; full?: string | undefined; signIn?: string | undefined },
): string {
  switch (reason) {
    case 'invalid':
      return text.errorSummary;
    case 'captcha':
      return text.captchaFailed;
    case 'captcha_unavailable':
      return text.captchaUnavailable;
    case 'rate_limited':
      return text.rateLimited;
    case 'too_large':
      return text.tooLarge;
    case 'not_accepting':
      if (notAccepting === 'closed') return formTexts.closed ?? text.closed;
      if (notAccepting === 'not_yet_open') return formTexts.notYetOpen ?? text.notYetOpen;
      if (notAccepting === 'full') return formTexts.full ?? text.full;
      if (notAccepting === 'sign_in_required') return formTexts.signIn ?? text.signIn;
      return text.unavailable;
    case 'unavailable':
      return text.unavailable;
  }
}

/** Leave the page for a redirect or page confirmation. A seam, so the tests can watch it. */
export function navigateTo(url: string): void {
  window.location.assign(url);
}

// --- Conditional logic (User Story 3, FR-030, FR-032, research R-6, R-28) ----------------------

/** The answers as the browser posts them: a string per name, a list for a repeated name. */
export type FormsValues = Readonly<Record<string, string | readonly string[]>>;

/**
 * The elements visible for these answers — the contracts evaluator over the public read, which
 * keeps every element's id, type, key and rule, so the shopper sees exactly what the server will
 * judge (B12). A hidden field counts as empty in the conditions that name it.
 */
export function formsVisibility(
  source: VisibilitySource,
  values: FormsValues,
): { sections: ReadonlySet<string>; fields: ReadonlySet<string> } {
  return visibleElements(source, values);
}

/** Whether a definition has any rule, so a form without one renders no reveal for no-JS. */
export function formsHasRules(source: VisibilitySource): boolean {
  return source.sections.some(
    (section) => section.visibility !== undefined || section.fields.some((field) => field.visibility !== undefined),
  );
}

type Fields = AvailablePublicFormDefinition['sections'][number]['fields'];

/** A field's default as the browser would post it, or nothing. */
function defaultOf(field: PublicFormField): string | readonly string[] | undefined {
  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
    case 'textarea':
    case 'select':
    case 'radio':
    case 'country':
      return field.defaultValue === undefined || field.defaultValue === '' ? undefined : field.defaultValue;
    case 'number':
      return field.defaultValue === undefined ? undefined : String(field.defaultValue);
    case 'checkboxes':
      return field.defaultValue && field.defaultValue.length > 0 ? field.defaultValue : undefined;
    case 'checkbox':
      return field.defaultChecked ? 'on' : undefined;
    default:
      return undefined;
  }
}

/**
 * The answers the block renders its first visibility from (research R-28): a refused attempt's
 * posted answers when there is one (an absent key is an answer left empty), else every default; the
 * hidden fields' values always come from the page, as their inputs do. Deterministic, so the server
 * render and the hydration agree and nothing shifts.
 */
export function formsInitialValues(
  sections: readonly { fields: Fields }[],
  hiddenValueOf: (field: Extract<PublicFormField, { type: 'hidden' }>) => string,
  posted: FormsValues | undefined,
): Record<string, string | readonly string[]> {
  const values: Record<string, string | readonly string[]> = posted ? { ...posted } : {};
  for (const field of sections.flatMap((section) => section.fields)) {
    if (field.type === 'hidden') {
      const value = hiddenValueOf(field);
      if (value !== '') values[field.key] = value;
      continue;
    }
    if (posted || !('key' in field)) continue;
    const value = defaultOf(field);
    if (value !== undefined) values[field.key] = value;
  }
  return values;
}

/** The live answers of a form element, read as the browser would post them. */
export function formsValuesOf(form: HTMLFormElement): Record<string, string | readonly string[]> {
  const values: Record<string, string | string[]> = {};
  for (const [name, entry] of new FormData(form).entries()) {
    if (typeof entry !== 'string') continue;
    const previous = values[name];
    if (previous === undefined) values[name] = entry;
    else values[name] = Array.isArray(previous) ? [...previous, entry] : [previous, entry];
  }
  return values;
}
