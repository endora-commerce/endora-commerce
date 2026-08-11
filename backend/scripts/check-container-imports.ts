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
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

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
 * The owning module id, or `null` when the file is not part of a module.
 *
 * Both roots are recognised: the shared core tree and a deployment overlay's
 * own module tree.
 */
export function moduleOf(file: string): string | null {
  const overlay = /\/src\/apps\/[^/]+\/modules\/([^/]+)\//.exec(file);
  if (overlay) return overlay[1] ?? null;
  const core = /\/src\/modules\/([^/]+)\//.exec(file);
  if (core) return core[1] ?? null;
  return null;
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
export function analyzeSource(source: string, file: string): ContainerImportFinding[] {
  const moduleId = moduleOf(file);
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

function main(): void {
  const listMode = process.argv.includes('--list');
  const files = [...walk(join(SRC_ROOT, 'modules')), ...walk(join(SRC_ROOT, 'apps'))];
  const findings = files.flatMap((f) => analyzeSource(readFileSync(f, 'utf8'), f));
  const rel = (p: string): string => p.replace(`${SRC_ROOT}/`, 'src/');

  if (listMode) {
    const modules = new Set(files.map(moduleOf).filter((id): id is string => id !== null));
    console.log(`[container-imports] scanning ${modules.size} modules`);
  }

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
  main();
}
