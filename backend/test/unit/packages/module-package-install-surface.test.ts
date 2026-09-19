import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import { discoverModulePackages } from '../../../scripts/lib/module-packages.js';
import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import { FOREIGN_CONSUMPTION_SUBPATHS } from '../../../scripts/lib/module-package-manifest.js';

/**
 * R11 of `specs/084-small-f4-package-layout/contracts/module-package-layout.md`,
 * and the owner ruling of 2026-09-19 — a module package publishes the factories a
 * **foreign** `installHook` constructs on a `./install` subpath, and R4 admits the
 * value reach there.
 *
 * ## What this file is for, and it is not coverage
 *
 * `FOREIGN_CONSUMPTION_SUBPATHS` is the second admission R4 has ever made, and the
 * open question about it is not whether it works — `manifests:check` answers that
 * — but whether it stays a **criterion** or becomes a list somebody appends to.
 * So the membership is pinned to exactly two names here: a third arrives with a
 * merge request that has to argue R11's four conditions in front of a red test,
 * rather than as a line in a diff nobody reads twice.
 *
 * The three properties below are the ones the ruling makes load-bearing and that
 * nothing else in the estate measures:
 *
 *  1. **Only factories leave by this door, and the layer holds no behaviour.** The
 *     rule is a rule rather than a style, and the reason is the partial write: an
 *     install hook does **not** run inside a database transaction, so a hook that
 *     raises half-way leaves what it already wrote. Measured while W7 was written
 *     — a raise inside `bindToDefaultChannel` left the first of two seeded rows
 *     behind and never wrote the second. Every behaviour added on this path is a
 *     new instance of that, and it also escapes the place where the write's tests,
 *     its `command-coverage-ignore` classification and its Constitution XIII
 *     reasoning live.
 *  2. **It names no other module package.** A seam whose own surface reached a
 *     third module would make an install hook's import graph transitive across
 *     modules, which is the coupling R4 refuses in the shape R11 does not admit.
 *  3. **It imports no UI and no HTTP module.** This is the measured half of R11's
 *     argument: `manifest-index.generated.ts` imports every manifest statically
 *     and eagerly, so a consumer's reach is evaluated in the server, the CLI and
 *     every worker. Measured: with the factory on the barrel, `mod-delivery-methods`'
 *     `dist/backend/index.js` pulled 12 emitted files and 7 external specifiers
 *     including `@endora-commerce/platform/http`; after the split the barrel pulls
 *     11 and 7 and `dist/install/index.js` pulls 3 and 4 with no HTTP layer. An
 *     HTTP or React import here would return the graph the subpath exists to
 *     avoid, and R11's numbers would quietly stop being true.
 */

const REPO_ROOT =
  findRepoRoot(dirname(fileURLToPath(import.meta.url))) ??
  (() => {
    throw new Error('no repository root above this test file');
  })();

/** The layer directory `./install` resolves to, and the subpath as consumers write it. */
const INSTALL_DIRECTORY = 'install';
const INSTALL_SUBPATH = './install';

/** What may not appear in this layer's own import closure (property 3). */
const FORBIDDEN_SPECIFIER_MARKERS: readonly string[] = [
  '@endora-commerce/platform/http',
  '@endora-commerce/admin-kit',
  'react',
  'react-dom',
  'react-router-dom',
  'fastify',
  'lucide-react',
];

interface InstallLayer {
  readonly packageName: string;
  readonly entry: string;
  /** Every source file reachable from the entry through relative specifiers. */
  readonly files: readonly string[];
  /** Every bare specifier that closure names. */
  readonly specifiers: readonly string[];
  /** Every name the entry exports. */
  readonly exportedNames: readonly string[];
  /** Declarations in the layer that are not a re-export — property 1's subject. */
  readonly ownDeclarations: readonly string[];
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
}

/** The install layer of every module package that declares one. */
function installLayers(): InstallLayer[] {
  const out: InstallLayer[] = [];
  for (const pkg of discoverModulePackages(REPO_ROOT)) {
    const entry = join(pkg.dir, 'src', INSTALL_DIRECTORY, 'index.ts');
    if (!existsSync(entry)) continue;

    const files: string[] = [];
    const specifiers = new Set<string>();
    const exportedNames: string[] = [];
    const ownDeclarations: string[] = [];
    const queue = [entry];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      files.push(file);
      const source = parse(file);
      for (const statement of source.statements) {
        const moduleSpecifier =
          (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
          statement.moduleSpecifier !== undefined &&
          ts.isStringLiteral(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : null;
        if (moduleSpecifier !== null) {
          if (moduleSpecifier.startsWith('.')) {
            const target = resolve(dirname(file), moduleSpecifier.replace(/\.js$/, '.ts'));
            queue.push(target);
          } else {
            specifiers.add(moduleSpecifier);
          }
        }
        if (file !== entry) continue;
        if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
          if (ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
              exportedNames.push(element.name.text);
              if (statement.moduleSpecifier === undefined) {
                ownDeclarations.push(element.name.text);
              }
            }
          }
        } else if (
          ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isVariableStatement(statement)
        ) {
          ownDeclarations.push(ts.isVariableStatement(statement) ? 'const' : 'declaration');
        }
      }
    }

    out.push({
      packageName: pkg.name,
      entry,
      files: files.map((file) => relative(REPO_ROOT, file)).sort(),
      specifiers: [...specifiers].sort(),
      exportedNames: exportedNames.sort(),
      ownDeclarations,
    });
  }
  return out;
}

describe('R11 — the install surface, and the closed set R4 admits it through', () => {
  it('admits exactly two subpaths, and a third needs R11\'s four conditions argued', () => {
    // The pin, and the whole reason this file exists. `admin-ui` is D-191's
    // published component; `install` is FR-064's seed factory. Anything else is a
    // ruling, not an edit — see `FOREIGN_CONSUMPTION_SUBPATHS`' own doc-block for
    // the four conditions, and R11 property 4 for why the third member must
    // argue them rather than cite this one.
    expect([...FOREIGN_CONSUMPTION_SUBPATHS].sort()).toEqual(['admin-ui', 'install']);
  });

  it('is declared as a subpath by every package that ships the directory', () => {
    for (const pkg of discoverModulePackages(REPO_ROOT)) {
      const shipsLayer = existsSync(join(pkg.dir, 'src', INSTALL_DIRECTORY, 'index.ts'));
      // The `exports` map as the package declares it, read through the same
      // discovery the generator and every check use rather than by re-parsing the
      // file here: two readers of one map are two answers waiting to disagree.
      expect(pkg.exports.has(INSTALL_SUBPATH), `${pkg.name} declares ${INSTALL_SUBPATH}`).toBe(
        shipsLayer,
      );
    }
  });

  describe('every install layer in the tree', () => {
    const layers = installLayers();

    it('is a population worth judging', () => {
      // A green over nothing is not a green: the seam has one owner today and
      // `payment_methods` is the second in wave 2. If this reaches zero, either
      // the surface was withdrawn — a decision, not a refactor — or this walk
      // stopped resolving, which is the failure mode that reports clean.
      expect(layers.length).toBeGreaterThan(0);
      expect(layers.map((layer) => layer.packageName)).toContain(
        '@endora-commerce/mod-delivery-methods',
      );
    });

    it('exports only factories, and declares nothing of its own', () => {
      for (const layer of layers) {
        expect(layer.exportedNames.length, `${layer.packageName} exports something`).toBeGreaterThan(
          0,
        );
        for (const name of layer.exportedNames) {
          // `create*` is the naming the layout contract and every consumer use
          // this seam — a name that is not a factory is either behaviour moving
          // into the layer or a value a consumer would hold across the hook.
          expect(name, `${layer.packageName} exports ${name}`).toMatch(/^create[A-Z]/);
        }
        expect(
          layer.ownDeclarations,
          `${layer.packageName}'s install layer holds its own declarations`,
        ).toEqual([]);
      }
    });

    it('names no other module package', () => {
      const moduleNames = new Set(discoverModulePackages(REPO_ROOT).map((pkg) => pkg.name));
      for (const layer of layers) {
        const foreign = layer.specifiers.filter(
          (specifier) =>
            specifier !== layer.packageName &&
            [...moduleNames].some(
              (name) => specifier === name || specifier.startsWith(`${name}/`),
            ),
        );
        expect(foreign, `${layer.packageName}'s install layer reaches another module`).toEqual([]);
      }
    });

    it('imports no UI and no HTTP module', () => {
      for (const layer of layers) {
        const forbidden = layer.specifiers.filter((specifier) =>
          FORBIDDEN_SPECIFIER_MARKERS.some(
            (marker) => specifier === marker || specifier.startsWith(`${marker}/`),
          ),
        );
        expect(forbidden, `${layer.packageName}'s install layer pulls a UI or HTTP module`).toEqual(
          [],
        );
      }
    });
  });
});
