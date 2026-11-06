import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import { QuoteRequestEvent } from '../entities/quote-request-event.entity.js';
import { QuoteRequestRevision } from '../entities/quote-request-revision.entity.js';
import { pairLines } from './line-carry-over.js';

/*
 * Feature 146 — what a customer's draft may still carry: whether the draft is
 * still open to the customer (FR-038), and the proposals of the submission
 * record a line fell back on (research R4).
 */

/**
 * FR-038 (research R15, threat model T3) — a customer may edit a draft until an
 * administrator has revised it, and never after. Three marks say "revised", and
 * each one alone can be visible before the others:
 *
 *  1. `awaitingCustomerRevisionAcceptance` — committed with the admin's lines;
 *  2. a `modified` event with an administrator as actor — appended last;
 *  3. an admin-authored latest revision — recorded between the two.
 *
 * Customer-authored `modified` events, an organization administrator's edit of
 * a colleague's draft included, never close the draft, however many there are.
 */
export async function assertDraftOpenForCustomer(
  em: EntityManager,
  quoteRequestId: string,
  awaitingCustomerRevisionAcceptance: boolean,
): Promise<void> {
  const refuse = (): never => {
    throw new HttpError(
      409,
      ERROR_CODES.RFQ_NOT_DRAFT,
      'Quote Request is in admin review; resubmit instead of editing.',
    );
  };
  if (awaitingCustomerRevisionAcceptance) refuse();
  const adminModified = await em.count(QuoteRequestEvent, {
    quoteRequestId,
    eventType: 'modified',
    actorAdminUserId: { $ne: null },
  });
  if (adminModified > 0) refuse();
  const [latest] = await em.find(
    QuoteRequestRevision,
    { quoteRequestId },
    { orderBy: { revisionNumber: 'desc' }, limit: 1 },
  );
  if (latest?.createdByAdminUserId != null) refuse();
}

/**
 * The customer's proposal per line from the **submission record** (research
 * R4), for a line whose row lost it to an admin revision written before
 * feature 146 carried `desiredUnitPrice`.
 *
 * The submission record is the latest customer-authored revision before the
 * first admin-authored one. The events, already read, name both in order, so
 * this costs one revision read — and none when every line still carries its
 * proposal or no administrator has revised the request. Lines pair with the
 * snapshot by the R6 rule (`pairLines`, customer mode).
 */
export async function submissionRecordProposals(
  em: EntityManager,
  items: readonly QuoteRequestItem[],
  events: readonly QuoteRequestEvent[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (items.every((it) => it.desiredUnitPrice != null)) return out;

  let recordId: string | null = null;
  let adminRevised = false;
  for (const event of events) {
    if (!event.revisionId) continue;
    if (event.actorAdminUserId != null) {
      adminRevised = true;
      break;
    }
    if (event.actorCustomerAccountId != null) recordId = event.revisionId;
  }
  if (!adminRevised || recordId === null) return out;

  if (!isUuidShape(recordId)) return out;
  const record = await em.findOne(QuoteRequestRevision, { id: recordId });
  if (!record || record.createdByCustomerAccountId == null) return out;

  const snapshot = record.itemsSnapshot.map((line, index) => ({
    id: String(index),
    productId: line.productId,
    variantId: line.variantId ?? null,
    packagingUnitName: line.packagingUnitName ?? null,
    desiredUnitPrice: line.desiredUnitPrice ?? null,
  }));
  const { paired } = pairLines(
    snapshot,
    items.map((it) => ({
      productId: it.productId,
      variantId: it.variantId ?? null,
      packagingUnitName: it.packagingUnitName ?? null,
    })),
    'customer',
  );
  items.forEach((it, index) => {
    const match = paired[index];
    if (match) out.set(it.id, match.desiredUnitPrice);
  });
  return out;
}
