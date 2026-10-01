/**
 * Finding a demo composition an instance **installed**, when the instance's
 * own tree supplies none (feature 113 §5.2/§5.6, 2026-10-01).
 *
 * ## The defect it answers
 *
 * The composition — the wiring that spans modules' demo rows — belongs to
 * whoever owns the instance (§5.2), and this repository's host is the only tree
 * that ever had one. An instance scaffolded by `endora new instance` passes no
 * loader, and D-216 / FR-121 forbid writing one into it, so its `demo seed` ran
 * every module's own rows and stopped: measured on a CLI-scaffolded instance on
 * 2026-10-01, 203 products that no sales channel sold, and `admin@demo.local`
 * with no role, so `/admin/me` answered `permissions: []` and the admin sidebar
 * was empty.
 *
 * ## So a composition can be a package, found by what it declares
 *
 * A package whose `package.json` carries `"endora": { "type":
 * "demo-composition" }` is one, and its root export's `createDemoComposition`
 * is called with the {@link DemoCompositionInput} the dispatcher built. That is
 * the shape module discovery already has — a package is recognised by its
 * `endora` field and never by its name (D-07) — so this file names no package
 * and no module, which is what lets it live in the platform at all (§5.3,
 * D-52/D-53). Installing such a package is how an instance *asks* for the
 * wiring; an instance that installs none is an ordinary instance and is told so
 * once, exactly as before (§5.6).
 *
 * ## Present and broken is not absent
 *
 * The backend loader's rule, one seam over: **is it there** is answered by
 * looking at manifests, **does it load** by loading and by nothing else. A
 * declared package that will not import, or exports no `createDemoComposition`,
 * fails the command with its own error rather than reading as "none". And two
 * declared packages are a refusal naming both: choosing one would make the
 * demo an instance gets depend on the order a directory listing returned.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  nodeModulesRootsFor,
  scanNodeModulesRootsForType,
  type InstalledTypedPackage,
} from '../packages/installed-packages.js';

import {
  NO_DEMO_COMPOSITION_NOTICE,
  type DemoCompositionInput,
  type DemoCompositionLoader,
  type DemoCompositionLookup,
} from './host-command.js';
import type { DemoComposition } from './runner.js';

/** The `endora.type` a demo-composition package declares in its `package.json`. */
export const DEMO_COMPOSITION_PACKAGE_TYPE = 'demo-composition';

/** What a demo-composition package's root export provides. */
interface DemoCompositionModule {
  readonly createDemoComposition?: unknown;
}

/**
 * Import the package's root export the way anything in the instance would.
 *
 * Resolved from the directory that holds the `node_modules` it was found
 * under, so Node's own resolver — `exports` map and conditions — answers. The
 * platform cannot import the package by name from its own location: under a
 * strict install it is not one of the platform's dependencies.
 */
async function importRoot(installed: InstalledTypedPackage): Promise<DemoCompositionModule> {
  const require = createRequire(join(dirname(installed.foundUnder), 'noop.js'));
  const entry = require.resolve(installed.name);
  return (await import(pathToFileURL(entry).href)) as DemoCompositionModule;
}

/**
 * The loader the dispatcher uses when the calling tree supplies none.
 *
 * `roots` defaults to the `node_modules` directories this platform reads module
 * packages from, so an instance's composition package is found where its
 * modules are.
 */
export function installedDemoCompositionLoader(
  roots: readonly string[] = nodeModulesRootsFor(),
): DemoCompositionLoader {
  return async (input: DemoCompositionInput): Promise<DemoCompositionLookup> => {
    const declared = scanNodeModulesRootsForType(roots, DEMO_COMPOSITION_PACKAGE_TYPE);
    if (declared.length === 0) return { found: false, notice: NO_DEMO_COMPOSITION_NOTICE };
    if (declared.length > 1) {
      throw new Error(
        `[demo] ${String(declared.length)} installed packages declare themselves this ` +
          `instance's demo composition (\`"endora": { "type": "${DEMO_COMPOSITION_PACKAGE_TYPE}" }\`): ` +
          `${declared.map((pkg) => `${pkg.name} (${pkg.manifestPath})`).join(', ')}. An instance ` +
          `has one composition; remove all but the one you want and run the command again.`,
      );
    }
    const installed = declared[0]!;
    const module = await importRoot(installed);
    if (typeof module.createDemoComposition !== 'function') {
      throw new Error(
        `[demo] ${installed.name} declares itself a demo composition in ` +
          `${installed.manifestPath}, but its root export has no \`createDemoComposition\` ` +
          `function. A demo-composition package exports ` +
          `\`createDemoComposition(input: DemoCompositionInput): DemoComposition\`.`,
      );
    }
    const create = module.createDemoComposition as (input: DemoCompositionInput) => DemoComposition;
    return { found: true, composition: create(input) };
  };
}
