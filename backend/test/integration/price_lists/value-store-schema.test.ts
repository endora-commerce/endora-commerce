import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrations } from '@endora-commerce/mod-price-lists/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #470, Stage 1 (owner ruling O-3, 2026-11-10) — the schema of the
 * `price_lists`-owned price-change history: `price_list_value_changes`, one row
 * per Command that changed a value, and `price_list_row_value_changes`, one
 * line per price row it added, changed or removed.
 *
 * The schema is the one part of the history that cannot be taken back once
 * released, so every column type, constraint and index is asserted here, not
 * only the table names. Nothing writes the tables yet (Stage 2 does).
 *
 * Every test runs in a transaction that is rolled back. A refused statement
 * aborts it, so each test ends on at most one refusal.
 */

let db: TestDb;

beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.beginTx();
});
afterEach(async () => {
  await db.rollbackTx();
});

const sql = <T = Record<string, unknown>>(statement: string, params: unknown[] = []) =>
  db.em().execute<T[]>(statement, params);

async function insertBook(): Promise<string> {
  const id = randomUUID();
  await sql(
    `insert into "price_lists" ("id", "name", "currency_code", "audience_kind", "type", "status", "is_system",
       "priority", "created_at", "updated_at")
     values (?, 'History book', 'PLN', 'everyone', 'regular', 'draft', false, 0, now(), now())`,
    [id],
  );
  return id;
}

async function insertChange(bookId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const row: Record<string, unknown> = {
    id: randomUUID(),
    price_list_id: bookId,
    action: 'price_list.rows_replace',
    actor_kind: 'admin',
    ...fields,
  };
  const columns = Object.keys(row);
  await sql(
    `insert into "price_list_value_changes" (${columns.map((c) => `"${c}"`).join(', ')})
     values (${columns.map(() => '?').join(', ')})`,
    Object.values(row),
  );
  return row['id'] as string;
}

async function insertLine(
  changeId: string,
  bookId: string,
  seq: number,
  fields: Record<string, unknown> = {},
): Promise<void> {
  const row: Record<string, unknown> = {
    change_id: changeId,
    seq,
    price_list_id: bookId,
    at: new Date(),
    kind: 'changed',
    product_id: SEED_PRODUCT_101_ID,
    min_quantity: 1,
    before_price_type: 'fixed',
    before_amount: '10.0000',
    after_price_type: 'fixed',
    after_amount: '12.5000',
    ...fields,
  };
  const columns = Object.keys(row);
  await sql(
    `insert into "price_list_row_value_changes" (${columns.map((c) => `"${c}"`).join(', ')})
     values (${columns.map(() => '?').join(', ')})`,
    Object.values(row),
  );
}

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  column_default: string | null;
}

/** `name type[(size)] null|not null [default …]`, one string per column, in table order. */
async function columnsOf(table: string): Promise<string[]> {
  const found = await sql<ColumnRow>(
    `select column_name, data_type, is_nullable, character_maximum_length, numeric_precision, numeric_scale,
            column_default
       from information_schema.columns
      where table_schema = current_schema() and table_name = ?
      order by ordinal_position`,
    [table],
  );
  return found.map((c) => {
    const size =
      c.data_type === 'numeric'
        ? `(${c.numeric_precision},${c.numeric_scale})`
        : c.character_maximum_length !== null
          ? `(${c.character_maximum_length})`
          : '';
    const nullity = c.is_nullable === 'YES' ? 'null' : 'not null';
    const fallback = c.column_default === null ? '' : ` default ${c.column_default}`;
    return `${c.column_name} ${c.data_type}${size} ${nullity}${fallback}`;
  });
}

async function indexDefinitions(table: string): Promise<string[]> {
  const found = await sql<{ indexdef: string }>(
    `select indexdef from pg_indexes where schemaname = current_schema() and tablename = ? order by indexname`,
    [table],
  );
  return found.map((row) => row.indexdef.replace(/\s+/g, ' ').replace(/ ON [a-z_]+\./, ' ON '));
}

/** Every foreign key of `table`: `columns → table(columns) on delete <action>`. */
async function foreignKeys(table: string): Promise<string[]> {
  const found = await sql<{ definition: string }>(
    `select pg_get_constraintdef(c.oid) as definition
       from pg_constraint c join pg_class t on t.oid = c.conrelid
      where t.relname = ? and c.contype = 'f' and t.relnamespace = current_schema()::regnamespace
      order by c.conname`,
    [table],
  );
  return found.map((row) => row.definition.replace(/\s+/g, ' '));
}

async function countWhere(table: string, column: string, value: string): Promise<number> {
  const [row] = await sql<{ n: number }>(`select count(*)::int as "n" from "${table}" where "${column}" = ?`, [
    value,
  ]);
  return row?.n ?? 0;
}

describe('price_lists — price-change history store (#470, Stage 1)', () => {
  describe('price_list_value_changes, one row per Command that changed a value', () => {
    it('has the columns of the plan, typed as the audit actor and the book are', async () => {
      expect(await columnsOf('price_list_value_changes')).toEqual([
        'id uuid not null default gen_random_uuid()',
        'price_list_id uuid not null',
        'action character varying(48) not null',
        'actor_kind character varying(16) not null',
        'actor_admin_user_id uuid null',
        'at timestamp with time zone not null default now()',
        'header_before jsonb null',
        'header_after jsonb null',
        'line_count integer not null default 0',
      ]);
    });

    it('is keyed by id and indexed for a book history read newest first', async () => {
      expect(await indexDefinitions('price_list_value_changes')).toEqual([
        'CREATE INDEX price_list_value_changes_book_at_idx ON price_list_value_changes USING btree (price_list_id, at DESC, id DESC)',
        'CREATE UNIQUE INDEX price_list_value_changes_pkey ON price_list_value_changes USING btree (id)',
      ]);
    });

    it('goes with its book (on delete cascade)', async () => {
      expect(await foreignKeys('price_list_value_changes')).toEqual([
        'FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE',
      ]);
    });

    it('defaults its id, time and line count, and keeps header values as jsonb', async () => {
      const book = await insertBook();
      await sql(
        `insert into "price_list_value_changes" ("price_list_id", "action", "actor_kind", "header_before", "header_after")
         values (?, 'price_list.update', 'system', ?::jsonb, ?::jsonb)`,
        [book, JSON.stringify({ name: 'Before' }), JSON.stringify({ name: 'After' })],
      );
      const [row] = await sql<{
        id: string;
        at_is_now: boolean;
        line_count: number;
        actor_admin_user_id: string | null;
        header_before: unknown;
        header_after: unknown;
      }>(
        `select "id", ("at" = now()) as "at_is_now", "line_count", "actor_admin_user_id", "header_before", "header_after"
           from "price_list_value_changes" where "price_list_id" = ?`,
        [book],
      );
      expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
      // `now()` is the transaction's start, so the default is exactly it.
      expect(row?.at_is_now).toBe(true);
      expect(row?.line_count).toBe(0);
      expect(row?.actor_admin_user_id).toBeNull();
      expect(row?.header_before).toEqual({ name: 'Before' });
      expect(row?.header_after).toEqual({ name: 'After' });
    });

    it('refuses a change of a book that does not exist', async () => {
      await expect(insertChange(randomUUID())).rejects.toThrow(/price_list_value_changes_price_list_id_foreign/);
    });
  });

  describe('price_list_row_value_changes, one line per price row added, changed or removed', () => {
    it('has the selection and window of a row and both sides of its price, typed as the row is', async () => {
      expect(await columnsOf('price_list_row_value_changes')).toEqual([
        'change_id uuid not null',
        'seq integer not null',
        'price_list_id uuid not null',
        'at timestamp with time zone not null',
        'kind character varying(8) not null',
        'variant_id uuid null',
        'product_id uuid null',
        'category_id uuid null',
        'attribute_key character varying(64) null',
        'attribute_value character varying(255) null',
        'min_quantity integer not null',
        'max_quantity integer null',
        'before_price_type character varying(16) null',
        'before_amount numeric(14,4) null',
        'before_percent numeric(7,2) null',
        'after_price_type character varying(16) null',
        'after_amount numeric(14,4) null',
        'after_percent numeric(7,2) null',
      ]);
      // The price columns are the row's own (`price_list_matrix_entries`), so a
      // recorded price is the stored one, never a rounded copy of it.
      const rowColumns = await columnsOf('price_list_matrix_entries');
      expect(rowColumns).toContain('amount numeric(14,4) null');
      expect(rowColumns).toContain('percent numeric(7,2) null');
    });

    it('is keyed by (change, seq) and indexed for one price coordinate of a book, newest first', async () => {
      expect(await indexDefinitions('price_list_row_value_changes')).toEqual([
        'CREATE INDEX price_list_row_value_changes_book_product_at_idx ON price_list_row_value_changes USING btree (price_list_id, product_id, at DESC)',
        'CREATE UNIQUE INDEX price_list_row_value_changes_pkey ON price_list_row_value_changes USING btree (change_id, seq)',
      ]);
    });

    it('goes with its change and with its book (on delete cascade), and names no other table', async () => {
      expect(await foreignKeys('price_list_row_value_changes')).toEqual([
        'FOREIGN KEY (change_id) REFERENCES price_list_value_changes(id) ON DELETE CASCADE',
        'FOREIGN KEY (price_list_id) REFERENCES price_lists(id) ON DELETE CASCADE',
      ]);
    });

    it('records an added, a changed and a removed line, with four-place amounts and two-place percents', async () => {
      const book = await insertBook();
      const change = await insertChange(book, { line_count: 3 });
      await insertLine(change, book, 0, {
        kind: 'added',
        before_price_type: null,
        before_amount: null,
        after_price_type: 'percent',
        after_amount: null,
        after_percent: '-12.50',
      });
      await insertLine(change, book, 1, { before_amount: '0.0125', after_amount: '470470.4700', max_quantity: 9 });
      await insertLine(change, book, 2, {
        kind: 'removed',
        product_id: null,
        attribute_key: 'colour',
        attribute_value: 'red',
        after_price_type: null,
        after_amount: null,
      });
      const lines = await sql<{ seq: number; kind: string; before_amount: string | null; after_percent: string | null }>(
        `select "seq", "kind", "before_amount", "after_percent" from "price_list_row_value_changes"
          where "change_id" = ? order by "seq"`,
        [change],
      );
      expect(lines).toEqual([
        { seq: 0, kind: 'added', before_amount: null, after_percent: '-12.50' },
        { seq: 1, kind: 'changed', before_amount: '0.0125', after_percent: null },
        { seq: 2, kind: 'removed', before_amount: '10.0000', after_percent: null },
      ]);
    });

    it('refuses a kind other than added, changed and removed', async () => {
      const book = await insertBook();
      const change = await insertChange(book);
      await expect(insertLine(change, book, 0, { kind: 'moved' })).rejects.toThrow(
        /price_list_row_value_changes_kind_check/,
      );
    });

    it('refuses an added line with a before side', async () => {
      const book = await insertBook();
      const change = await insertChange(book);
      await expect(insertLine(change, book, 0, { kind: 'added' })).rejects.toThrow(
        /price_list_row_value_changes_sides_check/,
      );
    });

    it('refuses a removed line with an after side', async () => {
      const book = await insertBook();
      const change = await insertChange(book);
      await expect(insertLine(change, book, 0, { kind: 'removed' })).rejects.toThrow(
        /price_list_row_value_changes_sides_check/,
      );
    });

    it('refuses a changed line missing either side', async () => {
      const book = await insertBook();
      const change = await insertChange(book);
      await expect(
        insertLine(change, book, 0, { after_price_type: null, after_amount: null }),
      ).rejects.toThrow(/price_list_row_value_changes_sides_check/);
    });

    it('refuses an added line with no price type on its after side', async () => {
      const book = await insertBook();
      const change = await insertChange(book);
      await expect(
        insertLine(change, book, 0, {
          kind: 'added',
          before_price_type: null,
          before_amount: null,
          after_price_type: null,
          after_amount: null,
        }),
      ).rejects.toThrow(/price_list_row_value_changes_sides_check/);
    });

    it('refuses a price type a row cannot have', async () => {
      const book = await insertBook();
      const change = await insertChange(book);
      await expect(insertLine(change, book, 0, { after_price_type: 'discount_percent' })).rejects.toThrow(
        /price_list_row_value_changes_price_type_check/,
      );
    });

    it('refuses a line whose change does not exist', async () => {
      const book = await insertBook();
      await expect(insertLine(randomUUID(), book, 0)).rejects.toThrow(
        /price_list_row_value_changes_change_id_foreign/,
      );
    });

    it('refuses two lines with one (change, seq)', async () => {
      const book = await insertBook();
      const change = await insertChange(book);
      await insertLine(change, book, 0);
      await expect(insertLine(change, book, 0)).rejects.toThrow(/price_list_row_value_changes_pkey/);
    });
  });

  describe('cascade (D-4)', () => {
    it('deleting a book deletes its changes and their lines', async () => {
      const book = await insertBook();
      const other = await insertBook();
      const change = await insertChange(book, { line_count: 2 });
      await insertLine(change, book, 0);
      await insertLine(change, book, 1, { min_quantity: 10 });
      const kept = await insertChange(other, { line_count: 1 });
      await insertLine(kept, other, 0);

      await sql(`delete from "price_lists" where "id" = ?`, [book]);

      expect(await countWhere('price_list_value_changes', 'price_list_id', book)).toBe(0);
      expect(await countWhere('price_list_row_value_changes', 'price_list_id', book)).toBe(0);
      expect(await countWhere('price_list_row_value_changes', 'change_id', change)).toBe(0);
      expect(await countWhere('price_list_value_changes', 'price_list_id', other)).toBe(1);
      expect(await countWhere('price_list_row_value_changes', 'change_id', kept)).toBe(1);
    });

    it('deleting a change deletes its lines', async () => {
      const book = await insertBook();
      const change = await insertChange(book, { line_count: 1 });
      await insertLine(change, book, 0);
      await sql(`delete from "price_list_value_changes" where "id" = ?`, [change]);
      expect(await countWhere('price_list_row_value_changes', 'change_id', change)).toBe(0);
    });

    it('a line keeps a product id the catalogue no longer holds: history names no catalogue row', async () => {
      const book = await insertBook();
      const change = await insertChange(book, { line_count: 1 });
      await insertLine(change, book, 0, { product_id: randomUUID(), variant_id: randomUUID() });
      expect(await countWhere('price_list_row_value_changes', 'change_id', change)).toBe(1);
    });
  });

  describe('the migration', () => {
    const migration = migrations.find((candidate) => candidate.name.endsWith('PriceListsValueChanges'));

    async function apply(direction: 'up' | 'down'): Promise<void> {
      expect(migration, 'the price_lists value-changes migration').toBeDefined();
      const instance = new migration!(db.orm.em.getDriver(), db.orm.config);
      await instance[direction]();
      for (const query of instance.getQueries()) await sql(query as string);
      instance.reset();
    }

    async function tablesPresent(): Promise<string[]> {
      return (
        await sql<{ table_name: string }>(
          `select table_name from information_schema.tables
            where table_schema = current_schema()
              and table_name in ('price_list_value_changes', 'price_list_row_value_changes')
            order by table_name`,
        )
      ).map((row) => row.table_name);
    }

    it('is the newest price_lists migration, and down drops both tables and up recreates them', async () => {
      expect(migrations.at(-1)).toBe(migration);
      expect(await tablesPresent()).toEqual(['price_list_row_value_changes', 'price_list_value_changes']);
      await apply('down');
      expect(await tablesPresent()).toEqual([]);
      await apply('up');
      expect(await tablesPresent()).toEqual(['price_list_row_value_changes', 'price_list_value_changes']);
      expect(await indexDefinitions('price_list_row_value_changes')).toHaveLength(2);
    });
  });
});
