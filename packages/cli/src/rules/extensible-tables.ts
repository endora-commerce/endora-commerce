/**
 * `check:extensible-tables` — core's promise to the extensions that declare
 * columns on its tables (`specs/178-extensible-columns/` FR-072, FR-012,
 * research R-11, `contracts/foreign-schema-guard.md` §4).
 *
 * An installed package may declare `x_<moduleId>_*` columns on an **extensible
 * table** — every custom-field host table, derived from
 * `CUSTOM_FIELD_HOST_BINDINGS`. Those columns survive a platform upgrade only if
 * no migration of the table's owner rebuilds the table. The preservation test in
 * `test:backend` proves that after a merge (D-198 keeps that suite off merge
 * requests); this rule is the merge-request half, and reads the owners'
 * migration **sources**.
 *
 * Two findings, and no ledger — every acceptance is derived, and a legitimate
 * rebuild is a core design change that must carry the extension columns
 * forward, resolved by changing the migration rather than by an entry:
 *
 *   - **`extensible-table-rebuild`** — in an `up()` of a migration of a module
 *     owning an extensible table, a statement that rebuilds it: `drop table`,
 *     `alter table … rename to`, `create table … as select … from <t>`,
 *     `insert into … select * from <t>`, `select * into … from <t>`. A `down()`
 *     is not judged: reverting the migration that creates a table drops it by
 *     definition, and a hard uninstall of the host is refused while an extension
 *     is installed (FR-082).
 *   - **`binding-owner-mismatch`** — a binding whose `ownerModuleId` is not the
 *     module whose entity maps its `table` (FR-012). The owner map is the
 *     caller's (`check:module-boundary`'s `buildTableOwners` in this repository);
 *     a host that has none says so as an unevaluated signal.
 *
 * Literals are read as nodes, never as source text (`lib/sql-tables.ts`' header
 * says why), with a template's substitutions spliced as `?`.
 */
import ts from 'typescript';
import { CUSTOM_FIELD_HOST_BINDINGS } from '@endora-commerce/contracts';

export interface ExtensibleBinding {
  readonly entityType: string;
  readonly table: string;
  readonly ownerModuleId: string;
}

/** The bindings as the contracts package publishes them. */
export function publishedBindings(): ExtensibleBinding[] {
  return Object.entries(CUSTOM_FIELD_HOST_BINDINGS).map(([entityType, binding]) => ({
    entityType,
    table: binding.table,
    ownerModuleId: binding.ownerModuleId,
  }));
}

export type ExtensibleTablesFindingKind = 'extensible-table-rebuild' | 'binding-owner-mismatch';

export interface ExtensibleTablesFinding {
  readonly kind: ExtensibleTablesFindingKind;
  readonly table: string;
  /** Where — `<file>:<line>` for a rebuild, the binding's entity type for a mismatch. */
  readonly location: string;
  readonly message: string;
}

export interface MigrationSourceInput {
  readonly moduleId: string;
  readonly text: string;
}

export interface ExtensibleTablesInput {
  /** Display key → the migration source and the module that ships it. */
  readonly migrations: ReadonlyMap<string, MigrationSourceInput>;
  readonly bindings: readonly ExtensibleBinding[];
  /** table → owning module id, or `null` when this host has no owner map. */
  readonly owners: ReadonlyMap<string, string> | null;
}

export interface ExtensibleTablesResult {
  readonly findings: readonly ExtensibleTablesFinding[];
  /** Migration files of owning modules judged. */
  readonly files: number;
  /** Literals inside an `up()` (or outside any `down()`) judged. */
  readonly sites: number;
  /** Owning modules, and how many of them contributed at least one migration. */
  readonly owners: { readonly expected: number; readonly covered: number; readonly missing: readonly string[] };
}

const IDENT = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;
const QUALIFIED = String.raw`(?:${IDENT}\s*\.\s*)?${IDENT}`;

/** `"public"."Orgs"` → `orgs`. */
function tableName(qualified: string): string {
  const parts = [...qualified.matchAll(new RegExp(IDENT, 'gi'))].map((match) =>
    match[0].replace(/^"|"$/g, '').toLowerCase(),
  );
  return parts[parts.length - 1] ?? '';
}

interface RebuildShape {
  readonly shape: string;
  readonly pattern: RegExp;
  /** The capture group holding the rebuilt table (or a comma list, for `drop table`). */
  readonly group: number;
  readonly list?: boolean;
}

const SHAPES: readonly RebuildShape[] = [
  {
    shape: 'drop table',
    pattern: new RegExp(String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?(${QUALIFIED}(?:\s*,\s*${QUALIFIED})*)`, 'gi'),
    group: 1,
    list: true,
  },
  {
    shape: 'alter table … rename to',
    pattern: new RegExp(String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QUALIFIED})\s+rename\s+to\b`, 'gi'),
    group: 1,
  },
  {
    shape: 'create table … as select … from',
    pattern: new RegExp(
      String.raw`\bcreate\s+(?:(?:temporary|temp|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?${QUALIFIED}\s+as\s+\(?\s*select\b[^;]*?\bfrom\s+(?:only\s+)?(${QUALIFIED})`,
      'gi',
    ),
    group: 1,
  },
  {
    shape: 'insert into … select * from',
    pattern: new RegExp(
      String.raw`\binsert\s+into\s+${QUALIFIED}(?:\s*\([^)]*\))?\s+select\s+\*\s+from\s+(?:only\s+)?(${QUALIFIED})`,
      'gi',
    ),
    group: 1,
  },
  {
    shape: 'select * into … from',
    pattern: new RegExp(String.raw`\bselect\s+\*\s+into\s+${QUALIFIED}\s+from\s+(?:only\s+)?(${QUALIFIED})`, 'gi'),
    group: 1,
  },
];

/** Comments out, string literals blanked, so prose names nothing. */
function normalise(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** The literals of `text` that are not inside a method named `down`, with their line. */
function judgedLiterals(text: string, file: string): Array<{ text: string; line: number }> {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Array<{ text: string; line: number }> = [];
  const visit = (node: ts.Node, insideDown: boolean): void => {
    const entersDown =
      insideDown ||
      (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'down');
    let literal: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literal = node.text;
    else if (ts.isTemplateExpression(node)) {
      literal = node.head.text;
      for (const span of node.templateSpans) literal += ` ? ${span.literal.text}`;
    }
    if (literal !== null && !entersDown) {
      found.push({ text: literal, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    node.forEachChild((child) => visit(child, entersDown));
  };
  source.forEachChild((child) => visit(child, false));
  return found;
}

export function checkExtensibleTables(input: ExtensibleTablesInput): ExtensibleTablesResult {
  const extensible = new Set(input.bindings.map((binding) => binding.table));
  const owningModules = new Set(input.bindings.map((binding) => binding.ownerModuleId));
  const findings: ExtensibleTablesFinding[] = [];

  let files = 0;
  let sites = 0;
  const covered = new Set<string>();
  for (const [file, { moduleId, text }] of input.migrations) {
    if (!owningModules.has(moduleId)) continue;
    files += 1;
    covered.add(moduleId);
    for (const literal of judgedLiterals(text, file)) {
      sites += 1;
      const sql = normalise(literal.text);
      for (const { shape, pattern, group, list } of SHAPES) {
        pattern.lastIndex = 0;
        for (const match of sql.matchAll(pattern)) {
          const named = list === true ? match[group]!.split(',').map(tableName) : [tableName(match[group]!)];
          for (const table of named) {
            if (!extensible.has(table)) continue;
            findings.push({
              kind: 'extensible-table-rebuild',
              table,
              location: `${file}:${literal.line}`,
              message:
                `\`${shape}\` on the extensible table "${table}" in a migration of "${moduleId}". ` +
                `Rebuilding an extensible table loses every installed extension's x_* columns ` +
                `(specs/178-extensible-columns/ FR-072). Change the table in place — add, alter or ` +
                `drop the columns you own — rather than rebuilding it.`,
            });
          }
        }
      }
    }
  }

  if (input.owners !== null) {
    for (const binding of input.bindings) {
      const owner = input.owners.get(binding.table);
      if (owner === binding.ownerModuleId) continue;
      findings.push({
        kind: 'binding-owner-mismatch',
        table: binding.table,
        location: `CUSTOM_FIELD_HOST_BINDINGS.${binding.entityType}`,
        message:
          `the custom-field binding "${binding.entityType}" names "${binding.table}" owned by ` +
          `"${binding.ownerModuleId}", but ${owner === undefined ? 'no entity maps that table' : `"${owner}" owns it`} ` +
          `(specs/178-extensible-columns/ FR-012). The extensible host list and its dependency rule are ` +
          `derived from this binding, so it must name the table's real owner.`,
      });
    }
  }

  const missing = [...owningModules].filter((moduleId) => !covered.has(moduleId)).sort();
  return {
    findings,
    files,
    sites,
    owners: { expected: owningModules.size, covered: covered.size, missing },
  };
}
