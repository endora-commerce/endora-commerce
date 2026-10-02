import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { classifyWorkspaceMembers } from '@endora-commerce/cli/lib/workspace-packages.js';

import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import { nodeManifestFs } from '../../../scripts/lib/module-package-manifest.js';

/**
 * An optional peer a library package imports at runtime is one some other
 * published package shares — or it is a private dependency in disguise.
 *
 * ## The defect this was written from
 *
 * `@endora-commerce/cms-components` declared the eight Tiptap packages and
 * `leaflet` as **optional peers** while its root barrel imports Tiptap
 * statically and its `Map` component imports `leaflet` dynamically. pnpm never
 * installs an optional peer, so an instance scaffolded with `--module cms`
 * from a host where `cms-components` was not installed beside the CLI wrote no
 * Tiptap entry anywhere, and its admin build stopped on
 * `"TextStyle" is not exported by "__vite-optional-peer-dep:@tiptap/extension-text-style:…"`.
 * `endora new instance` supplies the optional peers of the packages it can
 * read (`new-instance/index.ts`' `composedOptionalPeers`), and it cannot read a
 * package that is not installed — so a peer that no package the CLI always
 * reads ever mentions reaches the instance by luck.
 *
 * ## The rule, and why it is "shared" rather than a list
 *
 * A peer exists so a host and several packages bind **one** copy: React, the
 * page builder's `@measured/puck`, the router. Those are named by many
 * published packages — module packages included, which the CLI always reads —
 * so an instance that composes any of them declares them. A name that only one
 * package in the whole published estate mentions shares nothing with anyone,
 * and declaring it optional only means nobody installs it. That is a
 * `dependency` of the package that imports it.
 *
 * The population is the library family minus the module packages: a module
 * package's peers are written by `manifests:generate`, which marks a peer
 * optional precisely when only a UI layer reaches it, and its UI peers are
 * shared by construction.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

interface Member {
  readonly dir: string;
  readonly name: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

function publishedFamily(): readonly Member[] {
  return classifyWorkspaceMembers(repoRoot!, nodeManifestFs()).members.filter(
    (member) => member.family && member.manifest['private'] !== true,
  );
}

function isModulePackage(member: Member): boolean {
  const endora = member.manifest['endora'];
  return (
    typeof endora === 'object' &&
    endora !== null &&
    (endora as Record<string, unknown>)['type'] === 'module'
  );
}

function namesIn(member: Member, field: string): readonly string[] {
  const block = member.manifest[field];
  return block !== null && typeof block === 'object' ? Object.keys(block) : [];
}

function optionalPeersOf(member: Member): ReadonlySet<string> {
  const meta = member.manifest['peerDependenciesMeta'];
  const optional = new Set<string>();
  if (meta === null || typeof meta !== 'object') return optional;
  for (const [name, value] of Object.entries(meta as Record<string, unknown>)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      (value as Record<string, unknown>)['optional'] === true &&
      namesIn(member, 'peerDependencies').includes(name)
    ) {
      optional.add(name);
    }
  }
  return optional;
}

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`; relative paths → `null`. */
function packageNameOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return null;
  }
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/** Every non-test source file under `src/`. */
function sourceFiles(dir: string): readonly string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry) || /\.d\.ts$/.test(entry) || /\.test\.tsx?$/.test(entry)) {
        continue;
      }
      found.push(path);
    }
  };
  walk(join(dir, 'src'));
  return found;
}

/**
 * The packages a source file loads **at runtime**: value imports, re-exports
 * and dynamic `import()`. Type-only forms — `import type`, `export type`, and
 * `import('x').T` in a type position — are erased by the compiler and bundle
 * nothing, so they are not counted.
 */
function runtimeImportsOf(fileName: string, text: string): readonly string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const add = (specifier: ts.Expression | undefined): void => {
    if (specifier === undefined || !ts.isStringLiteral(specifier)) return;
    const name = packageNameOf(specifier.text);
    if (name !== null) names.add(name);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((element) => element.isTypeOnly)));
      if (!typeOnly) add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly) add(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...names];
}

describe('runtimeImportsOf', () => {
  it('counts value imports, re-exports and dynamic imports, and skips type-only forms', () => {
    const text = [
      "import { a } from '@scope/value/sub';",
      "import type { B } from 'type-only';",
      "import { type C } from 'inline-type-only';",
      "import { type D, e } from 'mixed';",
      "export * from 'reexported';",
      "export type { F } from 'type-reexport';",
      "import './relative.js';",
      "type G = import('type-position').G;",
      "async function h() { await import('dynamic'); }",
    ].join('\n');
    expect([...runtimeImportsOf('x.ts', text)].sort()).toEqual([
      '@scope/value',
      'dynamic',
      'mixed',
      'reexported',
    ]);
  });
});

describe('a library package imports no optional peer that no other published package shares', () => {
  it('derives a population that includes the UI library packages', () => {
    expect(repoRoot).not.toBeNull();
    const names = publishedFamily()
      .filter((member) => !isModulePackage(member))
      .map((member) => member.name);
    expect(names).toContain('@endora-commerce/cms-components');
    expect(names).toContain('@endora-commerce/page-builder-core');
  });

  it('declares every privately-held runtime import as a dependency, not an optional peer', () => {
    const family = publishedFamily();
    const modulePackageNames = new Set(family.filter(isModulePackage).map((member) => member.name));
    const unshared: string[] = [];
    for (const member of family.filter((candidate) => !isModulePackage(candidate))) {
      const optional = optionalPeersOf(member);
      if (optional.size === 0) continue;
      const imported = new Set(
        sourceFiles(member.dir).flatMap((file) =>
          runtimeImportsOf(file, readFileSync(file, 'utf8')),
        ),
      );
      for (const name of [...optional].sort()) {
        if (!imported.has(name)) continue;
        // A peer that is itself a **module package** is the one kind the rule
        // does not reach, and by derivation rather than by name. The defect
        // above is a peer nothing installs; a module package is installed by
        // the instance's own module list — the root manifest, which is where
        // the module set lives and the only place it may (R3.6), and the reason
        // `composedOptionalPeers` skips module packages in as many words. So an
        // optional module peer means "if this instance chose that module", which
        // is what `@endora-commerce/demo-composition` says of each module a step
        // of its wires: the step is guarded on the module's presence and loads
        // the package only then. Making those `dependencies` would install
        // modules an instance did not choose.
        if (modulePackageNames.has(name)) continue;
        const sharedBy = family.filter(
          (other) =>
            other.name !== member.name &&
            [...namesIn(other, 'dependencies'), ...namesIn(other, 'peerDependencies')].includes(
              name,
            ),
        );
        if (sharedBy.length === 0) unshared.push(`${member.name} → ${name}`);
      }
    }
    // The exemption above must not be able to swallow the population: a
    // workspace that classified no module package would exempt nothing, and one
    // that classified everything as one would exempt the UI peers too.
    expect(modulePackageNames.size).toBeGreaterThan(0);
    expect(modulePackageNames.has('@endora-commerce/cms-components')).toBe(false);
    expect(unshared).toEqual([]);
  });
});
