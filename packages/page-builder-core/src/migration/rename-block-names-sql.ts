// The rename migration's SQL — feature 096, T403.
//
// **One generator, five migrations** (`contracts/block-name-migration.md` §3.4).
// Each of the five table-owning modules writes its own migration over its own
// columns; what none of them writes is the rewrite itself, because five copies
// of a recursive `jsonb` walk are five chances to disagree about what a node is.
//
// ## The premise, verified before this file was written (T403a)
//
// `contracts/block-name-migration.md` §3.4 flagged the shape as unverified:
// every migration in this tree uses `this.addSql(...)` with literal SQL and
// **none creates a function**, so there was no precedent for `pg_temp`
// surviving MikroORM's statement batching. It was probed against real
// PostgreSQL before anything was built on it, on MikroORM 6.6.13: a
// `create function pg_temp.…` issued through `addSql` **is** visible to a later
// `addSql` in the same migration, the recursion works, and a slotted child two
// levels down is renamed. The fallback — a batched row walk in TypeScript — was
// therefore not needed and is not carried here.
//
// ## Why a function rather than an expression
//
// The rewrite is recursive: a Puck tree nests to arbitrary depth and places node
// arrays under arbitrary prop keys. SQL has no recursive expression, so the
// choice is a function or a row walk in TypeScript; the function runs inside the
// migration's own transaction, needs no ORM and uses memory independent of the
// data size.
//
// `pg_temp` and not a schema-qualified permanent function: the object lives for
// the session and disappears with it, so an upgrade leaves nothing behind for an
// operator to notice or clean up, and a failed migration's rollback removes it
// with everything else.

/**
 * The DDL that creates the rewrite function, and the `drop` that retires it.
 *
 * `functionName` must be unique per migration: five migrations may share one
 * pooled session, and a second `create function` over the same name would fail
 * — so each migration names its own and drops it when it is done.
 *
 * The map is embedded as a **`jsonb` object literal** and the lookup is
 * `map -> (value #>> '{}')`, a single hash probe per node rather than a join.
 * `coalesce(…, v)` is the one branch `contracts/block-name-migration.md` §3.3
 * describes: a name the map holds is replaced, anything else is left
 * byte-identical — an already-namespaced name and an unrecognised one alike,
 * because the map's domain is bare and its codomain is dotted.
 */
export function createRenameFunctionSql(
  functionName: string,
  renames: Readonly<Record<string, string>>,
): string {
  assertPgTempFunctionName(functionName);
  const map = JSON.stringify(renames);
  // Every value in the map is a block name — `^[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9]*$`
  // — so it carries no quote, no backslash and no dollar sign, and the literal
  // below cannot be terminated early. Asserted rather than assumed.
  assertSqlSafeMap(renames);
  return `
    create function pg_temp.${functionName}(doc jsonb) returns jsonb as $fn096$
      select case jsonb_typeof(doc)
        when 'object' then (
          select coalesce(
            jsonb_object_agg(
              e.k,
              case
                when e.k = 'type' and jsonb_typeof(e.v) = 'string'
                  then coalesce('${map}'::jsonb -> (e.v #>> '{}'), e.v)
                else pg_temp.${functionName}(e.v)
              end
            ),
            '{}'::jsonb
          )
          from jsonb_each(doc) as e(k, v)
        )
        when 'array' then (
          select coalesce(jsonb_agg(pg_temp.${functionName}(el)), '[]'::jsonb)
          from jsonb_array_elements(doc) as el
        )
        else doc
      end
    $fn096$ language sql immutable;
  `;
}

/** Retire the function created by {@link createRenameFunctionSql}. */
export function dropRenameFunctionSql(functionName: string): string {
  assertPgTempFunctionName(functionName);
  return `drop function if exists pg_temp.${functionName}(jsonb);`;
}

/**
 * Apply the function to one column.
 *
 * `where "<column>" is not null` and nothing finer: a `jsonb` document with no
 * node in it is rewritten to a structurally identical document, so the update
 * is a no-op in content and costs one rewritten row. Trying to narrow it with a
 * `@>` containment test would need the node's shape, which is the thing the walk
 * exists to find.
 */
export function applyRenameFunctionSql(
  functionName: string,
  table: string,
  column: string,
): string {
  assertPgTempFunctionName(functionName);
  assertIdentifier(table);
  assertIdentifier(column);
  return `update "${table}" set "${column}" = pg_temp.${functionName}("${column}") where "${column}" is not null;`;
}

function assertPgTempFunctionName(name: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`[page-builder-core] "${name}" is not a usable pg_temp function name.`);
  }
}

function assertIdentifier(name: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`[page-builder-core] "${name}" is not a usable SQL identifier.`);
  }
}

function assertSqlSafeMap(renames: Readonly<Record<string, string>>): void {
  for (const [from, to] of Object.entries(renames)) {
    if (!/^[A-Za-z0-9_.]+$/.test(from) || !/^[A-Za-z0-9_.]+$/.test(to)) {
      throw new Error(
        `[page-builder-core] block name "${from}" -> "${to}" carries a character that cannot ` +
          'be embedded in the rename function literal.',
      );
    }
  }
}
