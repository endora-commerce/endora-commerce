/**
 * Feature 146 — the customer allow-list (threat model T7): the keys of a quote
 * request's items, events, event payloads and revision diffs that a customer
 * reply may carry. Anything not listed here is admin-only and is dropped from
 * a customer reply.
 */

/** The item keys a customer reply carries. Admin-only keys are not listed. */
export const CUSTOMER_ITEM_KEYS = [
  'id',
  'productId',
  'productName',
  'productSlug',
  'variantId',
  'variantLabel',
  'quantity',
  'desiredUnitPrice',
  'agreedUnitPrice',
  'lineNote',
  'lineCurrency',
  'discountPercent',
  'taxRate',
  'packagingUnitName',
  'packagingUnitBaseQuantity',
  // Feature 155 — the catalogue unit the line resolved to (analyze F14).
  'packagingUnitId',
  // Feature 159 — the line's group (one of the reply's non-empty `itemGroups`)
  // and its order within its section.
  'groupId',
  'position',
] as const;

/** The event keys a customer reply carries; `payload` is filtered on its own. */
export const CUSTOMER_EVENT_KEYS = [
  'id',
  'eventType',
  'actorCustomerAccountId',
  'actorRoleLabel',
  'payload',
  'revisionId',
  'createdAt',
] as const;

/**
 * The payload keys this module writes and a customer may read — the event
 * kind, counts, reasons, notes, the related request and order, and the
 * customer-facing revision diff.
 */
export const CUSTOMER_PAYLOAD_KEYS = new Set([
  'type',
  'itemCount',
  'diff',
  'note',
  'approvedBy',
  'canceledBy',
  'reason',
  'sourceRfqId',
  'newRfqId',
  'revisionNumber',
  'orderId',
  'expiryDaysAtTime',
  // Feature 146 (research R7) — a revision's validity change. The customer
  // already reads `expiresAt`; the before/after pair widens nothing.
  'validity',
]);

/**
 * Event types a customer reply leaves out entirely. Feature 153 (owner answer
 * Q4): a `pdf-sent` event names the addresses a representative e-mailed the
 * quote PDF to — possibly someone other than the requester — and is the
 * administrators' record of the send, shown on the admin History only.
 */
export const ADMIN_ONLY_EVENT_TYPES: ReadonlySet<string> = new Set(['pdf-sent', 'custom-field-carry-skipped']);

/**
 * The stored events a customer may see, in their stored order.
 *
 * `specs/192-quote-request-draft-share/` (FR-012, research R-14) — for a quote
 * an operator shared (`sharedAt` set), the customer's history starts at the
 * `shared` event: the creation, the automatic note and every edit made while
 * the quote was unshared are the operators' alone. The cut is by position, not
 * by comparing timestamps, which two statements write. A shared quote without
 * its `shared` event shows nothing from before it — none can be told apart.
 */
export function customerEventsOf<T extends { readonly eventType: string }>(
  events: readonly T[],
  sharedAt: Date | null = null,
): T[] {
  const from = sharedAt === null ? 0 : events.findIndex((event) => event.eventType === 'shared');
  const visible = from < 0 ? [] : events.slice(from);
  return visible.filter((event) => !ADMIN_ONLY_EVENT_TYPES.has(event.eventType));
}

/**
 * The keys of one `payload.diff` entry (`RfqDiffEntry`). `groupName` (feature
 * 159, research N-32) names the group of a product on several lines — a group
 * the customer was shown on that revision.
 */
export const CUSTOMER_DIFF_KEYS = new Set([
  'kind',
  'productId',
  'productName',
  'groupName',
  'quantity',
  'agreedUnitPrice',
  'before',
  'after',
]);

export function pickKeys<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = source[key];
  return out;
}

export function pickAllowed(source: Record<string, unknown>, allowed: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}

/** A stored event payload as a customer may read it. */
export function customerEventPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out = pickAllowed(payload ?? {}, CUSTOMER_PAYLOAD_KEYS);
  if (Array.isArray(out['diff'])) {
    out['diff'] = (out['diff'] as unknown[]).map((entry) =>
      entry !== null && typeof entry === 'object'
        ? pickAllowed(entry as Record<string, unknown>, CUSTOMER_DIFF_KEYS)
        : entry,
    );
  }
  return out;
}
