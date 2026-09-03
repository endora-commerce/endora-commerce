/**
 * `cms block-names` — the operator's pre-flight report for the block-name
 * migration (feature 096, T410; `contracts/block-name-migration.md` §7).
 *
 *     pnpm --filter backend run cli -- block-names
 *
 * **It writes nothing, and read-only is the whole point**: the operator runs it
 * on a production database *before* they have decided to upgrade. There is no
 * `update`, no `insert` and no ORM flush anywhere below, and the walk it uses is
 * the migration's own — `mapBlockNames` with a visitor that returns `undefined`
 * for every name, which is what makes the read-only property structural rather
 * than a discipline.
 *
 * ## It is the same derivation read twice
 *
 * The same command, the same walk and the same frozen map answer before and
 * after the upgrade. The operator's confidence comes from the **diff** — every
 * *will be renamed* becomes *already namespaced*, and the *unrecognised* set is
 * unchanged in size and membership — not from two programs agreeing. Writing a
 * separate post-migration verifier would be two derivations of one population.
 *
 * ## The classification, and why its order is stated
 *
 * Membership of `FROZEN_BLOCK_RENAMES` first, then `isNamespaced`, otherwise
 * unrecognised. The first two cannot both hold — every key of the map is bare —
 * so the order is a statement about reading rather than a precedence rule.
 * `isNamespaced` is the **strict** test, so a malformed dotted name
 * (`acme.banner`, a fork's own spelling) classifies as *unrecognised* and is
 * named to the operator rather than waved through: that is the ruling of
 * 2026-09-02, and it is why the report, not the migration, is where the grammar
 * is consulted.
 *
 * ## It reads eleven columns across five modules, and that is stated rather
 * than smuggled
 *
 * It is read-only, it is an operator tool rather than a runtime path, and the
 * honest alternative — five separate commands the operator must run and collate
 * — gives five partial answers to one question. The strict-reading alternative,
 * a report **port** each of the five modules provides and `cms` aggregates,
 * costs five port registrations and five manifest edges to produce identical
 * output; it is recorded here so the choice is visible rather than assumed
 * (`contracts/block-name-migration.md` §7).
 */
import type { ModuleCliCommandContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { isNamespaced } from '@endora-commerce/page-builder-core/block-name';
import {
  FROZEN_BLOCK_RENAMES,
  countBlockNames,
} from '@endora-commerce/page-builder-core/migration';

/**
 * The eleven columns, with the module that owns each table.
 *
 * Written here rather than derived, and the reason is that there is nothing to
 * derive it *from*: a `jsonb` column carrying a Puck tree is not distinguishable
 * from any other `jsonb` column by the schema, and a heuristic ("every jsonb
 * column named `content`") would answer for whichever columns happen to be
 * named that today. The list is held to the migrations that rewrite the same
 * columns by `backend/test/unit/cms/block-name-report.test.ts`, which reads
 * both and refuses a disagreement in either direction — so a sixth column added
 * to a migration and not here fails, and vice versa.
 */
export const BLOCK_NAME_COLUMNS: ReadonlyArray<{
  readonly module: string;
  readonly table: string;
  readonly column: string;
}> = [
  { module: 'cms', table: 'cms_pages', column: 'content' },
  { module: 'cms', table: 'cms_blocks', column: 'content' },
  { module: 'cms', table: 'cms_templates', column: 'content' },
  { module: 'blog', table: 'blog_posts', column: 'content' },
  { module: 'blog', table: 'blog_categories', column: 'description' },
  { module: 'transactional_emails', table: 'email_templates', column: 'content' },
  { module: 'transactional_emails', table: 'email_blocks', column: 'content' },
  { module: 'transactional_emails', table: 'transactional_email_contents', column: 'content' },
  { module: 'newsletter', table: 'newsletter_campaigns', column: 'content' },
  { module: 'newsletter', table: 'newsletter_email_blocks', column: 'content' },
  { module: 'invoices', table: 'invoice_templates', column: 'content' },
];

export type BlockNameClassification = 'will-be-renamed' | 'already-namespaced' | 'unrecognised';

export interface BlockNameFinding {
  readonly table: string;
  readonly column: string;
  readonly name: string;
  /** Node occurrences, not rows. */
  readonly occurrences: number;
  readonly rows: number;
  readonly classification: BlockNameClassification;
  /** The name this one becomes, for `will-be-renamed` and nothing else. */
  readonly becomes?: string;
}

/** The three-way classification. See the header for why the order is stated. */
export function classifyBlockName(name: string): {
  classification: BlockNameClassification;
  becomes?: string;
} {
  const renamed = FROZEN_BLOCK_RENAMES[name];
  if (renamed !== undefined) return { classification: 'will-be-renamed', becomes: renamed };
  if (isNamespaced(name)) return { classification: 'already-namespaced' };
  return { classification: 'unrecognised' };
}

/**
 * Read one column and classify every distinct block name in it.
 *
 * A missing table answers an empty list rather than throwing: an operator may
 * run this against a deployment that has never installed one of the five
 * modules, and "no rows" is the honest answer for a table that is not there.
 */
export async function scanColumn(
  em: EntityManager,
  table: string,
  column: string,
): Promise<BlockNameFinding[]> {
  const exists = await em
    .getConnection()
    .execute<Array<{ present: boolean }>>(
      `select to_regclass('public.${table}') is not null as present`,
    );
  if (!exists[0]?.present) return [];

  const rows = await em
    .getConnection()
    .execute<Array<Record<string, unknown>>>(
      `select "${column}" as doc from "${table}" where "${column}" is not null`,
    );

  const occurrences = new Map<string, number>();
  const affectedRows = new Map<string, number>();
  for (const row of rows) {
    const counts = countBlockNames(row['doc']);
    for (const [name, count] of counts) {
      occurrences.set(name, (occurrences.get(name) ?? 0) + count);
      affectedRows.set(name, (affectedRows.get(name) ?? 0) + 1);
    }
  }

  return [...occurrences.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, count]) => {
      const { classification, becomes } = classifyBlockName(name);
      return {
        table,
        column,
        name,
        occurrences: count,
        rows: affectedRows.get(name) ?? 0,
        classification,
        ...(becomes !== undefined ? { becomes } : {}),
      };
    });
}

/** Every column, in declaration order. */
export async function scanAllColumns(em: EntityManager): Promise<BlockNameFinding[]> {
  const out: BlockNameFinding[] = [];
  for (const { table, column } of BLOCK_NAME_COLUMNS) {
    out.push(...(await scanColumn(em, table, column)));
  }
  return out;
}

interface BlockNamesCradle {
  readonly emFactory: () => EntityManager;
}

export async function blockNames({
  ctx,
  out,
}: ModuleCliCommandContext<ModuleContext>): Promise<number> {
  const em = ctx.cradle<BlockNamesCradle>().emFactory();
  const findings = await scanAllColumns(em);

  out('[block-names] Page Builder block names stored in this database.');
  out('');

  let lastColumn = '';
  const totals: Record<BlockNameClassification, number> = {
    'will-be-renamed': 0,
    'already-namespaced': 0,
    unrecognised: 0,
  };

  for (const { table, column } of BLOCK_NAME_COLUMNS) {
    const forColumn = findings.filter((f) => f.table === table && f.column === column);
    const key = `${table}.${column}`;
    if (key !== lastColumn) {
      out(`${key}`);
      lastColumn = key;
    }
    if (forColumn.length === 0) {
      out('  (no block names)');
      out('');
      continue;
    }
    for (const finding of forColumn) {
      totals[finding.classification] += 1;
      const arrow = finding.becomes ? ` -> ${finding.becomes}` : '';
      out(
        `  ${finding.name.padEnd(34)} ${String(finding.occurrences).padStart(6)} nodes ` +
          `${String(finding.rows).padStart(5)} rows  ${finding.classification}${arrow}`,
      );
    }
    const summary = (kind: BlockNameClassification): number =>
      forColumn.filter((f) => f.classification === kind).length;
    out(
      `  -- ${forColumn.length} distinct: ${summary('will-be-renamed')} will be renamed, ` +
        `${summary('already-namespaced')} already namespaced, ` +
        `${summary('unrecognised')} unrecognised`,
    );
    out('');
  }

  out(
    `[block-names] total distinct (name, column) pairs: ` +
      `${totals['will-be-renamed']} will be renamed, ` +
      `${totals['already-namespaced']} already namespaced, ` +
      `${totals['unrecognised']} unrecognised`,
  );
  if (totals.unrecognised > 0) {
    out(
      '[block-names] An unrecognised name is left byte-identical by the migration and is ' +
        'never a failure. It then renders as the missing-component placeholder in the admin ' +
        'and as nothing on the storefront — resolve it, or accept that degradation, before ' +
        'upgrading.',
    );
  }
  return 0;
}
