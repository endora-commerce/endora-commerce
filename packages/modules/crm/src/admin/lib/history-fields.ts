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
