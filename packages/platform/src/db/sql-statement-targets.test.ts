import { describe, expect, it } from 'vitest';
import { sqlWriteTargets, type SqlWriteTarget } from './sql-statement-targets.js';

/**
 * `specs/178-extensible-columns/` FR-070 (tasks.md T060,
 * `contracts/foreign-schema-guard.md` §1) — the write targets of a SQL text,
 * for the runtime foreign-schema guard. Regex over the statement text, no
 * TypeScript: the platform judges installed packages at `migrate` time.
 */

const tables = (sql: string): (string | null)[] => sqlWriteTargets(sql).map((target) => target.table);
const one = (sql: string): SqlWriteTarget => {
  const targets = sqlWriteTargets(sql);
  expect(targets).toHaveLength(1);
  return targets[0]!;
};

describe('sqlWriteTargets — DDL', () => {
  it.each([
    ['alter table "organizations" add column "foo" text', 'organizations', 'alter'],
    ['ALTER TABLE IF EXISTS ONLY public.organizations ADD COLUMN foo text', 'organizations', 'alter'],
    ['create index "orgs_foo_index" on "organizations" ("foo")', 'organizations', 'index'],
    ['create unique index concurrently if not exists orgs_foo on only organizations (foo)', 'organizations', 'index'],
    ['drop table if exists "organizations" cascade', 'organizations', 'drop'],
    ['comment on table "organizations" is \'x\'', 'organizations', 'comment'],
    ['comment on column "organizations"."name" is \'x\'', 'organizations', 'comment'],
    ['create trigger t_org before update on "organizations" for each row execute function f()', 'organizations', 'trigger'],
    ['drop trigger if exists t_org on organizations', 'organizations', 'trigger'],
    ['create or replace rule r as on insert to "organizations" do instead nothing', 'organizations', 'rule'],
  ])('%s', (sql, table, verb) => {
    expect(one(sql)).toMatchObject({ table, verb });
  });

  it('reads every table of a multi-table drop', () => {
    expect(tables('drop table if exists "a", public."b", c')).toEqual(['a', 'b', 'c']);
  });

  it('names an index, not a table, for drop index', () => {
    expect(sqlWriteTargets('drop index if exists "orgs_foo_index"')).toEqual([
      expect.objectContaining({ table: null, index: 'orgs_foo_index', verb: 'drop-index' }),
    ]);
  });

  it('is not fooled by create table, which declares rather than writes', () => {
    expect(sqlWriteTargets('create table "acme_rows" ("id" uuid primary key)')).toEqual([
      expect.objectContaining({ table: 'acme_rows', verb: 'create' }),
    ]);
  });
});

describe('sqlWriteTargets — DML', () => {
  it.each([
    ['insert into "organizations" ("id") values ($1)', 'organizations', 'insert'],
    ['INSERT INTO public.organizations SELECT * FROM x', 'organizations', 'insert'],
    ['delete from only "organizations" where id = $1', 'organizations', 'delete'],
    ['truncate table "organizations" restart identity', 'organizations', 'truncate'],
    ['merge into organizations o using x on o.id = x.id when matched then do nothing', 'organizations', 'merge'],
  ])('%s', (sql, table, verb) => {
    expect(one(sql)).toMatchObject({ table, verb });
  });

  it('reads the set columns of an update, quoted or not', () => {
    expect(one(`update "organizations" set "x_acme_erp_credit_tier" = 1, x_acme_erp_note = 'a,b' where "tax_id" like 'PL%'`))
      .toMatchObject({ table: 'organizations', verb: 'update', setColumns: ['x_acme_erp_credit_tier', 'x_acme_erp_note'] });
  });

  it('reads an aliased update and stops the set list at from / where / returning', () => {
    expect(one('update only "organizations" as o set name = upper(o.name) from x where o.id = x.id returning o.id'))
      .toMatchObject({ table: 'organizations', setColumns: ['name'] });
  });

  it('answers null set columns for the row form it cannot attribute', () => {
    expect(one('update organizations set (a, b) = (select 1, 2)').setColumns).toBeNull();
  });

  it('does not report reads', () => {
    expect(sqlWriteTargets('select * from "organizations" join "orders" on true')).toEqual([]);
  });
});

describe('sqlWriteTargets — shapes', () => {
  it('scans inside do $$ … $$ bodies', () => {
    const sql = `do $$ begin
      if not exists (select 1 from information_schema.columns where table_name = 'organizations') then
        alter table "organizations" add column "foo" text;
      end if;
      update "orders" set "foo" = 1;
    end $$;`;
    expect(tables(sql)).toEqual(['organizations', 'orders']);
  });

  it('reads several statements of one text, in order', () => {
    expect(tables('alter table a add column x int; create index i on b (x); insert into c values (1);')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('ignores line and block comments', () => {
    expect(tables('-- alter table organizations add column x int\n/* drop table orders */ select 1')).toEqual([]);
  });

  it('reads what a knex schema builder renders', () => {
    // The output of `knex.schema.alterTable('organizations', t => t.text('foo')).toQuery()`.
    expect(tables('alter table "organizations" add column "foo" text')).toEqual(['organizations']);
  });

  it('lower-cases and strips the schema qualifier', () => {
    expect(tables('ALTER TABLE "Public"."Organizations" ADD COLUMN x int')).toEqual(['organizations']);
  });

  it('carries the statement head for the message', () => {
    expect(one('alter table "organizations"\n   add column "foo" text').statement).toBe(
      'alter table "organizations" add column "foo" text',
    );
  });
});

describe('sqlWriteTargets — trigger events are not statements', () => {
  it('reads `after truncate on <t>` as a trigger on t, not a truncate of "on"', () => {
    expect(
      sqlWriteTargets('create trigger "t" after truncate on "organizations" for each statement execute function f()'),
    ).toEqual([expect.objectContaining({ table: 'organizations', verb: 'trigger' })]);
  });
});

describe('sqlWriteTargets — PL/pgSQL', () => {
  it('reads the dynamic SQL of an execute string', () => {
    expect(
      tables(`do $$ begin execute 'delete from "price_list_product_lines" where "id" = $1' using x; end $$;`),
    ).toEqual(['price_list_product_lines']);
  });

  it('reads the writes of a function body', () => {
    expect(
      tables(`create or replace function f() returns void language plpgsql as $$ begin delete from "orders"; end $$;`),
    ).toEqual(['orders']);
  });
});

/** Review finding 5 — shapes the classifier missed. */
describe('sqlWriteTargets — dynamic SQL and policies', () => {
  it('reports a PL/pgSQL execute of a computed string as unattributable dynamic SQL', () => {
    expect(
      sqlWriteTargets(`do $$ begin execute format('drop table %I', 'organizations'); end $$;`).map((t) => t.verb),
    ).toContain('dynamic');
    expect(sqlWriteTargets(`do $$ declare q text := 'x'; begin execute q; end $$;`).map((t) => t.verb)).toContain(
      'dynamic',
    );
  });

  it('does not read `execute function` in a trigger as dynamic SQL', () => {
    expect(
      sqlWriteTargets('create trigger t after insert on "acme_rows" for each row execute function f()').map((t) => t.verb),
    ).toEqual(['trigger']);
  });

  it('reads create / alter / drop policy … on <t>', () => {
    expect(tables('create policy p on "organizations" using (true)')).toEqual(['organizations']);
    expect(tables('alter policy p on organizations using (false)')).toEqual(['organizations']);
    expect(tables('drop policy if exists p on "organizations"')).toEqual(['organizations']);
  });
});

describe('sqlWriteTargets — a dollar-quoted execute string is a literal', () => {
  it('reads execute $sql$ … $sql$ as the statement it runs, not as dynamic SQL', () => {
    const targets = sqlWriteTargets(`do $$ begin execute $sql$ update "customer_accounts" a set "x" = 1 $sql$; end $$;`);
    expect(targets.map((t) => t.verb)).not.toContain('dynamic');
    expect(targets.map((t) => t.table)).toEqual(['customer_accounts']);
  });
});
