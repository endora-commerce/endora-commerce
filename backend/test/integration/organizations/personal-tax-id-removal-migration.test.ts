import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261110T135922OrganizationsPersonalTaxIdRemoval } from '@endora-commerce/mod-organizations/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * `specs/177-tax-id-scope/` T003 — migration M1, executed rather than described
 * (FR-001, FR-002, FR-007).
 *
 * The template database has already run M1, so each test first runs its
 * `down()` to stand the table in the pre-feature shape, writes rows in a state
 * only the old code could produce (personal organizations carrying the 32-hex
 * placeholder), then runs `up()` and reads what it left. The statements come
 * from the migration class, and everything runs inside a transaction that is
 * rolled back. A refused insert runs under a savepoint so the transaction
 * survives it.
 */
describe('organizations — M1: personal organizations lose the synthetic tax ID', () => {
  let db: TestDb;
  let em: EntityManager;
  let notices: string[];

  async function run(direction: 'up' | 'down'): Promise<void> {
    const migration = new Migration20261110T135922OrganizationsPersonalTaxIdRemoval(
      em.getDriver(),
      em.config,
    );
    await migration[direction]();
    for (const query of migration.getQueries()) {
      await em.execute(query as string);
    }
  }

  /** The pg client of the test transaction, to hear what a `raise notice` says. */
  async function listenForNotices(): Promise<() => void> {
    const trx = em.getTransactionContext() as {
      client: { acquireConnection(): Promise<NodeJS.EventEmitter> };
    };
    const connection = await trx.client.acquireConnection();
    const listener = (notice: { message?: string }) => notices.push(String(notice.message));
    connection.on('notice', listener);
    return () => connection.off('notice', listener);
  }

  async function insertOrganization(input: {
    taxId: string;
    isPersonal: boolean;
  }): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","created_at","updated_at")
       values (?, ?, ?, 'active', 'vat_exempt', ?, '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::jsonb, ?, now(), now())`,
      [id, `M1 ${id.slice(0, 8)}`, input.taxId, input.isPersonal, `/${id}/`],
    );
    return id;
  }

  async function row(id: string): Promise<{ tax_id: string | null; personal_account_id: string | null }> {
    const rows = (await em.execute(
      'select "tax_id", "personal_account_id" from "organizations" where "id" = ?',
      [id],
    )) as Array<{ tax_id: string | null; personal_account_id: string | null }>;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  /** The tax ID alone — readable whether or not M1's columns exist. */
  async function taxIdOf(id: string): Promise<string | null> {
    const rows = (await em.execute('select "tax_id" from "organizations" where "id" = ?', [id])) as Array<{
      tax_id: string | null;
    }>;
    return rows[0]!.tax_id;
  }

  /** Runs `sql` under a savepoint and answers the constraint that refused it. */
  async function refusal(sql: string, params: unknown[]): Promise<string | undefined> {
    await em.execute('savepoint m1_refusal');
    try {
      await em.execute(sql, params);
    } catch (err) {
      await em.execute('rollback to savepoint m1_refusal');
      return (err as { constraint?: string }).constraint;
    }
    await em.execute('release savepoint m1_refusal');
    return undefined;
  }

  async function digest(table: string): Promise<{ count: number; md5: string | null }> {
    const rows = (await em.execute(
      `select count(*)::int as "count", md5(string_agg(t::text, '|' order by t::text)) as "md5" from "${table}" t`,
    )) as Array<{ count: number; md5: string | null }>;
    return rows[0]!;
  }

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    notices = [];
    await run('down');
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  it('clears every personal tax ID, links each to its account, and keeps company tax IDs', async () => {
    const accountA = randomUUID();
    const accountB = randomUUID();
    const company = await insertOrganization({ taxId: `PL${Date.now()}`.slice(0, 12), isPersonal: false });
    const personalA = await insertOrganization({ taxId: accountA.replace(/-/g, ''), isPersonal: true });
    const personalB = await insertOrganization({ taxId: accountB.replace(/-/g, ''), isPersonal: true });
    const companyTaxId = await taxIdOf(company);

    await run('up');

    expect(await row(personalA)).toEqual({ tax_id: null, personal_account_id: accountA });
    expect(await row(personalB)).toEqual({ tax_id: null, personal_account_id: accountB });
    expect(await row(company)).toEqual({ tax_id: companyTaxId, personal_account_id: null });

    // SC-001 — over the whole table, not only the fixtures.
    const [counts] = (await em.execute(
      `select count(*) filter (where "is_personal" and "tax_id" is not null)::int as "personalWithTaxId",
              count(*) filter (where not "is_personal" and "tax_id" is null)::int as "companyWithout"
         from "organizations"`,
    )) as Array<{ personalWithTaxId: number; companyWithout: number }>;
    expect(counts).toEqual({ personalWithTaxId: 0, companyWithout: 0 });
  });

  it('clears a hand-made personal tax ID too, leaves it unlinked, and says how many', async () => {
    const handMade = await insertOrganization({ taxId: `HAND${randomUUID().slice(0, 8)}`, isPersonal: true });
    const stop = await listenForNotices();
    try {
      await run('up');
    } finally {
      stop();
    }

    expect(await row(handMade)).toEqual({ tax_id: null, personal_account_id: null });
    const notice = notices.find((message) => message.includes('without an account link'));
    expect(notice).toBeDefined();
    const [{ unlinked }] = (await em.execute(
      `select count(*)::int as "unlinked" from "organizations" where "is_personal" and "personal_account_id" is null`,
    )) as [{ unlinked: number }];
    expect(notice).toContain(`${unlinked} personal organization`);
  });

  it('the database refuses a personal row with a tax ID and a company row without one', async () => {
    await run('up');
    const insert = `insert into "organizations"
        ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","created_at","updated_at")
      values (?, 'refused', ?, 'active', 'vat_payer', ?, '{}'::jsonb, ?, now(), now())`;
    const personal = randomUUID();
    const company = randomUUID();
    expect(await refusal(insert, [personal, 'PL9999999999', true, `/${personal}/`])).toBe(
      'organizations_tax_id_presence',
    );
    expect(await refusal(insert, [company, null, false, `/${company}/`])).toBe(
      'organizations_tax_id_presence',
    );
  });

  it('the database refuses an account link on a company row and a second row for one account', async () => {
    await run('up');
    const account = randomUUID();
    const personal = await insertPersonalLinked(account);
    expect(personal).toBeTruthy();

    const company = randomUUID();
    expect(
      await refusal(
        `insert into "organizations"
           ("id","name","tax_id","status","vat_status","is_personal","personal_account_id","registered_address","path","created_at","updated_at")
         values (?, 'linked company', ?, 'active', 'vat_payer', false, ?, '{}'::jsonb, ?, now(), now())`,
        [company, `PL${company.slice(0, 8)}`, randomUUID(), `/${company}/`],
      ),
    ).toBe('organizations_personal_account_link');

    const second = randomUUID();
    expect(
      await refusal(
        `insert into "organizations"
           ("id","name","tax_id","status","vat_status","is_personal","personal_account_id","registered_address","path","created_at","updated_at")
         values (?, 'second personal', null, 'active', 'vat_exempt', true, ?, '{}'::jsonb, ?, now(), now())`,
        [second, account, `/${second}/`],
      ),
    ).toBe('organizations_personal_account_id_unique');
  });

  it('organizations_tax_id_unique still refuses a duplicate company tax ID in the global scope', async () => {
    await run('up');
    const [{ scope }] = (await em.execute(
      'select "scope" from "organization_tax_id_policy"',
    )) as [{ scope: string }];
    if (scope !== 'global') return; // per-tree-root: the exclusion constraint's, WP-3's matrix
    const taxId = `PL${randomUUID().slice(0, 10)}`;
    await insertOrganization({ taxId, isPersonal: false });
    const id = randomUUID();
    expect(
      await refusal(
        `insert into "organizations"
           ("id","name","tax_id","status","vat_status","registered_address","path","created_at","updated_at")
         values (?, 'duplicate', ?, 'active', 'vat_payer', '{}'::jsonb, ?, now(), now())`,
        [id, taxId, `/${id}/`],
      ),
    ).toBe('organizations_tax_id_unique');
  });

  it('rewrites no order and no audit entry (FR-007)', async () => {
    const account = randomUUID();
    const placeholder = account.replace(/-/g, '');
    const personal = await insertOrganization({ taxId: placeholder, isPersonal: true });
    await em.execute(
      `insert into "audit_log_entries" ("id","acted_at","action","object_type","object_id","state_after")
       values (?, now(), 'organization.create', 'organization', ?, ?::jsonb)`,
      [randomUUID(), personal, JSON.stringify({ taxId: placeholder })],
    );
    const before = { orders: await digest('orders'), audit: await digest('audit_log_entries') };

    await run('up');

    expect({ orders: await digest('orders'), audit: await digest('audit_log_entries') }).toEqual(before);
  });

  it('down() restores the placeholder from the link, or from the id of an unlinked row', async () => {
    const account = randomUUID();
    const linked = await insertOrganization({ taxId: account.replace(/-/g, ''), isPersonal: true });
    const handMade = await insertOrganization({ taxId: `HAND${randomUUID().slice(0, 8)}`, isPersonal: true });
    await run('up');

    await run('down');

    expect(await taxIdOf(linked)).toBe(account.replace(/-/g, ''));
    expect(await taxIdOf(handMade)).toBe(handMade.replace(/-/g, ''));
    const [{ nullable }] = (await em.execute(
      `select is_nullable as "nullable" from information_schema.columns
        where table_name = 'organizations' and column_name = 'tax_id'`,
    )) as [{ nullable: string }];
    expect(nullable).toBe('NO');
  });

  it('is repeatable: a second up() changes nothing', async () => {
    const account = randomUUID();
    const personal = await insertOrganization({ taxId: account.replace(/-/g, ''), isPersonal: true });
    await run('up');
    const after = await row(personal);
    await run('up');
    expect(await row(personal)).toEqual(after);
  });

  /**
   * T005a — D-290 / OD-9. `customer_accounts`' 0825 migration INSERTs personal
   * organizations with the placeholder and links accounts by it; run after M1
   * it would fail M1's presence check. Topological order puts M1 first on a
   * database that has not applied it, so M1 refuses a populated one.
   */
  describe('upgrade precondition: minimum upgrade-from version 0.100.0 (D-290 / OD-9)', () => {
    const OLD_MIGRATION = 'Migration20260825T141659CustomerAccountsOrganizationRequired';
    const M1 = 'Migration20261110T135922OrganizationsPersonalTaxIdRemoval';

    async function columnState(): Promise<{ taxIdNullable: string; personalAccountColumn: number }> {
      const [state] = (await em.execute(
        `select (select is_nullable from information_schema.columns
                  where table_name = 'organizations' and column_name = 'tax_id') as "taxIdNullable",
                (select count(*)::int from information_schema.columns
                  where table_name = 'organizations' and column_name = 'personal_account_id') as "personalAccountColumn"`,
      )) as Array<{ taxIdNullable: string; personalAccountColumn: number }>;
      return state!;
    }

    async function upError(): Promise<string | undefined> {
      await em.execute('savepoint m1_precondition');
      try {
        await run('up');
      } catch (err) {
        await em.execute('rollback to savepoint m1_precondition');
        return (err as Error).message;
      }
      await em.execute('release savepoint m1_precondition');
      return undefined;
    }

    it('refuses, and changes nothing, on a populated database that never applied the customer_accounts migration', async () => {
      await insertOrganization({ taxId: `PL${randomUUID().slice(0, 10)}`, isPersonal: false });
      await em.execute('delete from "mikro_orm_migrations" where "name" = ?', [OLD_MIGRATION]);

      const message = await upError();

      expect(message).toBeDefined();
      expect(message).toContain(OLD_MIGRATION);
      expect(message).toContain(M1);
      expect(message).toContain('0.100.0');
      expect(message).toMatch(/0\.100\.x.0\.110\.x/);
      expect(await columnState()).toEqual({ taxIdNullable: 'NO', personalAccountColumn: 0 });
    });

    it('applies on a populated database that has applied the customer_accounts migration', async () => {
      const [{ applied }] = (await em.execute(
        'select count(*)::int as "applied" from "mikro_orm_migrations" where "name" = ?',
        [OLD_MIGRATION],
      )) as [{ applied: number }];
      expect(applied).toBe(1);
      await insertOrganization({ taxId: `PL${randomUUID().slice(0, 10)}`, isPersonal: false });

      expect(await upError()).toBeUndefined();
      expect(await columnState()).toEqual({ taxIdNullable: 'YES', personalAccountColumn: 1 });
    });

    it('applies on an empty organizations table without the ledger row (a fresh database)', async () => {
      await em.execute('delete from "mikro_orm_migrations" where "name" = ?', [OLD_MIGRATION]);
      const [{ count }] = (await em.execute(
        'select count(*)::int as "count" from "organizations"',
      )) as [{ count: number }];
      expect(count).toBe(0);

      expect(await upError()).toBeUndefined();
      expect(await columnState()).toEqual({ taxIdNullable: 'YES', personalAccountColumn: 1 });
    });

    it('the fixture database ran the whole chain from empty: M1, then the customer_accounts migration', async () => {
      const rows = (await em.execute(
        'select "name" from "mikro_orm_migrations" where "name" in (?, ?) order by "id"',
        [OLD_MIGRATION, M1],
      )) as Array<{ name: string }>;
      expect(rows.map((r) => r.name)).toEqual([M1, OLD_MIGRATION]);
    });
  });

  async function insertPersonalLinked(account: string): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","personal_account_id","registered_address","path","created_at","updated_at")
       values (?, 'linked personal', null, 'active', 'vat_exempt', true, ?, '{}'::jsonb, ?, now(), now())`,
      [id, account, `/${id}/`],
    );
    return id;
  }
});
