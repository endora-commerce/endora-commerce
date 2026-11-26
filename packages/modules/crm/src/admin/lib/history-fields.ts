/**
 * What the Change history tab knows about the keys of an audited state
 * (`before` / `after` of a `crm.opportunity.*` audit entry).
 *
 * Every key the backend can write is in exactly one of the two sets below —
 * `src/admin/index.test.ts` reads the services and holds that — so a key added
 * to an audited state cannot reach an operator as a raw name: it is given a
 * label here and in both bundles, or it is declared silent.
 */

/**
 * Identifiers that say nothing to a reader and are never a row of their own.
 * The ones that *name* something a person knows — the assignee, an Order — are
 * not here: they are resolved to a name where one is known.
 */
export const SILENT_HISTORY_FIELDS: ReadonlySet<string> = new Set([
  'linkId',
  'commentId',
  'attachmentId',
  'assetId',
  // Which Event an entry is about is said by its name, beside it.
  'eventId',
  'propagationId',
  'linkedByAdminUserId',
  // Who wrote a note or a message is the entry's own actor, named above it.
  'authorAdminUserId',
  'version',
  // A status change says its status and its cause as a sentence of its own.
  'cause',
  'causeOrderId',
  'status',
  // Issue #470 — what an entry says in place of the values the Opportunity's
  // own store keeps. The history serves those values instead; the names reach
  // the tab only if the store row were gone.
  'valueChangeId',
  'changedFields',
  'changedCustomFields',
]);

/** The fields with a label under `history.field.<field>` in both bundles. */
export const LABELLED_HISTORY_FIELDS: ReadonlySet<string> = new Set([
  'title',
  'description',
  'customerAccountId',
  'salesChannelId',
  'assignedAdminUserId',
  'valueMode',
  'manualValue',
  'expectedCloseDate',
  'currency',
  'organizationId',
  'number',
  'source',
  'tags',
  'customFieldValues',
  // Feature 162 — the values a creation or a join could not carry in; what it
  // did carry shows through `customFieldValues`.
  'customFieldCarry',
  'documentKind',
  'documentId',
  'linkedDocument',
  'syncStatus',
  'linkSource',
  'orderId',
  'orderStatusCode',
  'skippedStatus',
  'outcome',
  // Not a stored key: the refusal a retry starts from, shown under a name
  // that does not read as the retry's own result.
  'retriedOutcome',
  'dismissed',
  'deleted',
  'reason',
  'body',
  'length',
  'kind',
  'fileName',
  'statusCode',
  // An Event on the Opportunity (User Story 21): its name and its times.
  'eventName',
  'allDay',
  'startsAt',
  'endsAt',
  'remindAt',
]);

/** A key as words — `riskProfile` and `risk_profile` both read `risk profile`. */
export function humaniseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The one action whose `source` is the Opportunity's origin (`manual`, `order`, `quote_request`). */
const ORIGIN_SOURCE_ACTION = 'crm.opportunity.create';

/**
 * An entry as the tab reads it: on every action but the creation, `source` is
 * the code of the integration that wrote through `opportunityCommandPort`
 * (`specs/186-aggregate-ports/` R-4), not a field of the Opportunity, so it is
 * dropped rather than shown as a change of "Source". On the creation it is the
 * origin, which a port-made Opportunity always has as `manual` — and an origin
 * the tab does not know already reads as *Manual*. The platform audit log keeps
 * the code; only this tab leaves it out (research R-21.7).
 */
export function withoutCallerSource<T extends { action?: string; before: unknown; after: unknown }>(entry: T): T {
  if (entry.action === ORIGIN_SOURCE_ACTION) return entry;
  const strip = (state: unknown): unknown => {
    if (state === null || typeof state !== 'object' || Array.isArray(state) || !('source' in state)) return state;
    const { source: _source, ...rest } = state as Record<string, unknown>;
    return rest;
  };
  return { ...entry, before: strip(entry.before), after: strip(entry.after) };
}
