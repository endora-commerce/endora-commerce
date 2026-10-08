import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { AuthSessionReadService } from './session-port.js';

/**
 * When an administrator was last seen
 * (`specs/143-crm-sales-opportunities/contracts/foreign-module-changes.md` §CAL-B2).
 *
 * The twin of the question `customers`' online view asks of customer accounts,
 * with the same semantics: the newest stamp per person, only stamps at or after
 * `since`, and nobody in the answer who has none.
 *
 * The EntityManager is a stand-in that applies the filter it is handed to a
 * handful of rows, so what is held here is the filter this service writes —
 * its three conditions — and the folding of several sessions into one answer.
 * The same cases run against the real table in
 * `backend/test/integration/auth/admin-presence.test.ts`.
 */

interface Row {
  adminUserId?: string | null;
  customerAccountId?: string | null;
  impersonatorAdminUserId?: string | null;
  lastSeenAt?: Date | null;
}

type Condition = null | string | { $in?: string[]; $gte?: Date };

function matches(row: Row, where: Record<string, Condition>): boolean {
  return Object.entries(where).every(([field, condition]) => {
    const value = (row as Record<string, unknown>)[field] ?? null;
    if (condition === null) return value === null;
    if (typeof condition === 'string') return value === condition;
    if (condition.$in) return typeof value === 'string' && condition.$in.includes(value);
    if (condition.$gte) return value instanceof Date && value.getTime() >= condition.$gte.getTime();
    throw new Error(`a condition this stand-in does not know: ${JSON.stringify(condition)}`);
  });
}

function reading(rows: Row[]): { service: AuthSessionReadService; reads: () => number } {
  let reads = 0;
  const em = {
    find: async (_entity: unknown, where: Record<string, Condition>) => {
      reads += 1;
      return rows.filter((row) => matches(row, where));
    },
  } as unknown as EntityManager;
  return { service: new AuthSessionReadService(() => em), reads: () => reads };
}

describe('AuthSessionReadService.lastSeenByAdminUser', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 8, 12, minute));
  const A = 'a0000000-0000-4000-8000-000000000001';
  const B = 'b0000000-0000-4000-8000-000000000002';
  const C = 'c0000000-0000-4000-8000-000000000003';
  const CUSTOMER = 'd0000000-0000-4000-8000-000000000004';

  it('answers the newest stamp per administrator, across their sessions', async () => {
    const { service } = reading([
      { adminUserId: A, lastSeenAt: at(10) },
      { adminUserId: A, lastSeenAt: at(40) },
      { adminUserId: A, lastSeenAt: at(25) },
      { adminUserId: B, lastSeenAt: at(30) },
    ]);
    const seen = await service.lastSeenByAdminUser([A, B], at(0));
    expect(seen.sort((x, y) => x.adminUserId.localeCompare(y.adminUserId))).toEqual([
      { adminUserId: A, lastSeenAt: at(40) },
      { adminUserId: B, lastSeenAt: at(30) },
    ]);
  });

  it('leaves out an administrator not seen since `since` — absent, not present with a null', async () => {
    const { service } = reading([
      { adminUserId: A, lastSeenAt: at(10) },
      { adminUserId: B, lastSeenAt: at(30) },
      { adminUserId: C, lastSeenAt: null },
    ]);
    // `since` is inclusive: a stamp at that very instant counts.
    expect(await service.lastSeenByAdminUser([A, B, C], at(30))).toEqual([{ adminUserId: B, lastSeenAt: at(30) }]);
    expect(await service.lastSeenByAdminUser([A, B, C], at(31))).toEqual([]);
  });

  it('answers only for the administrators asked about', async () => {
    const { service } = reading([
      { adminUserId: A, lastSeenAt: at(10) },
      { adminUserId: B, lastSeenAt: at(30) },
    ]);
    expect(await service.lastSeenByAdminUser([A], at(0))).toEqual([{ adminUserId: A, lastSeenAt: at(10) }]);
  });

  it('does not take an impersonation for the administrator’s own presence', async () => {
    const { service } = reading([
      // The administrator browsing the storefront as a customer.
      { customerAccountId: CUSTOMER, impersonatorAdminUserId: A, lastSeenAt: at(50) },
      // A row carrying both ids is a customer's session all the same.
      { adminUserId: A, customerAccountId: CUSTOMER, lastSeenAt: at(55) },
      { adminUserId: A, lastSeenAt: at(5) },
    ]);
    expect(await service.lastSeenByAdminUser([A], at(0))).toEqual([{ adminUserId: A, lastSeenAt: at(5) }]);
    expect(await service.lastSeenByAdminUser([A], at(20))).toEqual([]);
  });

  it('asks nothing of the database for nobody', async () => {
    const { service, reads } = reading([{ adminUserId: A, lastSeenAt: at(10) }]);
    expect(await service.lastSeenByAdminUser([], at(0))).toEqual([]);
    expect(reads()).toBe(0);
  });
});
