import { apiBaseUrl, apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  FormCreateBody,
  FormDetail,
  FormEntryDetail,
  FormEntryStatus,
  FormEntrySummary,
  FormLanguagesResponse,
  FormNotificationsBody,
  FormStatus,
  FormSummary,
  FormUpdateBody,
  PublicFormDefinition,
} from '@endora-commerce/contracts';

/**
 * The HTTP calls of the Forms admin screens (`specs/170-forms-module/contracts/admin-api.md` §1, §2).
 *
 * Every shape is `@endora-commerce/contracts`' — the schemas the backend validates with. Every
 * answer is a `{ data }` envelope; a write answers the form as it is afterwards, so a screen keeps
 * the revision the next write must name (R-26).
 */

const BASE = '/api/v1/admin/forms';

export interface FormListParams {
  readonly q?: string | undefined;
  readonly status?: FormStatus | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
}

/** A published version as the versions list shows it. */
export interface FormVersionItem {
  readonly number: number;
  readonly publishedAt: string;
  readonly publishedByAdminUserId: string | null;
}

/** The preview read: the public definition of the chosen copy, plus the form's status. */
export type FormPreview = PublicFormDefinition & { readonly status: FormStatus };

function data<T>(promise: Promise<{ data: T }>): Promise<T> {
  return promise.then((envelope) => envelope.data);
}

function query(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== '') qs.set(name, String(value));
  const tail = qs.toString();
  return tail ? `?${tail}` : '';
}

export const formsApi = {
  list(params: FormListParams = {}): Promise<{ items: FormSummary[]; total: number }> {
    return data(apiClient.get(`${BASE}${query({ q: params.q, status: params.status, page: params.page, pageSize: params.pageSize })}`));
  },

  /** The storefront languages a form may be written in, and the system default's. */
  languages(): Promise<FormLanguagesResponse> {
    return data(apiClient.get(`${BASE}/languages`));
  },

  get(id: string): Promise<FormDetail> {
    return data(apiClient.get(`${BASE}/${id}`));
  },

  create(body: FormCreateBody): Promise<FormDetail> {
    return data(apiClient.post(BASE, body));
  },

  /** The working copy and the live identity; the served version is untouched (FR-009). */
  update(id: string, body: FormUpdateBody): Promise<FormDetail> {
    return data(apiClient.put(`${BASE}/${id}`, body));
  },

  /** The shop notification's recipients — live, effective for the next entry (FR-056). */
  notifications(id: string, body: FormNotificationsBody): Promise<FormDetail> {
    return data(apiClient.put(`${BASE}/${id}/notifications`, body));
  },

  /**
   * The retention period — live, applied by the next maintenance run (FR-054). The server allows it
   * only to an unrestricted administrator holding `forms:entries_write` (403 `FORM_SCOPE_REQUIRED`).
   */
  retention(id: string, expectedRevision: number, retentionDays: number | null): Promise<FormDetail> {
    return data(apiClient.put(`${BASE}/${id}/retention`, { expectedRevision, retentionDays }));
  },

  /** How many entries a period of `days` would delete now, counted in the caller's scope. */
  retentionImpact(id: string, days: number): Promise<{ entriesToDelete: number }> {
    return data(apiClient.get(`${BASE}/${id}/retention-impact${query({ days })}`));
  },

  publish(id: string, expectedRevision: number): Promise<FormDetail> {
    return data(apiClient.post(`${BASE}/${id}/publish`, { expectedRevision }));
  },

  close(id: string, expectedRevision: number): Promise<FormDetail> {
    return data(apiClient.post(`${BASE}/${id}/close`, { expectedRevision }));
  },

  reopen(id: string, expectedRevision: number): Promise<FormDetail> {
    return data(apiClient.post(`${BASE}/${id}/reopen`, { expectedRevision }));
  },

  duplicate(id: string): Promise<FormDetail> {
    return data(apiClient.post(`${BASE}/${id}/duplicate`, {}));
  },

  /**
   * Deletes a form; `withEntries` confirms that its entries go too (FR-013) — which the server
   * allows only to an unrestricted administrator holding `forms:entries_write`.
   */
  remove(id: string, expectedRevision: number, withEntries = false): Promise<void> {
    return apiClient.delete(`${BASE}/${id}${query({ expectedRevision, confirmEntriesDeletion: withEntries ? 'true' : undefined })}`);
  },

  versions(id: string): Promise<{ items: FormVersionItem[] }> {
    return data(apiClient.get(`${BASE}/${id}/versions`));
  },

  preview(id: string, source: 'working' | 'published', language?: string): Promise<FormPreview> {
    return data(apiClient.get(`${BASE}/${id}/preview${query({ source, language })}`));
  },
};

// --- Entries (admin-api.md §2) -------------------------------------------------------------------

/** Under `/forms/entries` (lead decision, 2026-11-02), beside the forms. */
const ENTRIES = `${BASE}/entries`;

export interface EntryFilterParams {
  readonly formId?: string | undefined;
  readonly status?: readonly FormEntryStatus[] | undefined;
  readonly submittedFrom?: string | undefined;
  readonly submittedTo?: string | undefined;
  readonly salesChannelId?: string | undefined;
  readonly q?: string | undefined;
}

export interface EntryListParams extends EntryFilterParams {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export type EntryNote = FormEntryDetail['notes'][number];

/** The filter as a query string, the form first; statuses as a repeated key. */
function entryQuery(params: EntryListParams): string {
  const qs = new URLSearchParams();
  if (params.formId) qs.set('formId', params.formId);
  for (const status of params.status ?? []) qs.append('status', status);
  if (params.submittedFrom) qs.set('submittedFrom', params.submittedFrom);
  if (params.submittedTo) qs.set('submittedTo', params.submittedTo);
  if (params.salesChannelId) qs.set('salesChannelId', params.salesChannelId);
  if (params.q) qs.set('q', params.q);
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  const tail = qs.toString();
  return tail ? `?${tail}` : '';
}

export const entriesApi = {
  /** Newest first; `nextCursor` names the page of older entries. */
  list(params: EntryListParams = {}): Promise<{ items: FormEntrySummary[]; nextCursor: string | null }> {
    return data(apiClient.get(`${ENTRIES}${entryQuery(params)}`));
  },

  /** The detail without a side effect — integrations read entries without marking them. */
  get(id: string): Promise<FormEntryDetail> {
    return data(apiClient.get(`${ENTRIES}/${id}`));
  },

  /** Opening the screen: `new` becomes `read` once (R-16). */
  markRead(id: string): Promise<FormEntryDetail> {
    return data(apiClient.post(`${ENTRIES}/${id}/mark-read`, {}));
  },

  /** Any status to any other, naming the one it moves from — the *Undo* re-issues it reversed. */
  changeStatus(id: string, status: FormEntryStatus, expectedStatus: FormEntryStatus): Promise<FormEntryDetail> {
    return data(apiClient.patch(`${ENTRIES}/${id}/status`, { status, expectedStatus }));
  },

  addNote(id: string, body: string): Promise<EntryNote> {
    return data(apiClient.post(`${ENTRIES}/${id}/notes`, { body }));
  },

  remove(id: string): Promise<void> {
    return apiClient.delete(`${ENTRIES}/${id}`);
  },

  removeMany(ids: readonly string[]): Promise<{ deleted: number }> {
    return data(apiClient.post(`${ENTRIES}/delete`, { ids }));
  },

  /** The CSV download's address: a plain link, so the browser streams it to a file (R-18). */
  exportUrl(params: EntryFilterParams & { formId: string }): string {
    return `${apiBaseUrl}${ENTRIES}/export${entryQuery(params)}`;
  },
};
