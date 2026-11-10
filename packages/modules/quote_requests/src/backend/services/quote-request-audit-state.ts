/**
 * The audit state of the Quote Request writes that record one.
 */

/** Every top-level key a Quote Request audit state may hold. */
export const QUOTE_REQUEST_AUDIT_KEYS: ReadonlySet<string> = new Set([
  'status',
  'hasReason',
  'cartId',
  'itemCount',
  'currentRevisionNumber',
  'revisionNumber',
  'decision',
  'salesChannelId',
  'assignedAdminUserId',
  'groups',
  'changedCustomFields',
  'customFieldCarry',
  'documentTemplateId',
  'templateId',
  'language',
  'recipientCount',
  'failedRecipientCount',
  'priceProposalsAllowed',
  'override',
]);

/** `quote_request.cancel` — an administrator cancelling a request. */
export function cancelAuditState(reason: string | null | undefined): Record<string, unknown> {
  return { status: 'Canceled', reason: reason ?? null };
}

/** `quote_request.prepare_customer_basket` — the owner's basket seeded from the request. */
export function prepareBasketAuditState(seeded: {
  cartId: string;
  customerAccountId: string;
  itemCount: number;
}): Record<string, unknown> {
  return { cartId: seeded.cartId, customerAccountId: seeded.customerAccountId, itemCount: seeded.itemCount };
}
