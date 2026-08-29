/**
 * CI check — no module imports the container library (feature 072, T041 / FR-032).
 *
 * A module sees exactly one kernel surface: `ModuleContext`. It spells the
 * container's vocabulary through `ctx.asClass` / `ctx.asFunction` / `ctx.asValue`
 * and resolves through `ctx.cradle()`, so `awilix` stays confined to
 * `src/kernel/`. Two things depend on that:
 *
 *   1. **The container stays swappable.** 66 modules importing `awilix`
 *      directly is 66 files to touch the day it is replaced, and the seam stops
 *      being a seam.
 *   2. **The lifecycle gating of Constitution XVII holds by construction.** A
 *      module that reaches the container directly can register a route, a
 *      worker or a subscriber that never passes through `defineModuleRoutes`,
 *      `defineModuleWorker` or `subscribeForModule` — and nothing else in the
 *      tree would notice.
 *
 * Scope: every file under `src/modules/` and under a deployment overlay's
 * `src/apps/<deployment>/modules/` (feature 057 — an overlay module is an
 * ordinary lifecycle participant and the same rule applies to it).
 *
 * Static analysis through the TypeScript compiler API, so a mention in a
 * comment or a string is not a finding. Sits alongside
 * `check-kernel-boundary.ts` and `check-entry-scope.ts`.
 *
 * Usage: `tsx scripts/check-container-imports.ts [--list]`
 * Exit 0 = no module imports the container; exit 1 = at least one does.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  moduleIdOf,
  refuseVacuousModulePopulation,
  NO_HOST_RESIDENT_MODULES,
  type HostResidentModules,
} from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

/**
 * The container library. Matched on the package name, so a deep import
 * (`awilix/lib/…`) is caught too.
 */
const FORBIDDEN_PACKAGE = 'awilix';

export interface ContainerImportFinding {
  readonly file: string;
  readonly moduleId: string;
  readonly specifier: string;
  readonly line: number;
}

/** `awilix` itself or any of its subpaths — and nothing whose name merely starts with it. */
export function isContainerSpecifier(specifier: string): boolean {
  return specifier === FORBIDDEN_PACKAGE || specifier.startsWith(`${FORBIDDEN_PACKAGE}/`);
}

/**
 * The owning module id of a source file, over every root a module can live in.
 *
 * Three shapes, in order. The two anchored regexes answer for the application's
 * own trees — a deployment overlay first, then the core module tree — and both
 * key on `/src/`, so they say nothing about a module that has become a
 * **package** (feature 080, T040a). The third is `lib/module-population.ts`'
 * `moduleIdOf`, the same segment reader the population floor uses, and it is
 * what makes a path like `packages/modules/blog/src/services/x.ts` attribute to
 * `blog` instead of to nobody.
 *
 * That fallback is not cosmetic. Without it a package's files are read by the
 * walk, satisfy the floor, and are then attributed to `null` — which for every
 * consumer here means *not a module*, so the check judges none of them and
 * reports clean. That is issue #215's failure one layer in, and it is why
 * `resolveModuleLayout` refuses a package root whose location the segment
 * reader cannot attribute rather than letting it through unnamed.
 *
 * The fourth answer is `hostResident`, the map the layout derives from the
 * manifest index for a module whose sources the host owns and whose directory
 * therefore carries no `modules/<id>/` segment (feature 080, T040b). It is
 * threaded from `main` rather than left to default, for exactly the reason the
 * third shape exists: a file the walk reads and cannot name is a file this
 * check judges as nobody's and reports clean about.
 */
export function moduleOf(
  file: string,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
): string | null {
  const overlay = /\/src\/apps\/[^/]+\/modules\/([^/]+)\//.exec(file);
  if (overlay) return overlay[1] ?? null;
  const core = /\/src\/modules\/([^/]+)\//.exec(file);
  if (core) return core[1] ?? null;
  return moduleIdOf(file, hostResident);
}

/**
 * Every file the rule applies to, over the roots it is given.
 *
 * The roots are a **parameter and not a default** since feature 080's T040a:
 * they are `resolveModuleLayout().moduleWalkRoots` — the application's own
 * module trees, the deployment overlay tree, and every module that has become a
 * workspace package. A default spelled here would be the one caller that keeps
 * reading the old layout after the tree moves, which is the whole shape this
 * repository has now repaired three times.
 *
 * Exported so the check's own test can assert the **real** tree is clean, not
 * only that the analyzer can go red on a fixture. Both callers therefore agree
 * on the scan scope by construction.
 */
export function collectModuleFiles(roots: readonly string[]): string[] {
  return roots.flatMap((root) => walk(root));
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every import of the container library in `source`.
 *
 * Covers the four ways a specifier reaches a module: `import … from`,
 * `export … from`, `import(…)` and `require(…)`. A `import type { … }` is
 * **also** a finding: it erases at runtime, but it is still a module reading
 * the container's types instead of the kernel's, which is what the seam is for.
 */
export function analyzeSource(
  source: string,
  file: string,
  hostResident: HostResidentModules = NO_HOST_RESIDENT_MODULES,
): ContainerImportFinding[] {
  const moduleId = moduleOf(file, hostResident);
  if (moduleId === null) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings: ContainerImportFinding[] = [];

  const record = (specifier: ts.Node & { text: string }): void => {
    if (!isContainerSpecifier(specifier.text)) return;
    findings.push({
      file,
      moduleId,
      specifier: specifier.text,
      line: sf.getLineAndCharacterOfPosition(specifier.getStart(sf)).line + 1,
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node.moduleSpecifier);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require';
      const [first] = node.arguments;
      if ((isDynamicImport || isRequire) && first && ts.isStringLiteral(first)) {
        record(first);
      }
    }
    node.forEachChild(visit);
  };

  sf.forEachChild(visit);
  return findings;
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout('[container-imports]');
  const files = collectModuleFiles(layout.moduleWalkRoots);
  // `src/apps` is the second half of the scan and survives the module tree
  // moving: five overlay files were enough to clear an emptiness guard and let
  // the check print `module files=5 violations=0` (issue #215). The floor is
  // one file per registered module, read from the manifest index.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[container-imports]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });
  const findings = files.flatMap((f) =>
    analyzeSource(readFileSync(f, 'utf8'), f, layout.hostResidentModules),
  );
  const rel = layout.displayOf;

  if (listMode) {
    const modules = new Set(
      files
        .map((file) => moduleOf(file, layout.hostResidentModules))
        .filter((id): id is string => id !== null),
    );
    console.log(`[container-imports] scanning ${modules.size} modules`);
  }

  // What was read, beside what was found (issue #244). `module files` below is
  // the same number today; it is printed in the shared grammar so the ratchet
  // reads one shape across every check rather than twenty-four spellings.
  reportReadSize({ prefix: '[container-imports]', files: files.length, coverage: [coverage] });
  console.log(
    `[container-imports] module files=${files.length} violations=${findings.length}`,
  );

  if (findings.length > 0) {
    console.error(
      `\nModules importing '${FORBIDDEN_PACKAGE}'. A module sees only ModuleContext — ` +
        `use ctx.asClass / ctx.asFunction / ctx.asValue to register and ctx.cradle() to ` +
        `resolve. If the context does not expose what you need, that is a kernel change ` +
        `(src/kernel/module-context.ts), not a local import:`,
    );
    for (const f of findings) {
      console.error(`  - ${f.moduleId}: ${rel(f.file)}:${f.line} imports '${f.specifier}'`);
    }
  }

  process.exit(findings.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
