import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, returnCaseOrderLockKey } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/** How long issuing waits for a settlement of the same order. */
const ISSUE_LOCK_TIMEOUT = '15s';
/** PostgreSQL's `lock_not_available`, raised when `lock_timeout` elapses. */
const LOCK_NOT_AVAILABLE = '55P03';

/** Runs `body` while holding the order's returns lock. */
export interface OrderReturnsLock {
  run<T>(orderId: string, body: () => Promise<T>): Promise<T>;
}

/**
 * The order's returns lock, as `returns` takes it to create and to settle a
 * case (`returnCaseOrderLockKey`, review of PR #865, F3), held on a connection
 * of its own for the whole issuance — the reads of what came back and was
 * refunded, and the invoice's own unit of work — the way the settlement holds
 * it. A settlement records the resolution only after it has moved money and
 * asked for a correction, which answers `not_due` while no invoice exists; an
 * invoice issued in between would list every line and nothing would ever take
 * the returned goods off. Issuing waits for it instead, and a settlement that
 * starts afterwards waits for the invoice and corrects it. Waiting longer than
 * {@link ISSUE_LOCK_TIMEOUT} is refused as retryable, with nothing issued.
 */
export function createOrderReturnsLock(emFactory: () => EntityManager): OrderReturnsLock {
  return {
    run: (orderId, body) =>
      emFactory()
        .getKnex()
        .transaction(async (lock) => {
          await lock.raw(`set local lock_timeout = '${ISSUE_LOCK_TIMEOUT}'`);
          try {
            await lock.raw('select pg_advisory_xact_lock(hashtext(?))', [returnCaseOrderLockKey(orderId)]);
          } catch (err) {
            if ((err as { code?: string }).code !== LOCK_NOT_AVAILABLE) throw err;
            throw new HttpError(
              409,
              ERROR_CODES.VERSION_CONFLICT,
              'A return of this order is being settled. Try again in a moment.',
              { code: 'settlement_in_progress' },
            );
          }
          return body();
        }),
  };
}
