import { describe, expect, it } from 'vitest';
import {
  authorOfCurrentStatus,
  currentStatusAuthors,
  type StatusTransitionRecord,
} from '../../../src/modules/orders/domain/status-authorship.js';

/**
 * Issue #284 — reading an order's transition history back to find out who put
 * it where it is.
 *
 * The three shapes research R14 tabulated are what an entry can carry, plus the
 * fourth it did not list:
 *
 * | `actorAdminUserId` | `impersonatedCustomerAccountId` | Means |
 * | --- | --- | --- |
 * | set | null | an administrator acted |
 * | set | set | an administrator acted on a customer's behalf |
 * | null | set | the customer acted themselves |
 * | **null** | **null** | **a `{ kind: 'system' }` actor acted** |
 *
 * The settlement ingress is the last row. `source` is not recorded at all, so
 * the payment ingress and the shipment ingress are one answer here and the
 * caller separates them by the configured failure status — see
 * `customer-cancellation.ts`.
 */

const AT = (ms: number): Date => new Date(1_700_000_000_000 + ms);

function entry(patch: Partial<StatusTransitionRecord> = {}): StatusTransitionRecord {
  return {
    orderId: 'order-1',
    actedAt: AT(0),
    statusAfter: 'on_hold',
    actorAdminUserId: null,
    impersonatedCustomerAccountId: null,
    ...patch,
  };
}

describe('authorOfCurrentStatus', () => {
  it('reads a system actor from an entry naming neither an admin nor a customer', () => {
    expect(authorOfCurrentStatus([entry()], 'on_hold')).toBe('system');
  });

  it('reads an administrator from the admin user id the entry keeps', () => {
    expect(authorOfCurrentStatus([entry({ actorAdminUserId: 'admin-7' })], 'on_hold')).toBe(
      'named_actor',
    );
  });

  it('reads the customer acting for themselves, which is the impersonation column with no admin', () => {
    // The convention `returns` established and feature 085 followed: a buyer's
    // own action lands on the impersonation column with `actorAdminUserId`
    // null. It is not a system actor and must not read as one.
    expect(
      authorOfCurrentStatus([entry({ impersonatedCustomerAccountId: 'cust-3' })], 'on_hold'),
    ).toBe('named_actor');
  });

  it('reads an administrator acting on a customer behalf as a named actor', () => {
    expect(
      authorOfCurrentStatus(
        [entry({ actorAdminUserId: 'admin-7', impersonatedCustomerAccountId: 'cust-3' })],
        'on_hold',
      ),
    ).toBe('named_actor');
  });

  it('takes the latest entry, not the first or the loudest', () => {
    const records = [
      entry({ actedAt: AT(0), statusAfter: 'processing' }),
      entry({ actedAt: AT(200), statusAfter: 'on_hold', actorAdminUserId: 'admin-7' }),
      entry({ actedAt: AT(100), statusAfter: 'paid' }),
    ];
    expect(authorOfCurrentStatus(records, 'on_hold')).toBe('named_actor');
  });

  it('answers unknown for an order with no history at all', () => {
    // A hold that predates Phase D, when no payment-driven status change was
    // audited, or one whose history has been trimmed.
    expect(authorOfCurrentStatus([], 'on_hold')).toBe('unknown');
  });

  it('answers unknown when the latest entry describes some other status', () => {
    // A write that did not go through the transition seam has happened since,
    // so the history no longer describes the order. Reported as "no answer"
    // rather than as the author of a status the order has left.
    expect(authorOfCurrentStatus([entry({ statusAfter: 'processing' })], 'on_hold')).toBe('unknown');
  });

  it('answers unknown when the entry carries no readable status', () => {
    expect(authorOfCurrentStatus([entry({ statusAfter: null })], 'on_hold')).toBe('unknown');
  });

  /**
   * `actedAt` is stamped when the entry is built and there is no sequence
   * column, so two entries can share the latest instant. Picking one of them
   * arbitrarily would make the answer depend on row order; every entry at that
   * instant has to agree instead.
   */
  it('refuses to choose between two entries stamped at the same instant', () => {
    const tie = [
      entry({ actedAt: AT(500) }),
      entry({ actedAt: AT(500), actorAdminUserId: 'admin-7' }),
    ];
    expect(authorOfCurrentStatus(tie, 'on_hold')).toBe('named_actor');

    const disagreeingStatuses = [
      entry({ actedAt: AT(500) }),
      entry({ actedAt: AT(500), statusAfter: 'processing' }),
    ];
    expect(authorOfCurrentStatus(disagreeingStatuses, 'on_hold')).toBe('unknown');
  });
});

describe('currentStatusAuthors — one flat list, one answer per order', () => {
  it('groups a batched read by order and answers each from its own entries', () => {
    const records = [
      entry({ orderId: 'a', actedAt: AT(0), statusAfter: 'on_hold' }),
      entry({ orderId: 'b', actedAt: AT(0), statusAfter: 'on_hold', actorAdminUserId: 'admin-7' }),
      entry({ orderId: 'a', actedAt: AT(-100), statusAfter: 'new', actorAdminUserId: 'admin-7' }),
    ];
    const authors = currentStatusAuthors(
      records,
      new Map([
        ['a', 'on_hold'],
        ['b', 'on_hold'],
        ['c', 'on_hold'],
      ]),
    );

    expect(authors.get('a')).toBe('system');
    expect(authors.get('b')).toBe('named_actor');
    // Asked about, no entries: present as `unknown` rather than absent, so a
    // caller cannot read "not in the map" as a different fact.
    expect(authors.get('c')).toBe('unknown');
    expect(authors.size).toBe(3);
  });

  it('answers only the orders it was asked about, whatever the read returned', () => {
    const authors = currentStatusAuthors(
      [entry({ orderId: 'stranger' })],
      new Map([['a', 'on_hold']]),
    );
    expect([...authors.keys()]).toEqual(['a']);
  });
});
