import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Feature 051 US4 — migration 089 backfill.
 *
 * Exercises the exact backfill statement from
 * `089_personal_organizations.ts` against freshly-seeded no-org customer
 * accounts and asserts (T021) exactly one linked personal org per account and
 * (T022) that re-running it is idempotent (no duplicates). Raw SQL is used on
 * both sides so the assertions bypass the org tenant filter, exactly as the
 * migration does.
 */
const BACKFILL_SQL = `
  with created as (
    insert into "organizations" (
      "id", "name", "tax_id", "status", "vat_status", "is_personal",
      "registered_address", "created_at", "updated_at"
    )
    select
      gen_random_uuid(),
      coalesce(nullif(trim(coalesce(ca."first_name", '') || ' ' || coalesce(ca."last_name", '')), ''), split_part(ca."email", '@', 1)),
      replace(ca."id"::text, '-', ''),
      'active',
      'vat_exempt',
      true,
      '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::json,
      now(), now()
    from "customer_accounts" ca
    where ca."organization_id" is null and ca."deleted_at" is null
    returning "id", ("tax_id") as tax_id
  )
  update "customer_accounts" ca
  set "organization_id" = c."id"
  from created c
  where c."tax_id" = replace(ca."id"::text, '-', '');
`;

describe('Migration 089 personal-org backfill (feature 051 US4)', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  const seedNoOrgAccount = async (over: Partial<{ firstName: string; lastName: string; email: string }> = {}) => {
    const id = randomUUID();
    const email = over.email ?? `bf-${id.slice(0, 8)}@ex.test`;
    await em.getConnection().execute(
      `insert into "customer_accounts" ("id","email","password_hash","first_name","last_name","organization_id","created_at","updated_at")
       values (?, ?, ?, ?, ?, null, now(), now())`,
      [id, email, 'x'.repeat(60), over.firstName ?? 'Jan', over.lastName ?? 'Kowalski'],
    );
    return id;
  };

  const orgFor = async (accountId: string) => {
    const rows = (await em.getConnection().execute(
      `select o."id", o."is_personal", o."status", o."name"
       from "customer_accounts" ca join "organizations" o on o."id" = ca."organization_id"
       where ca."id" = ?`,
      [accountId],
    )) as Array<{ id: string; is_personal: boolean; status: string; name: string }>;
    return rows;
  };

  it('creates exactly one linked personal org per no-org account (T021)', async () => {
    const a1 = await seedNoOrgAccount({ firstName: 'Anna', lastName: 'Nowak' });
    const a2 = await seedNoOrgAccount({ firstName: '', lastName: '', email: 'solo-bf@ex.test' });

    await em.getConnection().execute(BACKFILL_SQL);

    const o1 = await orgFor(a1);
    const o2 = await orgFor(a2);
    expect(o1).toHaveLength(1);
    expect(o1[0]!.is_personal).toBe(true);
    expect(o1[0]!.status).toBe('active');
    expect(o1[0]!.name).toBe('Anna Nowak');
    // Falls back to the email local-part when there is no name.
    expect(o2).toHaveLength(1);
    expect(o2[0]!.name).toBe('solo-bf');
    // Distinct tenants — the isolation precondition (US2).
    expect(o1[0]!.id).not.toBe(o2[0]!.id);
  });

  it('is idempotent — re-running creates no duplicate orgs (T022)', async () => {
    const a1 = await seedNoOrgAccount();
    await em.getConnection().execute(BACKFILL_SQL);
    const firstOrgId = (await orgFor(a1))[0]!.id;

    // Second pass: the account now has an org, so it is skipped entirely.
    await em.getConnection().execute(BACKFILL_SQL);

    const after = await orgFor(a1);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(firstOrgId);

    const dupCount = (await em.getConnection().execute(
      `select count(*)::int as n from "organizations" where "tax_id" = replace(?::text, '-', '')`,
      [a1],
    )) as Array<{ n: number }>;
    expect(dupCount[0]!.n).toBe(1);
  });
});
