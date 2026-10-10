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
 * **`change` ends where the row's own write ends.** History rows, revisions and
 * notifications are written by services on connections of their own and
 * reference this row; written while the lock is held they would wait on it
 * forever. Every caller appends them after this returns.
 */
export async function underRowLock<T>(
  em: EntityManager,
  rfq: QuoteRequest,
  change: () => Promise<T>,
): Promise<T> {
  await em.begin();
  try {
    const rows = await em.execute<Array<{ version: number | string }>>(
      `select "version" from "quote_requests" where "id" = ? for update`,
      [rfq.id],
    );
    if (rows.length !== 1 || Number(rows[0]!.version) !== rfq.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Quote Request was updated concurrently.');
    }
    const result = await change();
    await em.commit();
    return result;
  } catch (error) {
    await em.rollback();
    throw error;
  }
}
