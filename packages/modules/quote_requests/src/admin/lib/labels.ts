import { defineEnumLabels } from '@endora-commerce/admin-kit/lib';
import type { AdminQuoteRequestListQuery, RfqStatus } from '@endora-commerce/contracts';

/**
 * A quote request status's name in the admin's language (issues #1434, #1476).
 *
 * The values are the persisted spellings — `Created from admin`, `Pending` —
 * which read as English words and were rendered as such in every language. The
 * keys are `core`'s, the bundle the list and the detail already read. Read with
 * `useTranslation('core')`.
 */
export const rfqStatusLabels = defineEnumLabels<RfqStatus>({
  'Created from admin': 'rfq.status.createdFromAdmin',
  Pending: 'rfq.status.pending',
  Canceled: 'rfq.status.canceled',
  Approved: 'rfq.status.approved',
  Completed: 'rfq.status.completed',
  Expired: 'rfq.status.expired',
});

/**
 * `specs/192-quote-request-draft-share/` (FR-009) — the list's sharing filter,
 * the values `adminQuoteRequestListQuerySchema.sharing` takes. The keys are this
 * module's own bundle: read with `useTranslation('quote_requests')`.
 */
export const rfqSharingLabels = defineEnumLabels<NonNullable<AdminQuoteRequestListQuery['sharing']>>({
  unshared: 'list.sharing.unshared',
  shared: 'list.sharing.shared',
});
