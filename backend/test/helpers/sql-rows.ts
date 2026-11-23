import type { EntityManager } from '@mikro-orm/postgresql';

/** A column name this helper will spell into a statement: a plain lower-case identifier. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Insert `rows` into `table` through `em.execute` (issue #1864) — the
 * arrangement step tests used to write as `knex(table).insert(rows)`.
 *
 * Identifiers are bound as identifiers (`??`) and every value as a value
 * (`?`); a column one row leaves out, or sets to `undefined`, takes its
 * default. A plain object is stored as its JSON text, which is what a `jsonb`
 * column wants. A JavaScript array is refused rather than guessed at: the
 * driver would spread it into a value list, so the caller says whether it
 * means `JSON.stringify(…)` or a PostgreSQL array literal.
 */
export async function insertRows(
  em: EntityManager,
  table: string,
  rows: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>,
): Promise<void> {
  const list = Array.isArray(rows) ? rows : [rows as Record<string, unknown>];
  if (list.length === 0) return;
  const columns = [...new Set(list.flatMap((row) => Object.keys(row)))];
  for (const name of [table, ...columns]) {
    if (!IDENTIFIER.test(name)) throw new Error(`insertRows: "${name}" is not a plain identifier`);
  }
  const params: unknown[] = [table, ...columns];
  const tuples = list.map((row) => {
    const cells = columns.map((column) => {
      const value = row[column];
      if (value === undefined) return 'default';
      if (Array.isArray(value)) {
        throw new Error(`insertRows: "${table}.${column}" is an array; pass JSON.stringify(...) or a PostgreSQL array literal`);
      }
      params.push(value);
      return '?';
    });
    return `(${cells.join(', ')})`;
  });
  await em.execute(
    `insert into ?? (${columns.map(() => '??').join(', ')}) values ${tuples.join(', ')}`,
    params,
  );
}
