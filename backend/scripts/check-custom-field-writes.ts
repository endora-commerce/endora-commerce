/**
 * CI check — every custom-field host declares its write paths, and the
 * declarations agree with its routes and contracts
 * (`specs/175-buyer-input-custom-fields/` research R-11,
 * `contracts/admin-panel-and-check.md` §4). **Repository-scope host** over the
 * analysis in `@endora-commerce/cli/rules/custom-field-writes.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts).
 *
 * This file resolves this repository's module directories, reads each module's
 * manifest and route sources, the custom-field registry's input surfaces and
 * the **built** contracts, and applies the floors:
 *
 *  - the module-population floor (issue #215) — a walk that lost a registered
 *    module is exit 2, not a clean report over the residue;
 *  - the contracts — not built is exit 2: the body schemas are introspected,
 *    and without them every declaration would be unreadable (`build:packages`);
 *  - the registry — unreadable is exit 2: the buyer surfaces are derived from
 *    it, and reading none would make `surface-without-contract` unreachable.
 *
 * The rules themselves — what a declaration is, the nine findings, the
 * discovery scope — are `specs/conventions/custom-field-writes.md`'s.
 *
 * Usage: `tsx scripts/check-custom-field-writes.ts`
 * Exit 0 = every declaration agrees; 1 = a finding; 2 = the run could not see
 * the tree.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  analyseCustomFieldWrites,
  readInputSurfaceRegistry,
  type ModuleWriteSources,
} from '@endora-commerce/cli/rules/custom-field-writes.js';
import { collectRouteSources } from '@endora-commerce/cli/rules/action-route-permissions.js';
import { UI_LAYER_DIRECTORIES } from '@endora-commerce/cli/lib/ui-layer.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/custom-field-writes.js';

const PREFIX = '[custom-field-writes]';

/** The module that owns the input-surface registry, and where it keeps it. */
const REGISTRY_MODULE = 'custom_fields';
const REGISTRY_FILE = join('backend', 'services', 'custom-field-registry.ts');

/** A module's manifest: `src/manifest.ts` in a package, `manifest.ts` in the application tree. */
function manifestOf(directory: string): string | null {
  for (const candidate of [join(directory, 'src', 'manifest.ts'), join(directory, 'manifest.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function sourceDirectoryOf(directory: string): string {
  const src = join(directory, 'src');
  return existsSync(src) ? src : directory;
}

async function main(): Promise<void> {
  const layout = await requireModuleLayout(PREFIX);

  // Each module's own sources, its UI layers excepted: this walk's subject is
  // Fastify registrations, and an admin screen's `apiClient.post(...)` reads
  // like one (see `check-action-route-permissions.ts`).
  const filesByModule = new Map<string, string[]>();
  for (const [moduleId, directory] of layout.moduleDirectories) {
    const root = sourceDirectoryOf(directory);
    const uiLayers = UI_LAYER_DIRECTORIES.map((layer) => `${join(root, layer)}/`);
    filesByModule.set(
      moduleId,
      collectRouteSources(root).filter((file) => !uiLayers.some((layer) => file.startsWith(layer))),
    );
  }

  // Before anything is imported and before a finding can be counted: over a
  // moved module tree the walk comes back with a residue (issue #215).
  const population = await refuseVacuousModulePopulation({
    prefix: PREFIX,
    manifestIndexPath: layout.manifestIndexPath,
    files: [...filesByModule.values()].flat(),
    moduleIdOf: layout.moduleIdOfPath,
  });

  // The schemas the declarations name are introspected out of the **built**
  // contracts — a precondition of every run (AGENTS.md, D-164).
  let contracts: Record<string, unknown>;
  try {
    contracts = (await import('@endora-commerce/contracts')) as Record<string, unknown>;
  } catch (error: unknown) {
    console.error(
      `${PREFIX} @endora-commerce/contracts could not be loaded (${String(error)}). The body schemas ` +
        'the declarations name are read out of its build; run `pnpm run build:packages`. Refusing to ' +
        'report a vacuous pass.',
    );
    process.exit(2);
  }
  const entityTypes = (contracts['supportedEntityTypeSchema'] as { options?: readonly string[] } | undefined)
    ?.options;
  const valuesSchema = contracts['customFieldValuesSchema'];
  if (!entityTypes || entityTypes.length === 0 || valuesSchema === undefined) {
    console.error(
      `${PREFIX} the built contracts publish no supported entity type or no values schema — the ` +
        'population is derived from them; run `pnpm run build:packages`. Refusing to report a vacuous pass.',
    );
    process.exit(2);
  }

  const registryDirectory = layout.moduleDirectoryOf(REGISTRY_MODULE);
  const registryPath = registryDirectory === null ? null : join(sourceDirectoryOf(registryDirectory), REGISTRY_FILE);
  const registry =
    registryPath !== null && existsSync(registryPath)
      ? readInputSurfaceRegistry(readFileSync(registryPath, 'utf8'))
      : null;
  if (registry === null) {
    console.error(
      `${PREFIX} the custom-field input-surface registry (${REGISTRY_MODULE}'s ${REGISTRY_FILE}) could not ` +
        'be read. The buyer surfaces are derived from it; refusing to report a vacuous pass.',
    );
    process.exit(2);
  }

  // Manifests first — every module's — then the route sources of the modules
  // that declare anything.
  let opened = 1; // the registry
  const modules: ModuleWriteSources[] = [];
  for (const [moduleId, directory] of layout.moduleDirectories) {
    const manifestPath = manifestOf(directory);
    if (manifestPath === null) continue;
    const manifestText = readFileSync(manifestPath, 'utf8');
    opened += 1;
    const declares = /\bexport\s+const\s+customFieldWrites\b/.test(manifestText);
    const sources = new Map<string, string>();
    if (declares) {
      for (const file of filesByModule.get(moduleId) ?? []) {
        if (file === manifestPath) continue;
        sources.set(layout.displayOf(file), readFileSync(file, 'utf8'));
      }
    }
    modules.push({ moduleId, manifestFile: layout.displayOf(manifestPath), manifestText, sources });
  }

  const result = analyseCustomFieldWrites({
    entityTypes,
    inputSurfaces: registry,
    modules,
    resolveSchema: (name) => contracts[name],
    valuesSchema,
    readTest: (path) => {
      const absolute = join(layout.repoRoot, path);
      return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
    },
  });

  // `entity-types` is reconciled against the registry this run read: a type
  // the contracts support and the registry did not answer for is a short read,
  // not a type with nothing to declare.
  reportReadSize({
    prefix: PREFIX,
    files: opened + result.routeFiles,
    sites: result.declarations.length,
    coverage: [
      {
        source: 'entity-types',
        expected: entityTypes.length,
        covered: entityTypes.filter((type) => registry.has(type)).length,
      },
      population,
    ],
  });
  for (const exemption of result.exemptions) {
    console.log(`${PREFIX} exempt: ${exemption.moduleId} ${exemption.entityType} ${exemption.kind} — ${exemption.reason}`);
  }
  console.log(
    `${PREFIX} declarations=${result.declarations.length} exemptions=${result.exemptions.length} ` +
      `findings=${result.findings.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nA custom-field host write path disagrees with its declaration (specs/conventions/custom-field-writes.md).\n' +
        'Declare every admin create and update of a custom-field host in `customFieldWrites` beside its\n' +
        'manifest, carry `customFieldValues` in its body, or exempt it with a reason.\n',
    );
    for (const finding of result.findings) {
      console.error(`  - [${finding.kind}] ${finding.message}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

// CLI only — importing this module (the inventory does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
