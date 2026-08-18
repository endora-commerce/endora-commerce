/**
 * CI check — Systemic Organization Tenant Scoping (feature 050, FR-012 / SC-001).
 *
 * Enumerates every MikroORM entity declared anywhere under `src/` — the file's
 * name is not part of the rule (issue #113) — and asserts
 * that each entity class carries EXACTLY ONE tenant-scope classification
 * decorator (`@OrgScoped`, `@CustomerScoped`, `@GlobalEntity`, `@TransitivelyScoped`,
 * `@RuleScoped`). A new tenant-owned entity added without a classification fails the
 * build, so it cannot silently escape the guard.
 *
 * Static analysis via the TypeScript compiler API — no DB, no new dependency
 * (`typescript` is already a devDependency). Sits alongside the existing
 * `i18n-hardcoded-strings.ts` / `generate-composer.ts` checks.
 *
 * Usage: `tsx scripts/check-entity-tenant-classification.ts [--list]`
 * Exit 0 = every entity classified; exit 1 = at least one unclassified.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { refuseVacuousModulePopulation } from './lib/module-population.js';

const CLASSIFICATION_DECORATORS = new Set([
  'OrgScoped',
  'CustomerScoped',
  'GlobalEntity',
  'TransitivelyScoped',
  'RuleScoped',
]);

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/**
 * Every `.ts` under `dir` except tests and declaration files.
 *
 * The walk used to collect `*.entity.ts` only. Nothing enforces that suffix, so
 * an entity declared anywhere else was not unclassified as far as this check was
 * concerned — it was unread, which a green run cannot be told apart from
 * (issue #113). {@link ENTITY_DECORATOR_HINT} decides what is worth parsing.
 */
export function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Only a file that spells `@Entity(` can declare one; the parse decides the rest. */
export const ENTITY_DECORATOR_HINT = /@Entity\s*\(/;

function decoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  const callee = ts.isCallExpression(expr) ? expr.expression : expr;
  return ts.isIdentifier(callee) ? callee.text : undefined;
}

export interface EntityFinding {
  file: string;
  className: string;
  classifications: string[];
}

/** Analyze a single TypeScript source string for MikroORM entities + their classification. Exported for tests. */
export function analyzeSource(source: string, file: string): EntityFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings: EntityFinding[] = [];
  sf.forEachChild((node) => {
    if (!ts.isClassDeclaration(node)) return;
    const decorators = ts.getDecorators(node) ?? [];
    const names = decorators.map(decoratorName).filter((n): n is string => Boolean(n));
    if (!names.includes('Entity')) return; // only MikroORM entities
    const classifications = names.filter((n) => CLASSIFICATION_DECORATORS.has(n));
    findings.push({ file, className: node.name?.text ?? '<anonymous>', classifications });
  });
  return findings;
}

function analyzeFile(file: string): EntityFinding[] {
  return analyzeSource(readFileSync(file, 'utf8'), file);
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const files = walk(SRC_ROOT);
  // 216 of the 221 entities in the tree are a module's. `src/` minus
  // `src/modules` still holds the kernel's five, so an emptiness guard passes
  // on the residue and the check reports every entity classified — over a tree
  // it did not read (issue #215). The expectation is per registered module and
  // comes from the manifest index.
  await refuseVacuousModulePopulation({
    prefix: '[tenant-classification]',
    srcRoot: SRC_ROOT,
    files,
  });
  const entityFiles = files.filter((f) => ENTITY_DECORATOR_HINT.test(readFileSync(f, 'utf8')));
  const findings = entityFiles.flatMap(analyzeFile);
  if (findings.length === 0) {
    console.error(
      '[tenant-classification] no entities found in a tree that has hundreds — ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  const unclassified = findings.filter((f) => f.classifications.length === 0);
  const multi = findings.filter((f) => f.classifications.length > 1);
  const classified = findings.filter((f) => f.classifications.length === 1);

  const rel = (p: string) => p.replace(`${SRC_ROOT}/`, 'src/');

  if (listMode) {
    for (const f of findings) {
      const tag =
        f.classifications.length === 1
          ? (f.classifications[0] ?? 'UNCLASSIFIED')
          : f.classifications.length === 0
            ? 'UNCLASSIFIED'
            : `MULTIPLE(${f.classifications.join(',')})`;
      console.log(`${tag.padEnd(18)} ${f.className}  (${rel(f.file)})`);
    }
    console.log('');
  }

  console.log(
    `[tenant-classification] sources=${files.length} entity files=${entityFiles.length} ` +
      `entities=${findings.length} classified=${classified.length} ` +
      `unclassified=${unclassified.length} multiple=${multi.length}`,
  );

  if (unclassified.length > 0) {
    console.error('\nUnclassified entities (add one of @OrgScoped/@CustomerScoped/@GlobalEntity/@TransitivelyScoped/@RuleScoped):');
    for (const f of unclassified) console.error(`  - ${f.className}  (${rel(f.file)})`);
  }
  if (multi.length > 0) {
    console.error('\nEntities with more than one classification (keep exactly one):');
    for (const f of multi) console.error(`  - ${f.className}: ${f.classifications.join(', ')}  (${rel(f.file)})`);
  }

  process.exit(unclassified.length === 0 && multi.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
