/**
 * The tables a SQL text **writes** — the statement half of the runtime
 * foreign-schema guard (`specs/178-extensible-columns/` FR-070,
 * `contracts/foreign-schema-guard.md` §1).
 *
 * The platform judges an installed package's migrations at `migrate` time, in
 * an instance, where there is no `typescript` to parse a source with — so this
 * reads the **statement text** the migration hands to `addSql` / `execute`
 * (a knex builder is rendered with `toQuery()` first). It is the second
 * classifier of write targets in the repository: `@endora-commerce/cli`'s
 * `sqlTableAccesses` reads TypeScript sources for `check:module-boundary`.
 * `backend/test/unit/db/sql-write-targets-parity.test.ts` holds the two equal
 * over every first-party migration, which is what keeps a second classifier
 * from becoming a second opinion (plan, Complexity Tracking).
 *
 * What it recognises, quoted or bare, schema-qualified or not, through
 * `if [not] exists`, `only` and `concurrently`:
 *
 *   - DDL: `alter table`, `create [unique] index … on`, `drop table` (every
 *     table of the list), `drop index` (an index, resolved by the caller),
 *     `comment on table|column`, `create|drop trigger … on`, `create rule … to`,
 *     and `create table`, which declares rather than writes;
 *   - DML: `insert into`, `update` (with the columns it sets), `delete from`,
 *     `truncate`, `merge into`.
 *
 * Reads are not reported. Comments are removed and single-quoted string
 * literals are blanked before anything is matched, so neither prose nor an
 * `information_schema` probe for `'organizations'` names a table; a
 * `do $$ … $$` body is ordinary text here and is scanned like the rest.
 */

export type SqlWriteVerb =
  | 'alter'
  | 'index'
  | 'drop'
  | 'drop-index'
  | 'comment'
  | 'trigger'
  | 'rule'
  | 'create'
  | 'insert'
  | 'update'
  | 'delete'
  | 'truncate'
  | 'merge'
  /** `create|alter|drop policy … on <t>` — row-level security on the table. */
  | 'policy'
  /**
   * A PL/pgSQL `execute` of a string this reader cannot see — `format(…)`, a
   * variable, a concatenation. Its table is unattributable, so a caller judging
   * writes must refuse it (fail closed, review finding 5).
   */
  | 'dynamic';

export interface SqlWriteTarget {
  /** The table, lower-cased, schema qualifier stripped. `null` for `drop index`. */
  readonly table: string | null;
  /** The index a `drop index` names; absent otherwise. */
  readonly index?: string;
  readonly verb: SqlWriteVerb;
  /**
   * For `update`: the columns it sets, lower-cased — or `null` when the set
   * list has a shape this reader does not attribute (`set (a, b) = (…)`), which
   * a caller must treat as "not provably its own".
   */
  readonly setColumns?: readonly string[] | null;
  /** For `alter`: whether the statement drops something (a column, a constraint) — D-291 R-A6. */
  readonly destructive?: boolean;
  /** For `create`: whether it is `create table if not exists`, a no-op on an existing table. */
  readonly ifNotExists?: boolean;
  /** The statement's head, whitespace collapsed, for a message. */
  readonly statement: string;
}

const IDENT = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;
const QUALIFIED = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`;
const LIST = String.raw`${QUALIFIED}(?:\s*,\s*(?:only\s+)?${QUALIFIED})*`;

interface Recogniser {
  readonly verb: SqlWriteVerb;
  readonly pattern: RegExp;
}

const re = (source: string): RegExp => new RegExp(source, 'gi');

const RECOGNISERS: readonly Recogniser[] = [
  { verb: 'alter', pattern: re(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QUALIFIED})`) },
  {
    verb: 'index',
    pattern: re(
      String.raw`\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:(?!on\b)${QUALIFIED}\s+)?on\s+(?:only\s+)?(${QUALIFIED})`,
    ),
  },
  { verb: 'drop', pattern: re(String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?(${LIST})`) },
  {
    verb: 'drop-index',
    pattern: re(String.raw`\bdrop\s+index\s+(?:concurrently\s+)?(?:if\s+exists\s+)?(${QUALIFIED})`),
  },
  {
    verb: 'comment',
    pattern: re(String.raw`\bcomment\s+on\s+(table|column)\s+((?:${IDENT}\s*\.\s*)*${IDENT})`),
  },
  {
    verb: 'trigger',
    pattern: re(
      String.raw`\b(?:create|drop)\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+(?:if\s+exists\s+)?${IDENT}[^;]*?\bon\s+(?:only\s+)?(${QUALIFIED})`,
    ),
  },
  {
    verb: 'rule',
    pattern: re(String.raw`\bcreate\s+(?:or\s+replace\s+)?rule\s+${IDENT}\s+as\s+on\s+[a-z]+\s+to\s+(${QUALIFIED})`),
  },
  {
    verb: 'create',
    pattern: re(
      String.raw`\bcreate\s+(?:(?:global\s+|local\s+)?(?:temporary|temp|unlogged)\s+)?table\s+(if\s+not\s+exists\s+)?(${QUALIFIED})`,
    ),
  },
  { verb: 'insert', pattern: re(String.raw`\binsert\s+into\s+(${QUALIFIED})`) },
  {
    verb: 'update',
    pattern: re(
      String.raw`\bupdate\s+(?:only\s+)?(?!set\b)(${QUALIFIED})(?:\s+(?:as\s+)?(?!set\b)${IDENT})?\s+set\b`,
    ),
  },
  { verb: 'delete', pattern: re(String.raw`\bdelete\s+from\s+(?:only\s+)?(${QUALIFIED})`) },
  // `(?!on\b)`: `create trigger … after truncate on <t>` names an event, not a statement.
  { verb: 'truncate', pattern: re(String.raw`\btruncate\s+(?:table\s+)?(?:only\s+)?(?!on\b)(${LIST})`) },
  { verb: 'merge', pattern: re(String.raw`\bmerge\s+into\s+(?:only\s+)?(${QUALIFIED})`) },
  {
    verb: 'policy',
    pattern: re(String.raw`\b(?:create|alter|drop)\s+policy\s+(?:if\s+exists\s+)?${IDENT}\s+on\s+(${QUALIFIED})`),
  },
  // What is left of `execute` once the literal strings it runs were inlined
  // (see `normalise`): a computed string. `execute function|procedure` is a
  // trigger's action and `grant execute on` a privilege.
  { verb: 'dynamic', pattern: re(String.raw`\bexecute\s+(?!function\b|procedure\b|on\b)()`) },
];

/** `"Public"."Orgs"` → `orgs`; `a.b` → `b`. */
function lastPart(qualified: string): string {
  const parts = splitDotted(qualified);
  return parts[parts.length - 1] ?? '';
}

function splitDotted(qualified: string): string[] {
  return [...qualified.matchAll(new RegExp(IDENT, 'gi'))].map((match) =>
    match[0].replace(/^"|"$/g, '').toLowerCase(),
  );
}

function splitList(list: string): string[] {
  return splitTopLevel(list.replace(/\bonly\s+/gi, '')).map((item) => lastPart(item.trim()));
}

/** Split on commas outside parentheses. */
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

/**
 * Comments out, string literals blanked — what every recogniser reads — except
 * the string a PL/pgSQL `execute` runs, which is SQL and is inlined (unescaped,
 * closed with `;`) so a dynamic `execute 'delete from …'` is judged like a
 * static one.
 */
function normalise(sql: string): string {
  return sql
    // `execute $tag$ … $tag$` runs a dollar-quoted literal: inline it like a
    // single-quoted one, before anything else reads the text.
    .replace(/\bexecute\s+(\$[a-z_]*\$)([\s\S]*?)\1/gi, (_match, _tag: string, body: string) => ` ${body} ;`)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/(\bexecute\s+)?'((?:[^']|'')*)'/gi, (_match, execute: string | undefined, body: string) =>
      execute === undefined ? "''" : ` ${body.replace(/''/g, "'")} ;`,
    );
}

/** The columns `update … set <list>` assigns, or `null` for a shape not attributable. */
function setColumnsAt(text: string, from: number): readonly string[] | null {
  let depth = 0;
  let end = text.length;
  const rest = text.slice(from);
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index]!;
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ';' && depth === 0) {
      end = from + index;
      break;
    }
    if (depth === 0 && /\s/.test(char)) {
      const tail = rest.slice(index + 1);
      if (/^(from|where|returning)\b/i.test(tail)) {
        end = from + index;
        break;
      }
    }
  }
  const list = text.slice(from, end).trim();
  if (list.startsWith('(')) return null;
  const columns: string[] = [];
  for (const item of splitTopLevel(list)) {
    const match = new RegExp(String.raw`^\s*(${IDENT})\s*=`, 'i').exec(item);
    if (match === null) return null;
    columns.push(match[1]!.replace(/^"|"$/g, '').toLowerCase());
  }
  return columns;
}

function statementHead(text: string, from: number): string {
  const end = text.indexOf(';', from);
  return text
    .slice(from, end === -1 ? undefined : end)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Every write target of `sql`, in the order the statements name them. */
export function sqlWriteTargets(sql: string): SqlWriteTarget[] {
  const text = normalise(sql);
  const found: Array<SqlWriteTarget & { readonly at: number }> = [];
  for (const { verb, pattern } of RECOGNISERS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      const statement = statementHead(text, at);
      switch (verb) {
        case 'drop':
        case 'truncate':
          for (const table of splitList(match[1]!)) found.push({ at, table, verb, statement });
          break;
        case 'dynamic':
          found.push({ at, table: null, verb, statement });
          break;
        case 'drop-index':
          found.push({ at, table: null, index: lastPart(match[1]!), verb, statement });
          break;
        case 'comment': {
          const parts = splitDotted(match[2]!);
          const isColumn = match[1]!.toLowerCase() === 'column';
          const table = isColumn ? parts[parts.length - 2] : parts[parts.length - 1];
          if (table !== undefined) found.push({ at, table, verb, statement });
          break;
        }
        case 'update':
          found.push({
            at,
            table: lastPart(match[1]!),
            verb,
            setColumns: setColumnsAt(text, at + match[0].length),
            statement,
          });
          break;
        case 'create':
          found.push({ at, table: lastPart(match[2]!), verb, ifNotExists: match[1] !== undefined, statement });
          break;
        case 'alter': {
          const end = text.indexOf(';', at);
          const whole = text.slice(at, end === -1 ? undefined : end);
          found.push({ at, table: lastPart(match[1]!), verb, destructive: /\bdrop\b/i.test(whole), statement });
          break;
        }
        default:
          found.push({ at, table: lastPart(match[1]!), verb, statement });
      }
    }
  }
  found.sort((left, right) => left.at - right.at);
  return found.map(({ at: _at, ...target }) => target);
}
