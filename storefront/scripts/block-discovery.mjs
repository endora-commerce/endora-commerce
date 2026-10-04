/**
 * Page Builder block discovery for this storefront instance.
 *
 * ## The question, and why this instance answers it
 *
 * *Which installed module packages draw blocks on this storefront?* The answer
 * is a fact about **this** storefront: the packages in *its* `node_modules`,
 * which may be a different set from the modules the backend composes — a
 * storefront is its owner's repository and may be on another machine, at
 * another version. A renderer this storefront does not have is a placeholder,
 * not a crash.
 *
 * So, like `theme-discovery.mjs` — whose walk this reuses — this file and
 * `generate-blocks.mjs` travel inside the storefront as ordinary files, are
 * copied by the scaffold, and belong to whoever owns the storefront afterwards.
 * Node built-ins only, no compile step: the generator runs before anything is
 * built.
 *
 * ## What a package says about itself
 *
 * Nothing here is a list of package names or a directory convention. A package
 * is read when its own `package.json` says `endora.type` is `module` and its
 * own `exports` map declares `./storefront` (React renderers for its blocks)
 * and/or `./blocks.css` (one finished, module-scoped stylesheet).
 *
 * Normative: `specs/141-module-block-renderers/contracts/block-renderers.md`
 * §1, §5.2.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { listInstalledPackages } from './theme-discovery.mjs';

/** The subpath a module publishes its storefront renderers under. */
export const STOREFRONT_LAYER_SUBPATH = './storefront';

/** The subpath a module publishes its finished block stylesheet under. */
export const BLOCK_STYLESHEET_SUBPATH = './blocks.css';

/** Where a sources-shipping module package keeps the storefront layer. */
const STOREFRONT_LAYER_SOURCES = ['src/storefront/index.ts', 'src/storefront/index.tsx'];

/** A module id, as `endora.id` declares it. */
const MODULE_ID_RE = /^[a-z][a-z0-9_]*$/;

/**
 * The file one `exports` entry resolves to for an importer, or `null`.
 *
 * `"./x.css"`, `{ "default": "./x.js" }` and `{ "import": …, "types": … }` all
 * resolve; `types` alone does not, because nothing can be imported from it.
 */
function targetOf(entry) {
  if (typeof entry === 'string') return entry;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
  for (const condition of ['import', 'default', 'module', 'require']) {
    const hit = targetOf(entry[condition]);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * The declaration file an `exports` entry's importer gets its types from, or
 * `null`: the entry's own `types` condition, or the `.d.ts` TypeScript finds
 * beside a JavaScript target.
 */
function typesOf(entry, dir) {
  if (entry !== null && typeof entry === 'object' && typeof entry.types === 'string') {
    return existsSync(join(dir, entry.types)) ? entry.types : null;
  }
  const target = targetOf(entry);
  if (target === null) return null;
  const sibling = target.replace(/\.[mc]?js$/, '.d.ts');
  return sibling !== target && existsSync(join(dir, sibling)) ? sibling : null;
}

/**
 * Every installed module package that contributes to this storefront's Page
 * Builder, and every one that tried to and cannot be composed.
 *
 * Two refusals, both for the reason `endora generate` refuses the same shapes
 * for the admin layer — a skip is how a whole layer goes missing without a
 * word:
 *
 *  - `layer-without-subpath` — the package ships `src/storefront/index.ts` and
 *    its `exports` map does not declare `./storefront`, so its blocks would
 *    render as placeholders with no error anywhere;
 *  - `missing-layer-file` — a declared subpath whose target is not in the
 *    package, which the bundler would report as a path nobody wrote;
 *  - `untyped-layer` — a storefront layer that ships no type declarations,
 *    which this storefront's TypeScript build would refuse as an untyped module.
 */
export function discoverBlockPackages(nodeModulesDir) {
  const installed = listInstalledPackages(nodeModulesDir);
  const packages = [];
  const findings = [];
  const notes = [];

  for (const { name, dir, manifest } of installed.packages) {
    const exportsField =
      manifest.exports !== null && typeof manifest.exports === 'object' ? manifest.exports : {};
    const endora = manifest.endora;
    const moduleId = endora !== null && typeof endora === 'object' ? endora.id : undefined;
    const isModule =
      endora !== null &&
      typeof endora === 'object' &&
      endora.type === 'module' &&
      typeof moduleId === 'string' &&
      MODULE_ID_RE.test(moduleId);
    if (!isModule) {
      // Not a refusal — a package may publish a subpath of this name for its
      // own reasons — but said: a module package whose manifest lost its
      // `endora` block would otherwise render placeholders with no word.
      if (exportsField[STOREFRONT_LAYER_SUBPATH] !== undefined) {
        notes.push({
          package: name,
          message:
            `package "${name}" exports "${STOREFRONT_LAYER_SUBPATH}" and its package.json declares ` +
            `no \`endora: { "type": "module", "id": … }\`, so it is not a module package and ` +
            `nothing was registered from it. If it is meant to draw Page Builder blocks, that ` +
            `block is what it is missing.`,
        });
      }
      continue;
    }

    const declaresLayer = exportsField[STOREFRONT_LAYER_SUBPATH] !== undefined;
    const declaresStylesheet = exportsField[BLOCK_STYLESHEET_SUBPATH] !== undefined;

    if (!declaresLayer && STOREFRONT_LAYER_SOURCES.some((file) => existsSync(join(dir, file)))) {
      findings.push({
        finding: 'layer-without-subpath',
        package: name,
        message:
          `package "${name}" ships a storefront layer (src/storefront/index.ts) and its exports ` +
          `map declares no "${STOREFRONT_LAYER_SUBPATH}", so its blocks would render as ` +
          `placeholders here with no error anywhere. Declare the subpath in the package.`,
      });
      continue;
    }
    if (!declaresLayer && !declaresStylesheet) continue;

    let refused = false;
    for (const subpath of [STOREFRONT_LAYER_SUBPATH, BLOCK_STYLESHEET_SUBPATH]) {
      if (exportsField[subpath] === undefined) continue;
      const target = targetOf(exportsField[subpath]);
      if (target !== null && existsSync(join(dir, target))) continue;
      refused = true;
      findings.push({
        finding: 'missing-layer-file',
        package: name,
        message:
          `package "${name}" exports "${subpath}"` +
          (target === null ? ' with no importable target' : ` as ${target}, and that file is not in the package`) +
          `. The generated registry would import it and the build would fail on a path nobody ` +
          `wrote. Reinstall the package, or report it to its author.`,
      });
    }
    // A layer with no type declarations is refused here, with a sentence, rather
    // than at `next build`, with TS7016: this storefront's registry imports the
    // layer from a TypeScript file.
    if (!refused && declaresLayer && typesOf(exportsField[STOREFRONT_LAYER_SUBPATH], dir) === null) {
      refused = true;
      findings.push({
        finding: 'untyped-layer',
        package: name,
        message:
          `package "${name}" publishes "${STOREFRONT_LAYER_SUBPATH}" with no type declarations ` +
          `— neither a "types" condition nor a .d.ts beside its target. The generated registry ` +
          `imports the layer from TypeScript, so the build would fail on an untyped module. ` +
          `Report it to the package's author.`,
      });
    }
    if (refused) continue;

    packages.push({
      name,
      moduleId,
      storefront: declaresLayer ? `${name}/${STOREFRONT_LAYER_SUBPATH.slice(2)}` : null,
      stylesheet: declaresStylesheet ? `${name}/${BLOCK_STYLESHEET_SUBPATH.slice(2)}` : null,
    });
  }

  packages.sort((a, b) =>
    a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : a.name < b.name ? -1 : 1,
  );
  return { packages, findings, notes, filesRead: installed.filesRead };
}

/**
 * The finding that needs the whole population: two packages claiming one
 * module id. A block name's owner segment is the module id, so two packages
 * under one id are two answers to "who draws `crm.Badge`", decided by install
 * order.
 */
export function analyseBlockPackages(packages) {
  const findings = [];
  const owners = new Map();
  for (const pkg of packages) {
    const already = owners.get(pkg.moduleId);
    if (already !== undefined) {
      findings.push({
        finding: 'duplicate-module',
        package: `${already}, ${pkg.name}`,
        message:
          `module id "${pkg.moduleId}" is declared by both "${already}" and "${pkg.name}". A ` +
          `block name states its owner module, so two packages under one id would have their ` +
          `renderers chosen by install order. Uninstall one.`,
      });
      continue;
    }
    owners.set(pkg.moduleId, pkg.name);
  }
  return findings;
}

const GENERATED_BY = 'GENERATED by `pnpm run blocks:generate`.';

/** `lib/page-builder/blocks.generated.ts`, for a population. Pure and deterministic. */
export function renderBlockRegistry(packages) {
  const layers = packages.filter((pkg) => pkg.storefront !== null);
  const imports = layers.map(
    (pkg, index) => `import { contributions as contributions${index} } from '${pkg.storefront}';`,
  );
  const entries = layers.map(
    (pkg, index) => `  { moduleId: '${pkg.moduleId}', contributions: contributions${index} },`,
  );
  return [
    '/**',
    ` * ${GENERATED_BY}`,
    ' * Never edit this file; run the generator.',
    ' *',
    ' * The storefront layers of the module packages this storefront has installed —',
    ' * every package whose own `package.json` says `endora.type` is `module` and',
    ' * whose `exports` map declares `./storefront`. Installing a module\'s renderers',
    ' * is adding the package and nothing else; `lib/page-builder/config.ts` is what',
    ' * reads this, and nothing else should.',
    ' *',
    ' * Static imports on purpose: a block is part of the server-rendered HTML, and',
    ' * a rendering server may have no `node_modules` tree to walk at run time.',
    ' */',
    "import type { StorefrontContributions } from '@endora-commerce/page-builder-core/contributions';",
    ...(imports.length === 0 ? [] : ['', ...imports]),
    '',
    '/** One installed module\'s storefront renderers, keyed by the module id that shipped them. */',
    'export interface StorefrontBlockRegistryEntry {',
    '  readonly moduleId: string;',
    '  readonly contributions: StorefrontContributions;',
    '}',
    '',
    ...(entries.length === 0
      ? ['export const STOREFRONT_BLOCK_CONTRIBUTIONS: readonly StorefrontBlockRegistryEntry[] = [];']
      : [
          'export const STOREFRONT_BLOCK_CONTRIBUTIONS: readonly StorefrontBlockRegistryEntry[] = [',
          ...entries,
          '];',
        ]),
    '',
  ].join('\n');
}

/** `app/blocks.generated.css`, for a population. Pure and deterministic. */
export function renderBlockStylesheet(packages) {
  const imports = packages
    .filter((pkg) => pkg.stylesheet !== null)
    .map((pkg) => `@import '${pkg.stylesheet}';`);
  return [
    '/*',
    ` * ${GENERATED_BY}`,
    ' * Never edit this file; run the generator.',
    ' */',
    '/*',
    ' * One `@import` per installed module package that publishes `./blocks.css` —',
    ' * finished, module-scoped CSS for the blocks that module draws. `globals.css`',
    ' * imports this file once.',
    ' */',
    ...(imports.length === 0 ? ['/* No installed module publishes a block stylesheet. */'] : imports),
    '',
  ].join('\n');
}
