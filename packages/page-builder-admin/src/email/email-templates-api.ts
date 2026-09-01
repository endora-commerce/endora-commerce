import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  CreateEmailTemplateRequest,
  EmailBranding,
  EmailTemplateDetail,
  EmailTemplateSummary,
  PutEmailBlockContentRequest,
} from '@endora-commerce/contracts';

/**
 * The five e-mail-template calls and the one branding read, rebuilt on the
 * published `apiClient` — the **client exit**
 * (`specs/091-module-owned-admin-surfaces/contracts/admin-component-contribution.md`
 * Z1.2, which is P2's clarification of R6 and needs no new rule).
 *
 * `email-template-layout.ts` and `EmailEditorPane` reached
 * `transactional_emails`' own `transactionalEmailsClient` for these. That is the
 * one kind of module knowledge a published component may carry and rebuild — an
 * HTTP path plus a contract type — and every type it needs is already
 * `@endora-commerce/contracts`', so nothing here is a copy of a
 * `transactional_emails` type.
 *
 * **The rejected alternative is why this is not a shortcut.** Having
 * `transactional_emails` publish the three template operations on its own
 * package would re-create the coupling this removes: `newsletter` would reach
 * `@endora-commerce/mod-transactional-emails` for its template hub, a real
 * cross-module reach ledgered for as long as it stood, where three `GET`/`POST`s
 * over published types are none.
 *
 * **The branding exposure is carried across unchanged and is recorded rather
 * than solved** (Z1.2). The endpoint is `transactional_emails`', so an operator
 * who switches that module off gets a 503 here — as they did before this package
 * existed. The call site degrades to an empty logo and the builder still opens,
 * which is honest.
 */
const BASE = '/api/v1/admin/transactional-emails';

type Wrap<T> = { data: T };

const unwrap = <T>(p: Promise<Wrap<T>>): Promise<T> => p.then((r) => r.data);

/** `?salesChannelId=…`, or the empty string for the unscoped read. */
function scopeQs(salesChannelId: string | null): string {
  return salesChannelId ? `?salesChannelId=${encodeURIComponent(salesChannelId)}` : '';
}

/** The logo and accent colour the preview resolves `{{var branding.*}}` from. */
export function getEmailBranding(salesChannelId: string | null): Promise<EmailBranding> {
  return unwrap(apiClient.get<Wrap<EmailBranding>>(`${BASE}/branding${scopeQs(salesChannelId)}`));
}

/** The templates offered by the "apply a template" picker. */
export function listEmailTemplates(
  salesChannelId?: string,
): Promise<{ items: EmailTemplateSummary[] }> {
  return unwrap(
    apiClient.get<Wrap<{ items: EmailTemplateSummary[] }>>(
      `${BASE}/templates${scopeQs(salesChannelId ?? null)}`,
    ),
  );
}

/** One template with its per-language canvases. */
export function getEmailTemplate(id: string): Promise<EmailTemplateDetail> {
  return unwrap(
    apiClient.get<Wrap<EmailTemplateDetail>>(`${BASE}/templates/${encodeURIComponent(id)}`),
  );
}

/** Create the template a "save canvas as template" writes into. */
export function createEmailTemplate(
  body: CreateEmailTemplateRequest,
): Promise<EmailTemplateDetail> {
  return unwrap(apiClient.post<Wrap<EmailTemplateDetail>>(`${BASE}/templates`, body));
}

/** Write one language's canvas into an existing template. */
export function putEmailTemplateContent(
  id: string,
  language: string,
  body: PutEmailBlockContentRequest,
): Promise<EmailTemplateDetail> {
  return unwrap(
    apiClient.put<Wrap<EmailTemplateDetail>>(
      `${BASE}/templates/${encodeURIComponent(id)}/content/${language}`,
      body,
    ),
  );
}
