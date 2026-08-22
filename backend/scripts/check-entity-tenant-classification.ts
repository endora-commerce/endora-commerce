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
 * ## Installed packages (feature 080, T034)
 *
 * `src/` stopped being the whole platform when T031 landed: a module can arrive
 * as an npm package installed into the instance's `node_modules`, and D-106.2
 * lets that package ship persisted entities. A tree walk cannot see one — a
 * published package ships compiled output, and the decorated source text this
 * check greps for is gone from it — so until this row, **a third party could
 * ship a persisted entity carrying no tenant-scope decorator and this check
 * reported every entity classified.** That is Principle XI, which is
 * non-negotiable, defeated by a silence.
 *
 * So the population is `src/` **plus** every entity class the installed packages
 * declare, read out of the artefact by `scripts/lib/package-declarations.ts` —
 * the same `./backend` export the platform composes, and the classification read
 * from the same runtime registry the global filters are built from.
 *
 * **What it does when it cannot attribute one: it refuses.** There is no
 * "unattributed package" state here. A discovered package whose declarations
 * cannot be enumerated in full stops the run with exit 2, naming the package and
 * what could not be read, because the alternative is the silence above wearing a
 * new hat. A package that publishes no `./backend` and no `./migrations` is a
 * different thing and is read as owning nothing — that is the package's own
 * `exports` map speaking, not this check guessing.
 *
 * Usage: `tsx scripts/check-entity-tenant-classification.ts [--list]`
 * Exit 0 = every entity classified; exit 1 = at least one unclassified;
 * exit 2 = the walk read a residue of the module tree, no entity at all, or an
 * installed package whose entities it could not enumerate.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import {
  loadPackageDeclarations,
  packageCoverage,
  refuseUnreadablePackages,
  type PackageEntity,
} from './lib/package-declarations.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';
import { requireModuleLayout } from './lib/module-roots.js';

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

/**
 * An installed package's entity classes, in the same shape a source walk
 * produces (feature 080, T034).
 *
 * The rule is one rule: exactly one classification, whatever the entity arrived
 * in. Keeping the two populations in one shape is what makes that true of the
 * code as well as of the sentence — the counting, the `--list` output and the
 * failure report all run over one array.
 *
 * `file` is the resolved artefact the class was imported from, so the message
 * points at something the reader can open. Exported so a red proof can enter
 * here with a package entity rather than with a finished report.
 */
export function packageEntityFindings(
  entities: readonly PackageEntity[],
): EntityFinding[] {
  return entities.map((entity) => ({
    file: entity.file,
    className: `${entity.className} (${entity.packageName})`,
    classifications: [...entity.classifications],
  }));
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  // Both roots, derived (feature 080, T040a). A packaged module's entities are
  // already held to this rule through its published artefact (T034); this is
  // the other half — the same module's *sources*, once they leave `src`.
  const layout = await requireModuleLayout('[tenant-classification]');
  const files = layout.sourceRoots.flatMap((root) => walk(root));
  // 216 of the 221 entities in the tree are a module's. `src/` minus
  // `src/modules` still holds the kernel's five, so an emptiness guard passes
  // on the residue and the check reports every entity classified — over a tree
  // it did not read (issue #215). The expectation is per registered module and
  // comes from the manifest index.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[tenant-classification]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });
  const entityFiles = files.filter((f) => ENTITY_DECORATOR_HINT.test(readFileSync(f, 'utf8')));
  const treeFindings = entityFiles.flatMap(analyzeFile);
  if (treeFindings.length === 0) {
    console.error(
      '[tenant-classification] no entities found in a tree that has hundreds — ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  // The other half of the platform (T034). Zero-cost and byte-for-byte inert on
  // a checkout that installed no module package; a package whose entities cannot
  // be enumerated stops the run rather than being credited with none.
  const packages = await loadPackageDeclarations();
  refuseUnreadablePackages('[tenant-classification]', packages);
  const findings = [...treeFindings, ...packageEntityFindings(packages.entities)];

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

  // What was read, in the shared grammar (issue #244). The entity classes are
  // this check's finer population: the file count stayed at 1459 through the
  // module-tree move that broke the attribution, and only a per-site number
  // would have moved with it.
  const installed = packageCoverage(packages);
  const coverages: ReadCoverage[] = installed === null ? [coverage] : [coverage, installed];
  reportReadSize({
    prefix: '[tenant-classification]',
    files: files.length + packages.filesRead,
    sites: findings.length,
    coverage: coverages,
  });
  console.log(
    `[tenant-classification] sources=${files.length} entity files=${entityFiles.length} ` +
      `entities=${findings.length} classified=${classified.length} ` +
      `unclassified=${unclassified.length} multiple=${multi.length} ` +
      `packages=${packages.discovered} package entities=${packages.entities.length}`,
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
