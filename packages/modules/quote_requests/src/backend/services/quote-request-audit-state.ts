/**
 * What a Quote Request audit entry may say (issue #470, D-288;
 * `specs/conventions/audit-state.md`).
 *
 * The platform audit log is one global table read under `audit_log:read`
 * without Organization reach, so a Quote Request's entry carries **names and
 * structure**: status and decision codes, revision numbers, counts, ids of
 * global records and of its own basket, and the names of what changed. Its
 * custom-field values, a cancellation's reason, its line groups' names, the
 * addresses its PDF went to and the customer it belongs to (the tenant anchor)
 * stay out.
 *
 * Those values already live in stores the module owns and reads under the
 * quote's own reach: the revisions (lines, prices, notes, groups), the history
 * events (`canceled` with its reason, `pdf-sent` with its recipients,
 * `custom-field-carry-skipped`) and the quote row itself. Nothing reads them
 * back out of the audit log, so no further store is needed.
 */

/**
 * Every top-level key a Quote Request audit state may hold. Anything else is a
 * value until somebody classifies it on purpose —
 * `quote-request-audit-sentinels.test.ts` holds the recorded states to this
 * list.
 */
export const QUOTE_REQUEST_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // Codes and numbers.
  'status',
  'hasReason',
  // The basket a request was turned into, and its size.
  'cartId',
  'itemCount',
  'currentRevisionNumber',
  'revisionNumber',
  'decision',
  'salesChannelId',
  'assignedAdminUserId',
  // Feature 159 — the grouping's shape: one line count per group, in order.
  'groups',
  // What changed among the custom fields, by key; what a carry did, by key and reason code.
  'changedCustomFields',
  'customFieldCarry',
  // Feature 153 — the PDF: its template (a global id), language and how many it went to.
  'documentTemplateId',
  'templateId',
  'language',
  'recipientCount',
  'failedRecipientCount',
  // Price negotiation policy: a boolean and a code.
  'priceProposalsAllowed',
  'override',
]);

/**
 * `quote_request.cancel` — an administrator cancelling a request: whether a
 * reason was given, never the reason. The reason is on the request
 * (`cancellationReason`) and on its `canceled` history event.
 */
export function cancelAuditState(reason: string | null | undefined): Record<string, unknown> {
  return { status: 'Canceled', hasReason: typeof reason === 'string' && reason.length > 0 };
}

/**
 * `quote_request.prepare_customer_basket` — the owner's basket seeded from the
 * request: the basket and its size. Not the owner: the customer is the
 * request's tenant anchor, and the entry's objectId leads to it for a reader
 * who may see the request.
 */
export function prepareBasketAuditState(seeded: {
  cartId: string;
  customerAccountId: string;
  itemCount: number;
}): Record<string, unknown> {
  return { cartId: seeded.cartId, itemCount: seeded.itemCount };
}
