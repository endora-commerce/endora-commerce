import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Collection } from '@mikro-orm/core';
import { Entity, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/postgresql';

import { statementsDuring } from '../../helpers/statement-tap.js';

/**
 * The statement tap sees what MikroORM 7 executes (issue #1866, from the review
 * of #1890).
 *
 * `test/helpers/statement-tap.ts` reads statements off the ORM logger, and the
 * bounded-statement-count tests trust it to see **every** statement a path
 * sends — a statement the ORM sent past the logger would be one those tests
 * cannot count, and they would stay green over a path that grew. So this holds
 * the tap against the only witness that cannot be bypassed: the `pg` client the
 * pool hands out, wrapped below the ORM. Every statement the database received
 * while the tap listened must be one the tap reported, over the paths the
 * estate uses — `find` with a joined and a select-in populate, a query builder,
 * `count`, `execute`, a flush that inserts, updates and deletes, `nativeUpdate`,
 * a transaction and a nested one (a savepoint).
 *
 * Transaction control is compared by kind rather than by text: kysely sends
 * `begin` / `savepoint …` itself and the ORM logs its own spelling of the same
 * statement, so each `begin`, `commit`, `rollback` and savepoint the database
 * saw must be matched by one the tap saw.
 */

@Entity({ tableName: 'x1866_tap_parents' })
class X1866TapParent {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'text' })
  name!: string;

  @OneToMany(() => X1866TapChild, (child) => child.parent)
  children = new Collection<X1866TapChild>(this);
}

@Entity({ tableName: 'x1866_tap_children' })
class X1866TapChild {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'text' })
  label!: string;

  @ManyToOne(() => X1866TapParent)
  parent!: X1866TapParent;
}

interface PgClient {
  query(...args: unknown[]): unknown;
  [WRAPPED]?: true;
}

const WRAPPED = Symbol('x1866-wrapped');

/** One of `begin`, `commit`, `rollback`, `savepoint`, `release` — or `null` for an ordinary statement. */
function controlKind(sql: string): string | null {
  const head = sql.trim().toLowerCase();
  if (/^(begin|start transaction)\b/.test(head)) return 'begin';
  if (/^commit\b/.test(head)) return 'commit';
  // kysely spells the savepoint statements without the keyword (`release "trx1"`,
  // `rollback to "trx1"`) where MikroORM logs its own spelling with it.
  if (/^rollback to\b/.test(head)) return 'rollback-to-savepoint';
  if (/^rollback\b/.test(head)) return 'rollback';
  if (/^savepoint\b/.test(head)) return 'savepoint';
  if (/^release\b/.test(head)) return 'release';
  return null;
}

describe('the statement tap over MikroORM 7 (#1866)', () => {
  let orm: MikroORM;
  /** What the database received, while {@link received} is listening. */
  let received: string[] | null = null;

  beforeAll(async () => {
    orm = await MikroORM.init({
      entities: [X1866TapParent, X1866TapChild],
      clientUrl: process.env['DATABASE_URL']!,
      allowGlobalContext: true,
    });
    await orm.em.getConnection().execute(`
      drop table if exists "x1866_tap_children", "x1866_tap_parents";
      create table "x1866_tap_parents" ("id" uuid primary key, "name" text not null);
      create table "x1866_tap_children" ("id" uuid primary key, "label" text not null,
        "parent_id" uuid not null references "x1866_tap_parents" ("id"));`);
    // Below the ORM: every client the pool hands out, wrapped once.
    const pool = (await orm.em.getConnection().getNativeClient()) as unknown as {
      on(event: 'acquire', listener: (client: PgClient) => void): void;
    };
    pool.on('acquire', (client) => {
      if (client[WRAPPED] === true) return;
      client[WRAPPED] = true;
      const query = client.query.bind(client);
      client.query = (...args: unknown[]) => {
        const first = args[0];
        const text = typeof first === 'string' ? first : (first as { text?: string } | null)?.text;
        if (received !== null && typeof text === 'string') received.push(text);
        return query(...args);
      };
    });
  });

  afterAll(async () => {
    await orm.em.getConnection().execute('drop table if exists "x1866_tap_children", "x1866_tap_parents"');
    await orm.close(true);
  });

  it('reports every statement the database receives, on every path the estate uses', async () => {
    received = [];
    const { statements } = await statementsDuring(orm.em, async () => {
      const em = orm.em.fork();
      const parent = em.create(X1866TapParent, { name: 'p' });
      em.create(X1866TapChild, { label: 'a', parent });
      em.create(X1866TapChild, { label: 'b', parent });
      await em.flush();

      const reader = orm.em.fork();
      await reader.findOneOrFail(X1866TapParent, { id: parent.id }, { populate: ['children'], strategy: 'joined' });
      await orm.em.fork().findOneOrFail(X1866TapParent, { id: parent.id }, { populate: ['children'], strategy: 'select-in' });
      await orm.em.fork().count(X1866TapChild, { parent: parent.id });
      await orm.em.fork().createQueryBuilder(X1866TapChild, 'c').select('c.label').where({ parent: parent.id }).execute();
      await orm.em.fork().execute('select count(*) from "x1866_tap_children" where "label" = ?', ['a']);

      const writer = orm.em.fork();
      const loaded = await writer.findOneOrFail(X1866TapParent, { id: parent.id }, { populate: ['children'] });
      loaded.name = 'p2';
      writer.remove(loaded.children.getItems()[0]!);
      await writer.flush();
      await orm.em.fork().nativeUpdate(X1866TapChild, { parent: parent.id }, { label: 'z' });

      await orm.em.fork().transactional(async (tx) => {
        await tx.find(X1866TapChild, {});
        await tx.transactional(async (inner) => {
          inner.create(X1866TapChild, { label: 'c', parent: inner.getReference(X1866TapParent, parent.id) });
        });
      });
    });
    const seen = received;
    received = null;

    expect(seen.length).toBeGreaterThan(10);
    const tappedTexts = new Set(statements.map((statement) => statement.text));
    const unseen = seen.filter((text) => controlKind(text) === null && !tappedTexts.has(text));
    expect(unseen, 'statements the database received that the tap never reported').toEqual([]);

    const kinds = (texts: readonly string[]): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const text of texts) {
        const kind = controlKind(text);
        if (kind !== null) out[kind] = (out[kind] ?? 0) + 1;
      }
      return out;
    };
    expect(kinds(statements.map((statement) => statement.sql))).toEqual(kinds(seen));
    // Not vacuous: the transaction and its savepoint were both there to compare.
    expect(kinds(seen)).toMatchObject({ begin: expect.any(Number), savepoint: expect.any(Number) });
  });
});
