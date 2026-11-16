import type { FormEntryStatus } from '@endora-commerce/contracts';

/**
 * What the audit entry of a Command that writes about form entries may say (issue #470, D-288;
 * `specs/conventions/audit-state.md`).
 *
 * A `FormEntry` is `@CustomerScoped`, and the platform audit log is one global table read under
 * `audit_log:read` without Organization reach. So the entries of the entry Commands — and of
 * `forms.entries.export`, which is recorded against the global form but writes about its entries
 * (§5) — carry ids, codes, dates, booleans and counts, never an answer, a note's body, the
 * submitter's address or the search text a caller typed.
 *
 * No screen reads these values back out of the audit log, so there is no value store.
 */

/**
 * Every top-level key the audit state of an entry Command may hold. Anything else is a value until
 * somebody classifies it on purpose — `entry-audit-sentinels.test.ts` holds every recorded state
 * to this list.
 */
export const FORMS_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // The form the entries belong to (a global record), by id; the bulk deletes name every form.
  'formId',
  'formIds',
  // Codes: the entry's status, the version number it was sent to, its channel and language.
  'status',
  'formVersion',
  'salesChannelId',
  'language',
  // Whether the entry is attributed to an account, never which one.
  'attributed',
  // The note a `note_add` appended, by id.
  'noteId',
  // Counts and dates.
  'deleted',
  'rowCount',
  'cutoff',
  // The export's filter, by shape (`FORMS_EXPORT_FILTER_AUDIT_KEYS`).
  'filter',
]);

/** Every key the `filter` of a `forms.entries.export` audit state may hold. */
export const FORMS_EXPORT_FILTER_AUDIT_KEYS: ReadonlySet<string> = new Set([
  'status',
  'submittedFrom',
  'submittedTo',
  'salesChannelId',
  // Whether a search text was given and how long it was — never the text (§2: free text).
  'hasQuery',
  'queryLength',
]);

/** The export filter as the caller gave it, before it is read. */
export interface EntryFilterAuditInput {
  readonly status?: readonly FormEntryStatus[] | undefined;
  readonly submittedFrom?: string | undefined;
  readonly submittedTo?: string | undefined;
  readonly salesChannelId?: string | undefined;
  readonly q?: string | undefined;
}

/**
 * The filter as its audit state records it: its shape — the status codes, the dates, the channel
 * id and whether a query was given — never a result, and never the query's text.
 */
export function filterAuditState(filter: EntryFilterAuditInput): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  if (filter.status && filter.status.length > 0) state['status'] = [...filter.status];
  if (filter.submittedFrom) state['submittedFrom'] = filter.submittedFrom;
  if (filter.submittedTo) state['submittedTo'] = filter.submittedTo;
  if (filter.salesChannelId) state['salesChannelId'] = filter.salesChannelId;
  if (filter.q) {
    state['hasQuery'] = true;
    state['queryLength'] = filter.q.length;
  }
  return state;
}
