/**
 * Which module packages ship an admin layer, and where its sources are
 * (feature 091; `contracts/admin-registry.md` R13b).
 *
 * **The independent author is the generated admin contribution registry**, and
 * that is the whole point of this derivation rather than a convenience. A check
 * that walks module packages computes its own population by listing
 * directories; a floor computed the same way would be the same answer twice,
 * which is what issue #244 is about. `admin/src/modules.generated.ts` is
 * rendered by `generate-composer.ts` out of the layer inventory — a different
 * program reading a different input, and one `overlay:check` already refuses
 * when it is stale, foreign or empty — and it names both halves of what a floor
 * needs: *which* packages contribute admin code, and *under which subpath*, so
 * nothing here spells `./admin` or `src/admin`. A module package that gains an
 * admin layer raises the expectation in the same run that regenerates the
 * registry.
 *
 * It lives in `scripts/lib/` rather than inside one check because **two** of
 * them take their expectation from it — `check:admin-zones` as `module-admin`
 * and, since Phase 5's T3, `check:admin-surface` as `admin-registry`. Two
 * derivations of one population are two answers waiting to disagree, and this
 * repository has watched that happen (`i18n:hardcoded`, !1182).
 *
 * **Its answer is gated on the registry file being on disk and on nothing
 * else.** Not on the admin layout: that is the gate that failed silently over
 * 54 layers on the merge of batches 15 and 16, where `check:admin-zones` omitted
 * the token because the layout answered `null` for a reason having nothing to do
 * with the registry (`admin-kit-surface.md` §7.5).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import type { ModuleTreeLayout } from './module-roots.js';

/** One module package's admin layer, as the generated registry names it. */
export interface ModuleAdminLayer {
  readonly moduleId: string;
  /** The source directory behind the subpath the registry imports. */
  readonly directory: string;
}

/**
 * The source directory behind a subpath a package declares, or `null`.
 *
 * `./admin` declares `./dist/admin/index.js`; the sources that emit it are
 * `src/admin`. Reading the map rather than spelling the directory is what makes
 * an answer follow a renamed subpath, and what makes a package that declares no
 * such subpath contribute nothing at all — the `null` is a statement, and every
 * caller treats it as one.
 */
export function packageSubpathSource(packageDir: string, subpath: string): string | null {
  const manifestPath = join(packageDir, 'package.json');
  if (!existsSync(manifestPath)) return null;
  let manifest: { exports?: Record<string, unknown> };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports?: Record<string, unknown>;
    };
  } catch {
    return null;
  }
  if (manifest.exports?.[subpath] === undefined) return null;
  return join(packageDir, 'src', subpath.slice('./'.length));
}

/**
 * Every admin layer the generated registry names, sorted by source directory.
 *
 * An empty array is *"the registry names none"*, which every caller refuses as
 * `vacuousReason` rather than treating as a satisfied floor;
 * {@link adminRegistryPresent} is how a caller tells that apart from *"there is
 * no registry"*.
 *
 * The kit's `AdminContributions` type import resolves to no module package and
 * is therefore not a layer, without being excluded by name.
 */
export function moduleAdminLayers(
  layout: ModuleTreeLayout,
  registryPath: string,
): readonly ModuleAdminLayer[] {
  if (!existsSync(registryPath)) return [];
  const source = readFileSync(registryPath, 'utf8');
  const parsed = ts.createSourceFile(
    registryPath,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const layers = new Map<string, ModuleAdminLayer>();
  for (const statement of parsed.statements) {
    // Literal AST nodes, never a text scan: a specifier inside a comment
    // explaining the registry is not an import, and that file's header is
    // thirty lines of prose about the packages it names.
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const segments = specifier.split('/');
    const packageName = specifier.startsWith('@')
      ? segments.slice(0, 2).join('/')
      : segments.slice(0, 1).join('/');
    const subpath = specifier.slice(packageName.length);
    if (subpath === '') continue;
    const moduleId = layout.modulePackageNames.get(packageName);
    if (moduleId === undefined) continue;
    const packageDir = layout.moduleDirectoryOf(moduleId);
    if (packageDir === null) continue;
    const directory = packageSubpathSource(packageDir, `.${subpath}`);
    if (directory === null) continue;
    layers.set(`${moduleId}${subpath}`, { moduleId, directory });
  }
  return [...layers.values()].sort((left, right) => left.directory.localeCompare(right.directory));
}

/** Is the generated registry on disk? The one gate on a layer floor's presence. */
export function adminRegistryPresent(registryPath: string | null): boolean {
  return registryPath !== null && existsSync(registryPath);
}
