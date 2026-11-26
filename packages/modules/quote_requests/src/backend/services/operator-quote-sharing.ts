import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, quoteValidityDaysSchema, type CustomerAccountRecord } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { QuoteRequest } from '../entities/quote-request.entity.js';
import type { QuoteRequestEvent } from '../entities/quote-request-event.entity.js';
import type { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import type { QuoteRequestItemGroup } from '../entities/quote-request-item-group.entity.js';
import type { RfqEventService } from './rfq-event-service.js';
import type { RfqNotificationService } from './rfq-notification-service.js';
import type { RfqRevisionService } from './rfq-revision-service.js';

/**
 * Sharing an operator's quote with its customer —
 * `specs/192-quote-request-draft-share/` (research R-2, R-4, R-5, R-8 – R-10).
 *
 * The rules the create, the edit and the share Command apply to an operator's
 * quote while it is unshared, in one place.
 */

const DAY_MS = 86_400_000;

/**
 * Whether a new operator quote starts unshared (research R-2, FR-001) — **the
 * one decision point**, and `makeCreateOnBehalfCommand` (`quote_request.create_on_behalf`) its one caller.
 * Always, by owner decision; a setting that makes unshared quotes optional reads here,
 * and its `false` branch then shares at create through {@link applyShare} —
 * deciding whether that runs the share's hooks, and refusing unpriced lines
 * (R-19). Not written now: with this answer fixed, no test could reach it.
 */
export function operatorQuoteStartsUnshared(): boolean {
  return true;
}

/**
 * The validity days an operator sent, as a quote carries them (research R-10,
 * FR-032): `0` and `null` both mean no deadline, answered as `null`; a positive
 * number is kept.
 *
 * **The one place that decides it**, for every write of a validity: the create,
 * an edit of an unshared quote (stored as days, applied at the share) and a
 * revision of a shared quote (a date from now). By owner decision of
 * 2026-11-24 `0` is never "expires now" — an operator closes an offer by
 * cancelling it.
 */
export function normaliseShareValidityDays(days: number | null): number | null {
  return days === null || days === 0 ? null : days;
}

/**
 * The `quote_requests.default_validity_days` setting as stored, read as days
 * (research R-12): a whole number from `0` to `QUOTE_VALIDITY_DAYS_MAX`, the
 * bound `expiresInDays` has. Anything else — a negative, a fraction, a value
 * past the bound or no number at all — answers `null`, which the reader turns
 * into `0`, no deadline, rather than a refused create or a `500` at the share.
 */
export function defaultValidityDaysFromSetting(stored: unknown): number | null {
  const parsed = quoteValidityDaysSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

/**
 * Research R-8, FR-026 — a share is refused while any line has no agreed price:
 * `409 QUOTE_INCOMPLETE`, token `share`, naming each unpriced line in display
 * order (`lines` as `loadArrangedQuoteLines` answers them). `null` = every
 * line is priced; a price of zero is a price.
 */
export function unpricedLinesRefusal(arranged: {
  readonly lines: ReadonlyArray<
    Pick<QuoteRequestItem, 'id' | 'productName' | 'agreedUnitPrice' | 'position'> & {
      variantLabel?: string | null;
      groupId?: string | null;
    }
  >;
  readonly groups: ReadonlyArray<Pick<QuoteRequestItemGroup, 'id' | 'name'>>;
}): HttpError | null {
  const groupName = new Map(arranged.groups.map((group) => [group.id, group.name]));
  const lines = arranged.lines
    .filter((line) => line.agreedUnitPrice == null)
    .map((line) => ({
      id: line.id,
      position: line.position,
      productName: line.productName,
      variantLabel: line.variantLabel ?? null,
      groupName: line.groupId ? (groupName.get(line.groupId) ?? null) : null,
    }));
  if (lines.length === 0) return null;
  return new HttpError(
    409,
    ERROR_CODES.QUOTE_INCOMPLETE,
    'Quote Request has a line with no agreed unit price, so it cannot be shared.',
    { code: 'share', lines },
  );
}

/** Why a quote's customer account cannot receive it — the tokens of `RFQ_SHARE_CUSTOMER_UNAVAILABLE`. */
export type CustomerUnavailability = 'not_member' | 'inactive' | 'blocked';

/**
 * Research R-9, FR-027 — whether the quote's customer account can receive it:
 * gone or moved to another Organization (`not_member`), deleted or anonymised
 * (`inactive`), blocked from signing in (`blocked`); `null` = available. The
 * record is read without `activeOnly`, so a deleted account says so.
 */
export function customerUnavailability(
  account: Pick<CustomerAccountRecord, 'organizationId' | 'deletedAt' | 'anonymizedAt' | 'blockedAt'> | null,
  organizationId: string,
): CustomerUnavailability | null {
  if (account === null || account.organizationId !== organizationId) return 'not_member';
  if (account.deletedAt != null || account.anonymizedAt != null) return 'inactive';
  if (account.blockedAt != null) return 'blocked';
  return null;
}

/** The refusal for {@link customerUnavailability}'s answer. */
export function customerUnavailableError(reason: CustomerUnavailability): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.RFQ_SHARE_CUSTOMER_UNAVAILABLE,
    "The quote request's customer account cannot receive it.",
    { code: reason },
  );
}

export interface ApplyShareDeps {
  readonly eventService: Pick<RfqEventService, 'append'>;
  readonly notificationService: Pick<RfqNotificationService, 'record'>;
  readonly revisionService: Pick<RfqRevisionService, 'byNumber'>;
}

/**
 * What a share writes, on the caller's transactional `em` (research R-4 step 6,
 * R-5, R-10): the row shared — when, by whom — with its validity date counted
 * from `now` by the days stored on the unshared quote (`null` = no deadline) and its
 * `version` moved; the `shared` history entry on the current revision (the
 * content the customer is shown); and the existing `prepared` notification
 * announcing that entry. Answers the entry.
 *
 * The caller has already refused everything a share may be refused for, and
 * is the share Command, whose audit entry covers this write.
 */
export async function applyShare(
  em: EntityManager,
  quote: QuoteRequest,
  actor: { adminUserId: string | null; roleLabel: string | null },
  now: Date,
  deps: ApplyShareDeps,
): Promise<QuoteRequestEvent> {
  const days = quote.shareValidityDays ?? null;
  quote.sharedWithCustomer = true;
  quote.sharedAt = now;
  quote.sharedByAdminUserId = actor.adminUserId;
  quote.expiresAt = days === null ? null : new Date(now.getTime() + days * DAY_MS);
  quote.version += 1;
  // No flush of its own. Everything here is written on the caller's
  // transactional `em`: appending the `shared` entry below flushes the row
  // with it, and the one caller, the share Command, flushes the rest
  // (`em.flush()`) after this returns and audits the write (Principle XIII).

  const revision = await deps.revisionService.byNumber(quote.id, quote.currentRevisionNumber);
  const shared = await deps.eventService.append(
    {
      quoteRequestId: quote.id,
      eventType: 'shared',
      actor: { adminUserId: actor.adminUserId, roleLabel: actor.roleLabel },
      payload: { type: 'shared', validityDays: days, expiresAt: quote.expiresAt?.toISOString() ?? null },
      revisionId: revision?.id ?? null,
    },
    em,
  );
  // `contracts/notification-matrix-amendment.md` — `prepared` announces the share.
  await deps.notificationService.record(em, { change: 'prepared', sourceEvent: shared, rfq: quote, actor: null });
  return shared;
}
