import {
  FORMS_STOREFRONT_CACHE_TAGS,
  type FormNotAcceptingReason,
  type FormSubmitBody,
  type FormSubmitResponse,
  type PublicFormDefinition,
} from '@endora-commerce/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';
import { apiMutate } from './mutations';

/**
 * Feature 170 — the storefront's calls to the `forms` module's public API
 * (`specs/170-forms-module/` contracts/public-api.md §1–§3, research R-21).
 *
 * - **The read** is anonymous and shared: a form's public definition is the same for every viewer
 *   (signed-in-only is decided by the block with the viewer), so it is cached in the Data Cache
 *   under the form's tag — dropped by the backend on publish, close, reopen and delete — and
 *   revalidated within 60 s whatever happens to that call. Every state of a form is a `200`, so a
 *   cached answer is always replaced by the next one.
 * - **The submission** forwards the shopper's session, so a signed-in customer's entry is
 *   attributed to them (FR-045), and their address, so the backend's per-address limit counts the
 *   shopper rather than the storefront (FR-041). Every answer becomes one outcome the handler speaks.
 */

export const FORMS_PUBLIC_API_PATH = '/api/v1/storefront/forms';

/** The public definition of a form in the request's channel and the page language. */
export async function getPublicForm(formId: string, ctx: RequestContext): Promise<PublicFormDefinition> {
  // The language rides on the URL as well as `Accept-Language`, so each language has its own entry.
  const query = ctx.locale ? `?language=${encodeURIComponent(ctx.locale)}` : '';
  const anonymous: RequestContext = {
    ...(ctx.salesChannelCode !== undefined ? { salesChannelCode: ctx.salesChannelCode } : {}),
    ...(ctx.locale !== undefined ? { locale: ctx.locale } : {}),
  };
  const response = await apiGet<{ data: PublicFormDefinition }>(
    `${FORMS_PUBLIC_API_PATH}/${encodeURIComponent(formId)}${query}`,
    anonymous,
    { revalidate: 60, tags: [FORMS_STOREFRONT_CACHE_TAGS.form(formId)] },
  );
  return response.data;
}

/** One refused answer, as the backend words it in the submission language. */
export interface FormFieldRefusal {
  fieldKey: string;
  code: string;
  message: string;
}

export type FormSubmitOutcome =
  | { kind: 'accepted'; confirmation: FormSubmitResponse['confirmation'] }
  | { kind: 'invalid'; fields: FormFieldRefusal[] }
  | { kind: 'captcha' }
  /** The CAPTCHA provider could not be reached (`503 FORM_CAPTCHA_UNAVAILABLE`): try again shortly. */
  | { kind: 'captcha_unavailable' }
  | { kind: 'not_accepting'; reason: FormNotAcceptingReason | 'unavailable' }
  | { kind: 'too_large' }
  | { kind: 'rate_limited' }
  | { kind: 'unavailable' };

const NOT_ACCEPTING_REASONS: readonly string[] = ['closed', 'not_yet_open', 'full', 'sign_in_required', 'unavailable'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `details.fields` of a refusal, the entries that have the expected shape. */
function refusedFields(details: unknown): FormFieldRefusal[] {
  const fields = isRecord(details) ? details['fields'] : undefined;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) =>
    isRecord(field) && typeof field['fieldKey'] === 'string' && typeof field['code'] === 'string'
      ? [{ fieldKey: field['fieldKey'], code: field['code'], message: typeof field['message'] === 'string' ? field['message'] : '' }]
      : [],
  );
}

function outcomeOf(error: StorefrontApiError): FormSubmitOutcome {
  if (error.status === 400 && error.code === 'FORM_CAPTCHA_FAILED') return { kind: 'captcha' };
  if (error.status === 400) return { kind: 'invalid', fields: refusedFields(error.details) };
  if (error.status === 409 && error.code === 'FORM_NOT_ACCEPTING') {
    const code = isRecord(error.details) ? error.details['code'] : undefined;
    return {
      kind: 'not_accepting',
      reason: typeof code === 'string' && NOT_ACCEPTING_REASONS.includes(code) ? (code as FormNotAcceptingReason) : 'unavailable',
    };
  }
  if (error.status === 413) return { kind: 'too_large' };
  if (error.status === 429) return { kind: 'rate_limited' };
  if (error.status === 503 && error.code === 'FORM_CAPTCHA_UNAVAILABLE') return { kind: 'captcha_unavailable' };
  return { kind: 'unavailable' };
}

export async function submitFormEntry(input: {
  formId: string;
  body: FormSubmitBody;
  channelCode: string;
  locale: string;
  sessionCookie?: string | null;
  forwardedFor?: string | null;
}): Promise<FormSubmitOutcome> {
  try {
    const result = await apiMutate<FormSubmitResponse>({
      method: 'POST',
      path: `${FORMS_PUBLIC_API_PATH}/${encodeURIComponent(input.formId)}/entries`,
      body: input.body,
      ctx: { salesChannelCode: input.channelCode, locale: input.locale },
      sessionCookie: input.sessionCookie ?? null,
      ...(input.forwardedFor ? { headers: { 'x-forwarded-for': input.forwardedFor } } : {}),
    });
    if (result.data?.status === 'accepted') return { kind: 'accepted', confirmation: result.data.confirmation };
    return { kind: 'unavailable' };
  } catch (err) {
    if (err instanceof StorefrontApiError) return outcomeOf(err);
    return { kind: 'unavailable' };
  }
}
