import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { sqlWriteTargets } from '@endora-commerce/platform/db';

import { declaredIndexes, sqlTableAccesses } from '../../../scripts/lib/sql-tables.js';
import { resolveModuleLayout } from '../../../scripts/lib/module-roots.js';

/**
 * `specs/178-extensible-columns/` FR-070 (tasks.md T062,
 * `contracts/foreign-schema-guard.md` §2) — the platform's runtime classifier
 * of write targets and `check:module-boundary`'s compile-time one agree.
 *
 * Two classifiers of one question are two answers waiting to disagree (plan,
 * Complexity Tracking). `sqlWriteTargets` reads statement **text** at `migrate`
 * time, in an instance with no `typescript`; `sqlTableAccesses` reads the
 * **source** of the same migrations for R1/R2. Over every first-party migration
 * file the two must name the same written tables, per file.
 *
 * The runtime classifier is fed exactly what a migration would hand to
 * `addSql` / `execute`: each string and template literal of the file, a
 * template's substitutions standing in as `?` — the same splice
 * `sqlTableAccesses` reads. Two differences are definitional and applied to
 * its side, both stated where they are applied: a table the same file
 * `create`s is not an *existing* table for DDL (`sqlTableAccesses`' rule, which
 * the runtime guard meets differently — by adding the table to the module's
 * own), and `drop index` is resolved through the indexes every migration
 * declares, as the compile-time side resolves it. Knex **builders** are left
 * out of the comparison: at run time they are rendered SQL and judged as text,
 * and the count of builder writes is asserted to stay what it is, so a builder
 * appearing in a migration is a conscious edit here.
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..', '..', '..');

interface MigrationFile {
  readonly file: string;
  readonly text: string;
}

async function firstPartyMigrations(): Promise<MigrationFile[]> {
  const layout = await resolveModuleLayout();
  const directories = [join(REPO, 'packages', 'platform', 'src', 'migrations')];
  for (const moduleId of layout.registeredIds) {
    const root = layout.moduleDirectoryOf(moduleId);
    if (root === null) continue;
    for (const candidate of [join(root, 'src', 'migrations'), join(root, 'migrations')]) {
      if (existsSync(candidate)) directories.push(candidate);
    }
  }
  const files: MigrationFile[] = [];
  for (const directory of [...new Set(directories)]) {
    for (const name of readdirSync(directory).sort()) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name === 'index.ts') continue;
      const file = join(directory, name);
      const text = readFileSync(file, 'utf8');
      if (!/export class Migration\w+/.test(text)) continue;
      files.push({ file, text });
    }
  }
  return files;
}

/** Every string / template literal's text, substitutions as `?` — what reaches `addSql`. */
function literalTexts(text: string, file: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) {
      let spliced = node.head.text;
      for (const span of node.templateSpans) spliced += ` ? ${span.literal.text}`;
      out.push(spliced);
    }
    node.forEachChild(visit);
  };
  source.forEachChild(visit);
  return out;
}

const DDL_VERBS = new Set(['alter', 'index', 'drop', 'drop-index', 'comment', 'trigger', 'rule']);

describe('sqlWriteTargets ≡ sqlTableAccesses over first-party migrations', async () => {
  const migrations = await firstPartyMigrations();
  const indexTables = new Map<string, string>();
  for (const { file, text } of migrations) {
    for (const { index, table } of declaredIndexes(text, file)) indexTables.set(index, table);
  }

  it('walks the whole first-party migration corpus', () => {
    expect(migrations.length).toBeGreaterThan(250);
  });

  it('names the same written tables, file by file', () => {
    const differences: string[] = [];
    let builderWrites = 0;
    for (const { file, text } of migrations) {
      const compile = new Set<string>();
      for (const access of sqlTableAccesses(text, file, { ddl: true, indexTables })) {
        if (access.direction !== 'write') continue;
        if (access.syntax === 'builder') {
          builderWrites += 1;
          continue;
        }
        compile.add(access.table);
      }

      const targets = literalTexts(text, file).flatMap((literal) => sqlWriteTargets(literal));
      const created = new Set(targets.filter((target) => target.verb === 'create').map((target) => target.table!));
      const runtime = new Set<string>();
      for (const target of targets) {
        if (target.verb === 'create') continue;
        const table = target.table ?? (target.index === undefined ? undefined : indexTables.get(target.index));
        if (table === undefined) continue;
        // A quoted template substitution (`"${table}"` spliced as `" ? "`) is
        // no identifier at all: at run time the guard reads the real name.
        if (!/^[a-z_][a-z0-9_]*$/.test(table)) continue;
        if (DDL_VERBS.has(target.verb) && created.has(table)) continue;
        runtime.add(table);
      }

      const onlyCompile = [...compile].filter((table) => !runtime.has(table)).sort();
      const onlyRuntime = [...runtime].filter((table) => !compile.has(table)).sort();
      if (onlyCompile.length > 0 || onlyRuntime.length > 0) {
        differences.push(
          `${relative(REPO, file)}: only sqlTableAccesses [${onlyCompile.join(', ')}], ` +
            `only sqlWriteTargets [${onlyRuntime.join(', ')}]`,
        );
      }
    }
    expect(differences, differences.join('\n')).toEqual([]);
    expect(builderWrites).toBe(0);
  });
});
