import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Migration20260818T081252CreditLimitsCreditLimitReservationOrderFk } from '../../../src/modules/credit_limits/migrations/20260818T081252_credit_limits_credit_limit_reservation_order_fk.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { CreditLimit } from '../../../src/modules/credit_limits/entities/credit-limit.entity.js';

/**
 * `credit_limit_reservations_order_fk` (D-94.1, site 4 — the one the D-94
 * sweep found rather than the brief).
 *
 * `reserve({ tx })` runs on the placement `EntityManager`, so the
 * `PESSIMISTIC_WRITE` on the organization's credit row is held until the order
 * commits; a second transaction would leave credit consumed for an order that
 * rolled back. The constraint is what makes that seam declarable under D-78
 * point 2 — the same `create table` constrained `credit_limit_id` and left this
 * column bare.
 */
describe('credit_limit_reservations.order_id foreign key (D-94.1)', () => {
  let h: BackendServerHandle;
  /**
   * A real granted limit, because `credit_limit_reservations` already
   * constrains `credit_limit_id`: a `randomUUID()` there would raise `23503`
   * for the *other* constraint and this file would be green without the one it
   * is about.
   */
  let creditLimitId: string;
  /** The organization the fixture limit belongs to; also the reserving one here. */
  let organizationId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const org = em.create(Organization, {
      name: 'D94 credit FK org',
      taxId: 'PL0940000001',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(org);
    organizationId = org.id;
    const limit = em.create(CreditLimit, {
      organizationId: org.id,
      grantedAmount: '1000.00',
      currency: 'PLN',
    });
    await em.persistAndFlush(limit);
    creditLimitId = limit.id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const insertReservation = (em: EntityManager, orderId: string): Promise<unknown> =>
    em.getConnection().execute(
      `insert into "credit_limit_reservations"
         ("id", "credit_limit_id", "order_id", "reserving_organization_id", "amount", "currency",
          "status", "created_at", "updated_at")
       values (?, ?, ?, ?, '10.00', 'PLN', 'active', now(), now())`,
      [randomUUID(), creditLimitId, orderId, organizationId],
    );

  it('declares credit_limit_reservations_order_fk into orders with on delete restrict', async () => {
    const rows = (await h.em().getConnection().execute(
      `select con."conname", con."confdeltype", ref."relname" as "referenced"
         from "pg_constraint" con
         join "pg_class" ref on ref."oid" = con."confrelid"
        where con."conrelid" = '"credit_limit_reservations"'::regclass
          and con."contype" = 'f'`,
    )) as Array<{ conname: string; confdeltype: string; referenced: string }>;

    expect(rows).toContainEqual(
      expect.objectContaining({
        conname: 'credit_limit_reservations_order_fk',
        confdeltype: 'r',
        referenced: 'orders',
      }),
    );
  });

  it('refuses a reservation row pointing at no order', async () => {
    // The constraint name is asserted, not just the SQLSTATE: this table
    // already had a foreign key on `credit_limit_id`, so `23503` alone would
    // not say which one refused.
    await expect(insertReservation(h.em(), randomUUID())).rejects.toMatchObject({
      code: '23503',
      constraint: 'credit_limit_reservations_order_fk',
    });
  });

  /**
   * The report is money-shaped on purpose: an orphan with `status = 'active'`
   * has been silently consuming an organization's available credit, and
   * `releaseByOrder` — which looks the reservation up by order id — cannot
   * reach it. The migration says how much is locked so an operator can tell the
   * organization's owner what changed (D-94.2, remedy 3).
   *
   * Rolled back whatever happens, so the constraint above survives this case.
   */
  it('the migration reports orphaned order_ids and the amount they lock', async () => {
    const em = h.em();
    const conn = em.getConnection();
    const migration = new Migration20260818T081252CreditLimitsCreditLimitReservationOrderFk(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    const queries = migration.getQueries() as string[];

    await expect(
      conn.transactional(async (trx) => {
        await conn.execute(
          `alter table "credit_limit_reservations" drop constraint "credit_limit_reservations_order_fk"`,
          [],
          'run',
          trx,
        );
        await conn.execute(
          `insert into "credit_limit_reservations"
             ("id", "credit_limit_id", "order_id", "reserving_organization_id", "amount",
              "currency", "status", "created_at", "updated_at")
           values (?, ?, ?, ?, '42.00', 'PLN', 'active', now(), now())`,
          [randomUUID(), creditLimitId, randomUUID(), organizationId],
          'run',
          trx,
        );
        for (const sql of queries) {
          await conn.execute(sql, [], 'run', trx);
        }
      }),
    ).rejects.toThrow(/orphaned credit_limit_reservations\.order_id[\s\S]*42\.00 in still-active/i);
  });
});
