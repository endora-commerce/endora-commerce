/**
 * CI check — Systemic Organization Tenant Scoping (feature 050, FR-012 / SC-001).
 *
 * Enumerates every `*.entity.ts` under `src/modules/**` and `src/db/**` and asserts
 * that each MikroORM entity class carries EXACTLY ONE tenant-scope classification
 * decorator (`@OrgScoped`, `@CustomerScoped`, `@GlobalEntity`, `@TransitivelyScoped`,
 * `@RuleScoped`). A new tenant-owned entity added without a classification fails the
 * build, so it cannot silently escape the guard.
 *
 * Static analysis via the TypeScript compiler API — no DB, no new dependency
 * (`typescript` is already a devDependency). Sits alongside the existing
 * `i18n-hardcoded-strings.ts` / `generate-manifest-index.ts` checks.
 *
 * Usage: `tsx scripts/check-entity-tenant-classification.ts [--list]`
 * Exit 0 = every entity classified; exit 1 = at least one unclassified.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const CLASSIFICATION_DECORATORS = new Set([
  'OrgScoped',
  'CustomerScoped',
  'GlobalEntity',
  'TransitivelyScoped',
  'RuleScoped',
]);

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.entity.ts')) {
      out.push(full);
    }
  }
  return out;
}

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

function main(): void {
  const listMode = process.argv.includes('--list');
  const files = walk(SRC_ROOT);
  const findings = files.flatMap(analyzeFile);

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
    `[tenant-classification] entities=${findings.length} classified=${classified.length} ` +
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
  main();
}
