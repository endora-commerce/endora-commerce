import { ENTITY_EXTENSION_HOSTS, type EntityExtensionHost } from '../kernel/schema-extensions/extensible-hosts.js';
import type { EntityExtensionContext } from '../kernel/entity-extensions/context.js';
import {
  EntityExtensionDriftError,
  describeEntityExtensionFinding,
  type EntityExtensionFinding,
  type EntityExtensionOrigin,
} from '../kernel/entity-extensions/errors.js';
import type { SchemaExtensionExec } from './schema-extension-verifier.js';

/**
 * The side-table verifier (`specs/187-side-table-extensions/`
 * `contracts/verification-rules.md` §4 – §6; FR-020 – FR-023, FR-030 – FR-031;
 * research R-5, R-7).
 *
 * **One catalog query**, whatever the number of declarations: every table in
 * the current schema whose primary key is exactly one foreign key into one of
 * the extensible host tables. The declared tables are judged from its rows
 * (P1 – P4), and the rows nobody declared are the undeclared scan (U1, U2) —
 * so the scan costs nothing extra. A declared table missing from the rows is
 * told apart as missing or unkeyed by one `to_regclass` each, on the failure
 * path only.
 *
 * Run through D2's {@link SchemaExtensionExec}, so it is the same call inside
 * the `migrate` transaction — where a finding rolls the run back — and on a
 * plain connection at boot, where it refuses to start.
 */

/**
 * OR-8: `'warn'` in the release that ships the declaration (0.113.0);
 * `'refuse'` from the release after. The flip is its own changeset, with the
 * test that asserts this value edited beside it.
 */
export const ENTITY_EXTENSION_UNDECLARED_POLICY: 'warn' | 'refuse' = 'warn';

export type EntityExtensionUndeclaredPolicy = 'warn' | 'refuse';

/** One `entity-extension` row of `module:schema-extensions list` (`contracts/schema-extensions-cli.md` §1). */
export interface EntityExtensionListRow {
  readonly kind: 'entity-extension';
  readonly moduleId: string | null;
  readonly origin: EntityExtensionOrigin | null;
  /** `<ownerModuleId>.<EntityClassName>`. */
  readonly host: string;
  readonly hostTable: string;
  readonly table: string;
  /** The foreign-key constraint's name; `null` when there is none to name. */
  readonly constraint: string | null;
  readonly status: 'verified' | 'undeclared' | 'unowned' | `violation:${string}`;
}

export interface EntityExtensionReport {
  /** What refuses the run (P1 – P4; U1 under `refuse`). */
  readonly findings: readonly EntityExtensionFinding[];
  /** What is logged at `warn` (U2; U1 under `warn`). */
  readonly warnings: readonly string[];
  /** Every declared or found side table — the list's rows, ordered by host, then table. */
  readonly rows: readonly EntityExtensionListRow[];
  /** Statements issued — FR-023's budget, asserted by a test. */
  readonly queries: number;
}

export interface EntityExtensionVerifyOptions {
  /** Defaults to {@link ENTITY_EXTENSION_UNDECLARED_POLICY}; a test injects the other one. */
  readonly policy?: EntityExtensionUndeclaredPolicy;
  /** Defaults to every extensible host. */
  readonly hosts?: ReadonlyMap<string, EntityExtensionHost>;
}

interface CatalogRow {
  readonly table_name: string;
  readonly pk_name: string;
  readonly fk_name: string;
  readonly host_table: string;
  readonly on_delete: string;
  readonly references_host_pk: boolean;
}

/** The §4 query over `count` host tables, bound as `?` placeholders. */
export function entityExtensionCatalogQuery(count: number): string {
  const placeholders = Array.from({ length: count }, () => '?').join(', ');
  return (
    `select c.relname as table_name, pk.conname as pk_name, fk.conname as fk_name, h.relname as host_table, ` +
    `fk.confdeltype as on_delete, (fk.confkey = hpk.conkey) as references_host_pk ` +
    `from pg_constraint pk ` +
    `join pg_class c on c.oid = pk.conrelid ` +
    `join pg_namespace n on n.oid = c.relnamespace and n.nspname = current_schema() ` +
    `join pg_constraint fk on fk.conrelid = pk.conrelid and fk.contype = 'f' and fk.conkey = pk.conkey ` +
    `join pg_class h on h.oid = fk.confrelid and h.relname in (${placeholders}) ` +
    `join pg_constraint hpk on hpk.conrelid = h.oid and hpk.contype = 'p' ` +
    `where pk.contype = 'p' ` +
    `order by c.relname, fk.conname`
  );
}

const DELETE_ACTIONS: Readonly<Record<string, string>> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

/** The inspection, without the reaction. */
export async function inspectEntityExtensions(
  exec: SchemaExtensionExec,
  context: EntityExtensionContext,
  options: EntityExtensionVerifyOptions = {},
): Promise<EntityExtensionReport> {
  const policy = options.policy ?? ENTITY_EXTENSION_UNDECLARED_POLICY;
  const hosts = options.hosts ?? ENTITY_EXTENSION_HOSTS;
  const hostByTable = new Map<string, { readonly reference: string; readonly host: EntityExtensionHost }>(
    [...hosts].map(([reference, host]) => [host.table, { reference, host }] as const),
  );
  const hostTables = [...hostByTable.keys()].sort();
  const catalog = (await exec(entityExtensionCatalogQuery(hostTables.length), hostTables)) as unknown as CatalogRow[];
  let queries = 1;

  const rowsByTable = new Map<string, CatalogRow[]>();
  for (const row of catalog) {
    const list = rowsByTable.get(row.table_name);
    if (list) list.push(row);
    else rowsByTable.set(row.table_name, [row]);
  }

  const findings: EntityExtensionFinding[] = [];
  const warnings: string[] = [];
  const rows: EntityExtensionListRow[] = [];
  const declaredTables = new Set<string>();

  for (const extension of context.extensions) {
    const { moduleId, origin, declaration, host } = extension;
    declaredTables.add(declaration.table);
    const candidates = rowsByTable.get(declaration.table) ?? [];
    const row = candidates.find((candidate) => candidate.host_table === host.table) ?? candidates[0];
    const base = {
      moduleId,
      origin,
      table: declaration.table,
      host: declaration.entity,
    };
    const record = (rule: EntityExtensionFinding['rule'] | null, detail: string, constraint: string | null): void => {
      if (rule !== null) findings.push({ ...base, rule, detail });
      rows.push({
        kind: 'entity-extension',
        moduleId,
        origin,
        host: declaration.entity,
        hostTable: host.table,
        table: declaration.table,
        constraint,
        status: rule === null ? 'verified' : `violation:${rule}`,
      });
    };

    if (row === undefined) {
      // P1 / P2 — the one extra statement per missing table, on the failure path only.
      const [present] = (await exec(`select to_regclass(?) as present`, [declaration.table])) as {
        present: unknown;
      }[];
      queries += 1;
      if (present?.present == null) {
        record(
          'table-missing',
          `the table does not exist; run migrate up (the declaring module's migration creates it), or remove the ` +
            'declaration',
          null,
        );
      } else {
        record(
          'foreign-key-missing',
          `no foreign key equal to its primary key references an extensible host; add ` +
            `foreign key (<key>) references "${host.table}" ("id") on delete cascade`,
          null,
        );
      }
      continue;
    }
    if (row.host_table !== host.table) {
      record(
        'foreign-key-missing',
        `its primary key references "${row.host_table}" through ${row.fk_name}, but it is declared on ` +
          `"${host.table}"; point the foreign key at "${host.table}" ("id") or correct the declaration`,
        row.fk_name,
      );
      continue;
    }
    if (!row.references_host_pk) {
      record(
        'foreign-key-missing',
        `its foreign key ${row.fk_name} references a column of "${host.table}" that is not its primary key; ` +
          `reference "${host.table}" ("id")`,
        row.fk_name,
      );
      continue;
    }
    if (row.on_delete !== 'c') {
      record(
        'foreign-key-not-cascade',
        `its foreign key ${row.fk_name} is on delete ${DELETE_ACTIONS[row.on_delete] ?? row.on_delete}; make it on ` +
          `delete cascade, so a deleted host leaves no orphan row`,
        row.fk_name,
      );
      continue;
    }
    record(null, '', row.fk_name);
  }

  for (const [table, candidates] of rowsByTable) {
    if (declaredTables.has(table)) continue;
    const row = candidates[0]!;
    const target = hostByTable.get(row.host_table);
    if (target === undefined) continue;
    const owner = context.tables?.get(table);
    // A 1:1 table the host's own module keeps is ordinary ownership (E4).
    if (owner?.moduleId === target.host.ownerModuleId) continue;
    const listRow = {
      kind: 'entity-extension' as const,
      host: target.reference,
      hostTable: target.host.table,
      table,
      constraint: row.fk_name,
    };
    if (owner !== undefined && owner.moduleId !== null) {
      const finding: EntityExtensionFinding = {
        rule: 'undeclared-entity-extension',
        moduleId: owner.moduleId,
        origin: owner.origin,
        table,
        host: target.reference,
        detail:
          `it is mapped by "${owner.className}" and keyed by ${target.reference}'s primary key, but not declared; ` +
          `add extends: [{ entity: '${target.reference}', table: '${table}' }] to "${owner.moduleId}"'s manifest` +
          (policy === 'warn' ? ' — it is refused from the next release' : ''),
      };
      if (policy === 'refuse') findings.push(finding);
      else warnings.push(`[entity-extensions] ${describeEntityExtensionFinding(finding)}`);
      rows.push({ ...listRow, moduleId: owner.moduleId, origin: owner.origin, status: 'undeclared' });
    } else {
      warnings.push(
        `[entity-extensions] ${describeEntityExtensionFinding({
          rule: 'unowned-entity-extension',
          moduleId: null,
          origin: null,
          table,
          host: target.reference,
          detail:
            'no composed module maps it — residue of a module removed without uninstall --hard; it is kept, ' +
            'and never refused',
        })}`,
      );
      rows.push({ ...listRow, moduleId: null, origin: null, status: 'unowned' });
    }
  }

  rows.sort((a, b) => a.host.localeCompare(b.host) || a.table.localeCompare(b.table));
  return { findings, warnings, rows, queries };
}

/**
 * Inspect, log the warnings, and throw {@link EntityExtensionDriftError} on any
 * finding. With nothing declared and no side table in the database it issues
 * the one catalog query and logs nothing — inert for a composition that
 * declares nothing.
 */
export async function verifyEntityExtensions(
  exec: SchemaExtensionExec,
  context: EntityExtensionContext,
  log: (message: string) => void = (message) => console.warn(message),
  options: EntityExtensionVerifyOptions = {},
): Promise<EntityExtensionReport> {
  const report = await inspectEntityExtensions(exec, context, options);
  for (const warning of report.warnings) log(warning);
  if (report.findings.length > 0) throw new EntityExtensionDriftError(report.findings);
  return report;
}
