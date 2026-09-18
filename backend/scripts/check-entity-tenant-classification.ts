/**
 * CI check — Systemic Organization Tenant Scoping (feature 050, FR-012 / SC-001).
 * **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/entity-tenant-classification.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts) and its header carries the whole reasoning — including why the
 * package host reads the *emitted* artefact where this one reads decorated
 * source. This file supplies this repository's source roots, its
 * module-population floor and the installed-package half below; `endora check`
 * supplies one package's.
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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  analyzeSource,
  classifyFindings,
  CLASSIFICATION_DECORATOR_NAMES,
  ENTITY_DECORATOR_HINT,
  packageEntityFindings,
  PREFIX,
  remedyFor,
  walk,
  type EntityFinding,
} from '@endora-commerce/cli/rules/entity-tenant-classification.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import {
  loadPackageDeclarations,
  packageCoverage,
  refuseUnreadablePackages,
} from './lib/package-declarations.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';
import { requireModuleLayout } from './lib/module-roots.js';

export * from '@endora-commerce/cli/rules/entity-tenant-classification.js';

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

function analyzeFile(file: string): EntityFinding[] {
  return analyzeSource(readFileSync(file, 'utf8'), file);
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  // Both roots, derived (feature 080, T040a). A packaged module's entities are
  // already held to this rule through its published artefact (T034); this is
  // the other half — the same module's *sources*, once they leave `src`.
  const layout = await requireModuleLayout(PREFIX);
  const files = layout.sourceRoots.flatMap((root) => walk(root));
  // 216 of the 221 entities in the tree are a module's. `src/` minus
  // `src/modules` still holds the kernel's five, so an emptiness guard passes
  // on the residue and the check reports every entity classified — over a tree
  // it did not read (issue #215). The expectation is per registered module and
  // comes from the manifest index.
  const coverage = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });
  const entityFiles = files.filter((f) => ENTITY_DECORATOR_HINT.test(readFileSync(f, 'utf8')));
  const treeFindings = entityFiles.flatMap(analyzeFile);
  if (treeFindings.length === 0) {
    console.error(
      `${PREFIX} no entities found in a tree that has hundreds — ` +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  // The other half of the platform (T034). Zero-cost and byte-for-byte inert on
  // a checkout that installed no module package; a package whose entities cannot
  // be enumerated stops the run rather than being credited with none.
  const packages = await loadPackageDeclarations();
  refuseUnreadablePackages(PREFIX, packages);
  const findings = [...treeFindings, ...packageEntityFindings(packages.entities)];

  // The predicate itself, in the one place it is written — the package host
  // calls the same function over the same shape (§6).
  const { classified, unclassified, multiple: multi } = classifyFindings(findings);

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
    prefix: PREFIX,
    files: files.length + packages.filesRead,
    sites: findings.length,
    coverage: coverages,
  });
  console.log(
    `${PREFIX} sources=${files.length} entity files=${entityFiles.length} ` +
      `entities=${findings.length} classified=${classified.length} ` +
      `unclassified=${unclassified.length} multiple=${multi.length} ` +
      `packages=${packages.discovered} package entities=${packages.entities.length}`,
  );

  if (unclassified.length > 0) {
    console.error(
      `\nUnclassified entities (add one of @${CLASSIFICATION_DECORATOR_NAMES.join('/@')}):`,
    );
    for (const f of unclassified) console.error(`  - ${remedyFor(f)}  (${rel(f.file)})`);
  }
  if (multi.length > 0) {
    console.error('\nEntities with more than one classification (keep exactly one):');
    for (const f of multi) console.error(`  - ${remedyFor(f)}  (${rel(f.file)})`);
  }

  process.exit(unclassified.length === 0 && multi.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
