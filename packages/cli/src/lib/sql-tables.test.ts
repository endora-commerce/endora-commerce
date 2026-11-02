/**
 * The SQL reader's DDL path (issue #108).
 *
 * The migration table-ownership rule reads DML and knex builders through
 * `sqlTableAccesses`, and until this path existed a migration could index,
 * alter, comment on or drop another module's table without a single statement
 * the reader recognised. Every proof below enters with source text, through the
 * same literal-node reader the DML path uses, and asserts `syntax: 'ddl'` — a
 * proof that only checked the table would go green off the statement path
 * (issue #130).
 */
import { describe, expect, it } from 'vitest';

import { declaredIndexes, sqlTableAccesses } from './sql-tables.js';

const MIGRATION = 'modules/a/migrations/20260901T101010_a_widen.ts';

/** The tables the DDL path names in one `addSql` literal. */
function ddlTables(sql: string, indexTables?: ReadonlyMap<string, string>): string[] {
  const source = `this.addSql(\`${sql}\`);`;
  return sqlTableAccesses(source, MIGRATION, { ddl: true, indexTables })
    .filter((access) => access.syntax === 'ddl')
    .map((access) => access.table);
}

describe('sqlTableAccesses — the DDL heads a migration can aim at another table (issue #108)', () => {
  it.each([
    ['create index', 'create index "orders_x_idx" on "orders" ("id");'],
    ['create unique index', 'create unique index "orders_x_uq" on "orders" ("id");'],
    ['create index if not exists', 'create index if not exists "orders_x_idx" on "orders" ("id");'],
    ['create index concurrently', 'create index concurrently orders_x_idx on orders (id);'],
    ['create index without a name', 'create index on "orders" ("id");'],
    ['create index on only', 'create index "orders_x_idx" on only "orders" ("id");'],
    ['create index using', 'create index "orders_x_idx" on "orders" using gin ("tags");'],
    ['alter table', 'alter table "orders" add column "x" text null;'],
    ['alter table if exists', 'alter table if exists "orders" drop column "x";'],
    ['alter table only', 'alter table only orders add constraint x check (true);'],
    ['drop table', 'drop table if exists "orders" cascade;'],
    ['comment on table', 'comment on table "orders" is \'Orders.\';'],
    ['comment on column', 'comment on column "orders"."x" is \'A column.\';'],
    [
      'create trigger',
      'create trigger "orders_touch" before insert or update of "status" on "orders" ' +
        'for each row execute function touch();',
    ],
    [
      'create or replace trigger',
      'create or replace trigger orders_touch after delete on orders for each row execute function t();',
    ],
    ['drop trigger', 'drop trigger if exists "orders_touch" on "orders";'],
  ])('reads %s', (_shape, sql) => {
    expect(ddlTables(sql)).toEqual(['orders']);
  });

  it.each([
    ['quoted schema', 'create index "x" on "public"."orders" ("id");'],
    ['unquoted schema', 'alter table public.orders add column x text;'],
    ['mixed', 'alter table "public".orders add column x text;'],
    ['comment on a qualified column', 'comment on column public.orders.x is \'A column.\';'],
  ])('drops a schema qualifier — %s', (_shape, sql) => {
    expect(ddlTables(sql)).toEqual(['orders']);
  });

  it('reads upper-case DDL', () => {
    expect(ddlTables('CREATE UNIQUE INDEX "X" ON "ORDERS" ("ID");')).toEqual(['orders']);
  });

  it('reads every statement in a multi-statement literal, not only the head', () => {
    // A migration's `addSql` regularly carries a `create table` and its indexes
    // in one literal; the DML path anchors at the literal head, and a DDL path
    // that did the same would read the first statement and miss the rest.
    expect(
      ddlTables(
        'alter table "carts" add column "x" text;\n' +
          'create index "carts_x_idx" on "carts" ("x");\n' +
          'create index "orders_x_idx" on "orders" ("id");',
      ),
    ).toEqual(['carts', 'orders']);
  });

  it('does not report DDL against a table the same source creates', () => {
    // Indexing a table beside its own `create table`, or dropping it in the same
    // migration's `down()`, is part of the declaration — and who may declare a
    // table is the owner map's question, not this path's.
    const source = [
      'this.addSql(`create table "orders" ("id" uuid not null);`);',
      'this.addSql(`create index "orders_x_idx" on "orders" ("id");`);',
      'this.addSql(`alter table "carts" add column "order_id" uuid null;`);',
      'this.addSql(`drop table if exists "orders" cascade;`);',
    ].join('\n');
    expect(sqlTableAccesses(source, MIGRATION, { ddl: true }).map((a) => a.table)).toEqual([
      'carts',
    ]);
  });

  it('reads a statement inside a `do $$` block', () => {
    expect(
      ddlTables(
        'do $$ begin if not exists (select 1) then alter table "orders" add column "x" text; end if; end $$;',
      ),
    ).toEqual(['orders']);
  });

  it('reads every table a `drop table` list names', () => {
    expect(ddlTables('drop table if exists "orders", public."carts" cascade;')).toEqual([
      'orders',
      'carts',
    ]);
  });

  it('names a table once per literal however many statements touch it', () => {
    expect(
      ddlTables('alter table "orders" add column "x" text; create index "i" on "orders" ("x");'),
    ).toEqual(['orders']);
  });

  it('reports DDL as a write', () => {
    const [access] = sqlTableAccesses(
      'this.addSql(`create index "x" on "orders" ("id");`);',
      MIGRATION,
      { ddl: true },
    );
    expect(access).toMatchObject({
      table: 'orders',
      direction: 'write',
      syntax: 'ddl',
      line: 1,
      statement: 'create index "x" on "orders" ("id");',
    });
  });

  it('does not report `create table` — that is a declaration, not an access', () => {
    expect(ddlTables('create table "orders" ("id" uuid not null);')).toEqual([]);
  });

  it('does not read DDL out of a comment', () => {
    const source = [
      '// We used to create index "x" on "orders" ("id") here.',
      '/* alter table "orders" add column "x" text; */',
    ].join('\n');
    expect(sqlTableAccesses(source, MIGRATION, { ddl: true })).toEqual([]);
  });

  it('reads no DDL unless asked — the path is for migration files only', () => {
    expect(
      sqlTableAccesses('this.addSql(`create index "x" on "orders" ("id");`);', MIGRATION),
    ).toEqual([]);
  });
});

describe('sqlTableAccesses — `drop index` names an index, so it resolves through a map', () => {
  const indexTables = new Map([
    ['orders_x_idx', 'orders'],
    ['carts_y_idx', 'carts'],
  ]);

  it.each([
    ['plain', 'drop index "orders_x_idx";'],
    ['if exists', 'drop index if exists "orders_x_idx";'],
    ['concurrently', 'drop index concurrently if exists orders_x_idx;'],
    ['schema-qualified', 'drop index "public"."orders_x_idx";'],
  ])('reads %s', (_shape, sql) => {
    expect(ddlTables(sql, indexTables)).toEqual(['orders']);
  });

  it('reads every index a list names', () => {
    expect(ddlTables('drop index "orders_x_idx", "carts_y_idx";', indexTables)).toEqual([
      'orders',
      'carts',
    ]);
  });

  it('resolves an index the same literal creates', () => {
    expect(
      ddlTables('create index "z_idx" on "orders" ("id"); drop index "z_idx";'),
    ).toEqual(['orders']);
  });

  it('names nothing for an index no map knows', () => {
    expect(ddlTables('drop index "nobody_knows_idx";', indexTables)).toEqual([]);
  });
});

describe('declaredIndexes', () => {
  it('maps every named index a source creates to its table', () => {
    const source = [
      'this.addSql(`create index "orders_x_idx" on "public"."orders" ("id");`);',
      "this.addSql('create unique index if not exists carts_y_idx on only carts (id);');",
      "this.addSql('create index on \"orders\" (\"id\");');",
    ].join('\n');
    expect(declaredIndexes(source, MIGRATION)).toEqual([
      { index: 'orders_x_idx', table: 'orders' },
      { index: 'carts_y_idx', table: 'carts' },
    ]);
  });

  it('reads no index out of a comment', () => {
    expect(declaredIndexes('// create index "x" on "orders" ("id");', MIGRATION)).toEqual([]);
  });
});
