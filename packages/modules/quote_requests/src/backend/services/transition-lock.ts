import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { QuoteRequest } from '../entities/quote-request.entity.js';

/**
 * Run a change to one Quote Request while holding its row, having checked that
 * the row is still the one the caller read.
 *
 * Every transition of a request reads it, validates it and writes it, and
 * between the read and the write the request can change under the caller: the
 * expiry sweep can expire it, or the other party can answer it. Nothing guarded
 * that window. A buyer's accept that raced the sweep answered 200 and left a
 * request `Approved` with `expiredAt` set, an `expired` row in its history, an
 * `rfq.expired.v1` announced for an approved quote and one `version` bump
 * lost.
 *
 * This is the guard, the same on every side:
 *
 *  1. open a transaction on the caller's EntityManager and take the row
 *     `for update`;
 *  2. compare the row's `version` with the one the caller read — every
 *     transition and the sweep bump it — and refuse with `VERSION_CONFLICT`
 *     when it moved: what the caller validated is no longer what is stored;
 *  3. run `change`, which mutates the entity and may flush, and commit.
 *
 * The expiry sweep takes the same row `for update skip locked`, so the two are
 * mutually exclusive in both orders: a transition that holds the row is skipped
 * by the sweep, which finds it answered on its next pass; a sweep that got
 * there first has bumped the version, and the transition is refused.
 *
 * **Everything the change writes is written on `em`.** The history entry a
 * transition announces, the revision it records and the notification records
 * that name that entry are part of the change
 * (`specs/179-rfq-and-customer-notifications/` FR-001, research R-6): they
 * commit with it or not at all. Each is written by passing `em` as `within`
 * (`RfqEventService.append`, `RfqRevisionService.record`,
 * `RfqNotificationService.record`). A row written on a connection of its own
 * instead would reference this row, and wait on its lock forever.
 *
 * What may not be inside is what cannot be taken back: an event announced on
 * the bus, and the delivery kick. Both are the caller's, after this returns.
 *
 * (The customer's own draft edit, `RfqService.patchDraft`, notifies nobody and
 * still appends its revision and history entry after the lock.)
 */
export async function underRowLock<T>(
  em: EntityManager,
  rfq: QuoteRequest,
  change: () => Promise<T>,
): Promise<T> {
  return inTransaction(em, async () => {
    const rows = await em.execute<Array<{ version: number | string }>>(
      `select "version" from "quote_requests" where "id" = ? for update`,
      [rfq.id],
    );
    if (rows.length !== 1 || Number(rows[0]!.version) !== rfq.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Quote Request was updated concurrently.');
    }
    return change();
  });
}

/**
 * Run `change` in one transaction on `em` itself — no fork, so the entities the
 * caller holds are the ones written — and commit, or roll back and re-throw.
 *
 * For a write with no row to lock yet: a new request (`createForCustomer`,
 * `resubmit`, `createOnBehalf`), whose row, lines, revision, history entries
 * and notification records commit together.
 */
export async function inTransaction<T>(em: EntityManager, change: () => Promise<T>): Promise<T> {
  await em.begin();
  try {
    const result = await change();
    await em.commit();
    return result;
  } catch (error) {
    await em.rollback();
    throw error;
  }
}
