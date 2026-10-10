import type { EntityManager } from '@mikro-orm/postgresql';
import { DemoResetRefusedError } from '@endora-commerce/platform/demo';
import { describe, expect, it } from 'vitest';

import {
  createDemoComposition,
  DEMO_COMPOSITION_STEP_NAMES,
  DEMO_FOUNDATION_STEP_NAMES,
} from './composition.js';
import {
  bind,
  countOf,
  DEMO_FINANCIAL_RECORDS,
  DEMO_USAGE_SECTION_NAMES,
  DEMO_USAGE_SECTIONS,
  DEMO_USAGE_WITHDRAWAL_NAME,
  EVERY_ROW,
  requiredTablesOf,
  settleArms,
  tablesOf,
  withdrawDemoUsage,
} from './demo-usage.js';

/**
 * What this package promises an instance with a **smaller** module set — the
 * property that let it leave the host at all (2026-10-01).
 *
 * The rows the steps write are `backend/test/integration/demo/`'s subject:
 * `demo-shop.test.ts` holds every table the seed moves to a recorded delta, and
 * `demo-instance-shape.test.ts` runs this package the way a CLI-scaffolded
 * instance does. Neither can say the two things below, because a database with
 * every module present never reaches them: that a step whose modules are absent
 * is a reported skip naming them (§5.4), and that reaching that answer imports
 * no module package at all — an instance that did not install `megamenu`
 * cannot import `@endora-commerce/mod-megamenu`, and a static import of it would
 * fail the whole composition before its first guard was asked.
 *
 * An `EntityManager` that throws on any use is the proof of the second: a step
 * that ran, or loaded a module's entities to decide not to, would reach it.
 */
const untouchable = new Proxy({} as EntityManager, {
  get(_target, property) {
    throw new Error(`the composition used the EntityManager (${String(property)}) with no module present`);
  },
});

describe('a composition over an instance with none of its modules', () => {
  const composition = createDemoComposition({ em: untouchable, isPresent: () => false });

  it('skips every wiring step, naming the modules each one needed', async () => {
    const result = await composition.apply();
    expect(result.applied).toEqual([]);
    expect(result.skipped.map((entry) => entry.step)).toEqual([...DEMO_COMPOSITION_STEP_NAMES]);
    const roles = result.skipped.find(
      (entry) => entry.step === 'demo administrators take their roles',
    );
    expect(roles?.reason).toContain('admin_users');
    expect(roles?.reason).toContain('admin_roles');
  });

  it('advertises no sign-in for an account it did not create', async () => {
    // The buyer's credentials are declared by the step that creates it, and a
    // skipped step must not print a password nobody can sign in with.
    expect((await composition.apply()).credentials).toBeUndefined();
  });

  it('withdraws nothing either, in the reverse order', async () => {
    const result = await composition.withdraw();
    expect(result.applied).toEqual([]);
    // What using the demo left behind is withdrawn before any step is unwound
    // (issue #143), so its sections are reported first.
    expect(result.skipped.map((entry) => entry.step)).toEqual([
      DEMO_USAGE_WITHDRAWAL_NAME,
      ...[...DEMO_COMPOSITION_STEP_NAMES].reverse(),
    ]);
  });
});

describe('what using the demo left behind (issue #143)', () => {
  const identity = { organizationTaxId: 'PL0000000001', buyerEmail: 'buyer@example.test' };

  /**
   * An EntityManager over a database that holds `tables`, recording what it is
   * sent. `holds` is how many rows each delete or update reports it affected.
   */
  function fakeDatabase(tables: readonly string[], holds = 0, branches = 0, financial = 0) {
    const executed: string[] = [];
    let transactions = 0;
    let rolledBack = 0;
    const tx = {
      execute: async (statement: string, params: readonly string[], method?: string) => {
        if (statement.includes('information_schema.tables')) {
          return params.filter((table) => tables.includes(table)).map((table) => ({
            table_name: table,
          }));
        }
        // One bound value per placeholder, and nothing left unbound.
        expect(params.length).toBe(statement.split('?').length - 1);
        expect(statement).not.toContain(':buyer_email');
        // No optional arm reaches the database unsettled.
        expect(statement).not.toMatch(/[{}]/);
        executed.push(statement);
        if (statement.includes('parent_id')) return [{ n: String(branches) }];
        if (statement.includes('count(*)::text as n')) return [{ n: String(financial) }];
        expect(method).toBeUndefined();
        return { affectedRows: holds };
      },
    };
    const em = {
      transactional: async (work: (inner: typeof tx) => Promise<void>) => {
        transactions += 1;
        try {
          await work(tx);
        } catch (error) {
          rolledBack += 1;
          throw error;
        }
      },
    } as unknown as EntityManager;
    return { em, executed, counts: () => ({ transactions, rolledBack }) };
  }

  const everyTable = [
    ...new Set(DEMO_USAGE_SECTIONS.flatMap((section) => tablesOf(section.statements))),
  ];

  it('is found through the demo organisation in every statement, and by nothing wider', () => {
    // The whole safety of this withdrawal is its predicate: a statement that
    // did not go through the demo organisation's tax id would be a delete over
    // somebody else's rows.
    for (const section of DEMO_USAGE_SECTIONS) {
      for (const statement of section.statements) {
        expect(statement, section.name).toContain('from organizations where tax_id = ?');
        expect(statement, section.name).toMatch(/\bwhere\b/);
        // "No organisation" is never "the demo organisation": a guest's cart
        // and an instance-wide webhook have none.
        expect(statement, section.name).not.toMatch(/(organization|account)_id is null/);
      }
    }
  });

  it('reads the tables a section touches off its own statements', () => {
    const stock = DEMO_USAGE_SECTIONS.find((section) => section.name.startsWith('stock held'))!;
    expect(tablesOf(stock.statements)).toEqual([
      'order_items',
      'orders',
      'organizations',
      'stock_allocations',
      'stock_levels',
    ]);
    // Nothing that is not a table: an alias or a sub-select would make a
    // section wait for a table that can never exist.
    for (const table of everyTable) expect(table).toMatch(/^[a-z]+(_[a-z]+)*$/);
    expect(everyTable).not.toContain('held');
    expect(everyTable).not.toContain('select');
  });

  it('drops an optional arm whose table is not there, and keeps the statement', () => {
    const statement = 'delete from carts where a in (select id from organizations) or {b in (select id from customer_accounts)}';
    expect(settleArms(statement, new Set(['carts', 'organizations', 'customer_accounts']))).toBe(
      'delete from carts where a in (select id from organizations) or b in (select id from customer_accounts)',
    );
    expect(settleArms(statement, new Set(['carts', 'organizations']))).toBe(
      'delete from carts where a in (select id from organizations) or false',
    );
    // What it cannot run without is what stands outside every arm.
    expect(requiredTablesOf([statement])).toEqual(['carts', 'organizations']);
    // An arm inside a dropped arm goes with it.
    expect(settleArms('x or {y in (select 1 from orders where {z in (select 1 from carts)})}', new Set(['carts']))).toBe(
      'x or false',
    );
  });

  it('runs a section whose only missing table is one it reaches through an optional arm', async () => {
    // `orders` is how an invoice with no organisation of its own is found. An
    // instance without that table still has invoices to withdraw; the section
    // used to be skipped whole.
    const database = fakeDatabase(everyTable.filter((table) => table !== 'orders'));
    const result = await withdrawDemoUsage({
      em: database.em,
      ...identity,
      deleteFinancialRecords: true,
    });
    expect(result.applied).toContain('invoices issued to the demo organisation');
    expect(result.applied).toContain('carts of the demo organisation');
    // Sections that are *about* orders cannot run, and say why.
    expect(result.skipped.map((skip) => skip.step)).toContain(
      'orders placed by the demo organisation',
    );
    const invoices = database.executed.find((statement) => statement.includes('delete from invoices'))!;
    expect(invoices).toContain('or false');
    expect(invoices).not.toContain('orders');
  });

  it('binds the tax id and the buyer, each where it is written', () => {
    expect(bind('a = ? and b <> :buyer_email and c = ?', identity)).toEqual([
      'a = ? and b <> ? and c = ?',
      ['PL0000000001', 'buyer@example.test', 'PL0000000001'],
    ]);
  });

  it('runs every section whose tables exist, whether or not its module is switched on', async () => {
    // Nothing here is asked about activation at all: a row of a switched-off
    // module still names the demo organisation.
    const database = fakeDatabase(everyTable);
    const result = await withdrawDemoUsage({ em: database.em, ...identity });
    expect(result.applied).toEqual([...DEMO_USAGE_SECTION_NAMES]);
    expect(result.skipped).toEqual([]);
    expect(database.counts()).toEqual({ transactions: 1, rolledBack: 0 });
  });

  it('skips a section whose module was never installed, naming the missing table', async () => {
    const database = fakeDatabase(everyTable.filter((table) => !table.startsWith('crm_')));
    const result = await withdrawDemoUsage({ em: database.em, ...identity });
    expect(result.skipped).toEqual([
      {
        step: 'Sales Opportunities opened for the demo organisation',
        reason: expect.stringContaining("'crm_opportunities'") as string,
      },
    ]);
    expect(database.executed.join('\n')).not.toContain('crm_opportunities');
  });

  it('stops on a sub-organisation before any section has run', async () => {
    const database = fakeDatabase(everyTable, 0, 2);
    await expect(withdrawDemoUsage({ em: database.em, ...identity })).rejects.toThrow(
      /2 sub-organisation/,
    );
    // The count, and nothing after it.
    expect(database.executed).toHaveLength(1);
    expect(database.executed[0]).toContain('parent_id');
    expect(database.counts().rolledBack).toBe(1);
  });

  it('deletes the accounts that joined last, and leaves the seeded buyer to its own step', () => {
    const last = DEMO_USAGE_SECTIONS.at(-1)!;
    expect(last.name).toBe('accounts that joined the demo organisation');
    expect(last.statements.join('\n')).toContain('email <> :buyer_email');
  });

  describe('financial records', () => {
    const held = (rows: number) => fakeDatabase(everyTable, 0, 0, rows);

    it('are counted over tables the sections delete from, and no others', () => {
      // The list and the sections cannot part: a kind counted here that no
      // section deleted would be refused over and then left behind by the flag.
      const deleted = new Set(
        DEMO_USAGE_SECTIONS.flatMap((section) =>
          section.statements
            .filter((statement) => statement.trimStart().startsWith('delete from'))
            .map((statement) => /delete from ([a-z_]+)/.exec(statement)![1]!),
        ),
      );
      const counted = DEMO_FINANCIAL_RECORDS.flatMap((kind) =>
        kind.tables.map((entry) => entry.table),
      );
      expect(counted.sort()).toEqual([
        'credit_limit_return_topups',
        'invoice_ledger_client_maps',
        'invoice_ledger_deliveries',
        'invoice_ledger_document_maps',
        'invoices',
        'payments',
        'refunds',
      ]);
      for (const table of counted) expect(deleted, table).toContain(table);
    });

    it('are every row of those tables today, and are narrowed in one column of one table', () => {
      // The classification is `financialWhen`, per table. Narrowing it — to
      // settled payments, to invoices that are accounting documents — is a
      // change to that entry and to this test, and to nothing else.
      for (const kind of DEMO_FINANCIAL_RECORDS) {
        for (const entry of kind.tables) expect(entry.financialWhen, entry.table).toBe(EVERY_ROW);
      }
      expect(
        countOf({
          table: 'payments',
          ofTheDemo: 'order_id in (1)',
          financialWhen: "status in ('paid', 'refunded')",
        }),
      ).toBe(
        "select count(*)::text as n from payments where (order_id in (1)) and (status in ('paid', 'refunded'))",
      );
    });

    it('refuse the reset before a single row is deleted, naming each kind, its count and the flag', async () => {
      const database = held(2);
      const refusal = await withdrawDemoUsage({ em: database.em, ...identity }).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(DemoResetRefusedError);
      const message = (refusal as Error).message;
      expect(message).toContain('  invoices: 2\n');
      // Three tables of one kind, counted together.
      expect(message).toContain('  accounting-system records: 6\n');
      expect(message).toContain('  payments: 2\n');
      expect(message).toContain('Nothing has been changed');
      expect(message).toContain('--force-delete-financial-records');
      // Counts, never ids.
      expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(database.executed.some((statement) => /^\s*(delete|update)\b/.test(statement))).toBe(
        false,
      );
      expect(database.counts().rolledBack).toBe(1);
    });

    it('are deleted with the rest when the reset is told to, without being counted', async () => {
      const database = held(2);
      const result = await withdrawDemoUsage({
        em: database.em,
        ...identity,
        deleteFinancialRecords: true,
      });
      expect(result.applied).toEqual([...DEMO_USAGE_SECTION_NAMES]);
      expect(database.executed.join('\n')).toContain('delete from invoices');
      expect(database.executed.some((statement) => statement.includes('count(*)::text as n from invoices'))).toBe(false);
    });

    it('do not stop a demo organisation that holds none', async () => {
      const result = await withdrawDemoUsage({ em: held(0).em, ...identity });
      expect(result.applied).toEqual([...DEMO_USAGE_SECTION_NAMES]);
    });

    it('are not asked about where the module that owns them was never installed', async () => {
      const database = fakeDatabase(
        everyTable.filter((table) => !table.startsWith('invoice')),
        0,
        0,
        1,
      );
      const refusal = (await withdrawDemoUsage({ em: database.em, ...identity }).catch(
        (error: unknown) => error,
      )) as Error;
      expect(refusal.message).not.toContain('invoices:');
      expect(refusal.message).toContain('payments: 1');
    });

    it('reach the withdrawal from the composition input, and from nowhere else', async () => {
      // No environment variable and no default: the parameter is the only way in.
      const source = await import('node:fs').then((fs) =>
        fs.readFileSync(new URL('./demo-usage.ts', import.meta.url), 'utf8') +
          fs.readFileSync(new URL('./composition.ts', import.meta.url), 'utf8'),
      );
      expect(source).not.toMatch(/process\.env/);
    });
  });

  it('is not put to the database where `organizations` is not present', async () => {
    // Only the two admin modules: there is no demo organisation to find rows
    // through, so the EntityManager — which throws on any use — is not reached.
    const composition = createDemoComposition({
      em: untouchable,
      isPresent: (moduleId) => moduleId === 'admin_users' || moduleId === 'admin_roles',
    });
    const result = await composition.withdraw();
    expect(result.skipped[0]).toEqual({
      step: DEMO_USAGE_WITHDRAWAL_NAME,
      reason: expect.stringContaining('organizations') as string,
    });
  });
});

describe('the step list is the demo shop the platform repository has always seeded', () => {
  it('keeps the role assignment and the channel bridges among its steps', () => {
    // The two whose absence was the reported defect: administrators with no
    // role, and products no channel sold.
    expect(DEMO_COMPOSITION_STEP_NAMES).toContain('demo administrators take their roles');
    expect(DEMO_COMPOSITION_STEP_NAMES).toContain('product↔category and channel↔product bridges');
  });

  it('pairs the administrators with their roles before any other step', () => {
    // An administrator without a role is refused everywhere, and every later
    // step can fail; the pairing depends on none of them.
    expect(DEMO_COMPOSITION_STEP_NAMES[0]).toBe('demo administrators take their roles');
  });

  it('keeps the sales channels as the one foundation step (§5.5a)', () => {
    expect(DEMO_FOUNDATION_STEP_NAMES).toEqual(["the demo's two sales channels"]);
  });
});

describe('withdrawing the composition never leaves an administrator without a role', () => {
  it('writes nothing for the role step: the accounts are deleted with their role on them', async () => {
    // Only the two admin modules are present, so the role step is the one step
    // that runs — over an EntityManager that throws on any use. A withdrawal
    // that unassigned the roles would reach it; the accounts' own module
    // removes them later in the same reset, and a reset that stops in between
    // must not leave them role-less.
    const composition = createDemoComposition({
      em: untouchable,
      isPresent: (moduleId) => moduleId === 'admin_users' || moduleId === 'admin_roles',
    });
    const result = await composition.withdraw();
    expect(result.applied).toEqual(['demo administrators take their roles']);
  });
});
