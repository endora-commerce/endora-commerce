import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleManifest, RegistryState } from '@endora-commerce/contracts';
import { ModuleRegistration } from '@endora-commerce/platform/composition';
import { Setting } from '@endora-commerce/platform/kernel';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import {
  firstBootInsertPopulation,
  installGatingGraph,
  loadModulePresence,
  type ShippedModuleEntry,
} from '@endora-commerce/platform/lifecycle';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { overlayModulesRootFor, repoRoot } from '../../../src/overlay/overlay-roots.js';

/**
 * T033a / D-157.6(b) — the first-boot reconciler does not install a package
 * nobody installed.
 *
 * `reconcileExistingModules` inserts `state='installed'` for **every shipped
 * manifest with no row**, and since T031 the list it is handed is the
 * instance-resolved set: core, this deployment's overlay, and every Endora
 * module package under the instance's `node_modules`. So the first boot after
 * `pnpm add @vendor/some-module` converged that package silently — before a
 * single migration of its had run — and `module:install` then answered
 * `already-installed`, applied no migration, reconciled no setting, ran no
 * install hook, exited 0 and left an operator with a module whose tables do not
 * exist.
 *
 * The narrowing is on the **insert** and on nothing else. The presence *cache*
 * still loads over the full resolved set, which is what the second half of this
 * file is for: a package that **has** been installed — by `module:install`, the
 * mechanism that runs its migrations — is present and gated exactly like a core
 * module. A narrowing that also narrowed the cache would replace a silent
 * install with a silent absence, which is the same defect wearing the other
 * sign.
 *
 * Every fixture enters at the top of the analysis (issue #130): the entries are
 * built from the **real** roots (`repoRoot()`, `overlayModulesRootFor()`
 * and an instance `node_modules` path), and each carries the `origin` its
 * discovery would have set.
 *
 * **The origin is a field on the entry since feature 080's T040b**, and these
 * fixtures kept their real paths rather than dropping them. The field replaced a
 * containment test that classified a module *package* as `'package'` — true of
 * an installed one and false of a workspace one, which this build ships and
 * bakes into the composer, and which therefore has to be converged here. The
 * paths stay because the entries are the shape `composeApp()` hands over and a
 * fixture of two fields would stop resembling it.
 */

const CORE_ID = 'fixture_reconcile_core';
const OVERLAY_ID = 'fixture_reconcile_overlay';
const PACKAGE_ID = 'fixture_reconcile_package';

function manifest(id: string): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    dependencies: [],
    activation: { settingCode: `${id}.enabled`, default: true },
  };
}

/** A core module's anchor: the `package.json` that claims its id (D-149). */
function coreEntry(id: string): ShippedModuleEntry {
  return {
    manifest: manifest(id),
    filePath: join(repoRoot(), 'packages', 'modules', id, 'package.json'),
    origin: 'core',
  };
}

/** An overlay module's anchor: `backend/src/apps/<deployment>/modules/<id>/manifest.ts`. */
function overlayEntry(id: string): ShippedModuleEntry {
  return {
    manifest: manifest(id),
    filePath: join(overlayModulesRootFor('fixture_deployment'), id, 'manifest.ts'),
    origin: 'overlay',
  };
}

/**
 * A package's anchor is the resolved `package.json` that claimed the id
 * (`PackageModuleManifest.filePath`), which is never inside this build.
 */
function packageEntry(id: string): ShippedModuleEntry {
  return {
    manifest: manifest(id),
    filePath: join(repoRoot(), 'node_modules', '@vendor', id, 'package.json'),
    origin: 'package',
  };
}

interface CreatedRow {
  moduleId: string;
  state: RegistryState;
}

/**
 * The two reads the load makes — the platform axis, then the operator axis —
 * plus a record of every row the reconciler created.
 *
 * A flushed row is visible to the next `find`, because that is what the real
 * EntityManager does and it is exactly the step under test: the registry cache
 * re-reads `module_registrations` *after* the reconciler has converged it, so a
 * stub that forgot the insert would report the narrowing as working while
 * hiding whether the core rows landed at all.
 */
function stubEm(
  registrations: ReadonlyArray<{ moduleId: string; state: RegistryState }>,
  created: CreatedRow[],
): () => EntityManager {
  const rows = [...registrations];
  const pending: CreatedRow[] = [];
  return () =>
    ({
      find: async (entity: unknown): Promise<unknown[]> => {
        if (entity === ModuleRegistration) return [...rows];
        if (entity === Setting) return [];
        return [];
      },
      create: (_entity: unknown, data: unknown): unknown => {
        created.push(data as CreatedRow);
        pending.push(data as CreatedRow);
        return data;
      },
      flush: async (): Promise<void> => {
        rows.push(...pending.splice(0));
      },
    }) as unknown as EntityManager;
}

async function boot(
  entries: readonly ShippedModuleEntry[],
  registrations: ReadonlyArray<{ moduleId: string; state: RegistryState }> = [],
): Promise<CreatedRow[]> {
  const created: CreatedRow[] = [];
  registryCache.__resetForTesting();
  await loadModulePresence({ em: stubEm(registrations, created), entries });
  return created;
}

describe('the first-boot reconciler inserts for core and overlay, never for a package', () => {
  afterAll(() => {
    // Both are process singletons and one fork runs the whole file list: leave
    // them the way every other test expects to find them.
    registryCache.__setEnabledForTesting(REGISTERED_MANIFESTS.map((e) => e.manifest.id));
    installGatingGraph(REGISTERED_MANIFESTS.map((e) => e.manifest));
  });

  it('creates a row for the core and overlay entries and none for the package entry', async () => {
    const created = await boot([
      coreEntry(CORE_ID),
      overlayEntry(OVERLAY_ID),
      packageEntry(PACKAGE_ID),
    ]);

    expect(created.map((row) => row.moduleId).sort()).toEqual([CORE_ID, OVERLAY_ID].sort());
    // The whole point, stated as its own assertion so a widened population
    // cannot pass by accident: a package the operator has not installed gets no
    // row, so `module:install` still has the work to do.
    expect(created.map((row) => row.moduleId)).not.toContain(PACKAGE_ID);
  });

  it('leaves the package absent from the platform axis, so `module:install` is not a no-op', async () => {
    await boot([coreEntry(CORE_ID), packageEntry(PACKAGE_ID)]);

    expect(registryCache.platformStateOf(CORE_ID)).toBe('installed');
    expect(registryCache.platformStateOf(PACKAGE_ID)).toBe('not-installed');
    expect(effectiveState.isPresent(PACKAGE_ID)).toBe(false);
  });

  it('still loads the presence cache over the package, so an installed one is present and gated', async () => {
    // The row `module:install` wrote. Only the insert is narrowed: the cache
    // reads the registry, and the activation declarations come from the full
    // resolved set, so the package answers on both axes like any other module.
    await boot([coreEntry(CORE_ID), packageEntry(PACKAGE_ID)], [
      { moduleId: PACKAGE_ID, state: 'installed' },
    ]);

    expect(registryCache.isEnabled(PACKAGE_ID)).toBe(true);
    expect(effectiveState.isPresent(PACKAGE_ID)).toBe(true);
    // The activation declaration reached the cache from the package's own
    // manifest — a resolved set the cache never saw would report `undefined`
    // here and make the module non-deactivatable by omission.
    expect(effectiveState.activationSettingCode(PACKAGE_ID)).toBe(`${PACKAGE_ID}.enabled`);
  });

  it('is idempotent: a converged database gets no second insert', async () => {
    const created = await boot(
      [coreEntry(CORE_ID), overlayEntry(OVERLAY_ID), packageEntry(PACKAGE_ID)],
      [
        { moduleId: CORE_ID, state: 'installed' },
        { moduleId: OVERLAY_ID, state: 'installed' },
        { moduleId: PACKAGE_ID, state: 'installed' },
      ],
    );

    expect(created).toEqual([]);
  });
});

/**
 * It answers with **entries** and not with manifests, which it used to. The
 * second reader — `bootConvergenceWarnings` — asks about `installHook`, which
 * lives on the entry, and returning manifests would have made it re-derive the
 * origin split for itself: the D-100 shape this function exists to prevent.
 */
describe('firstBootInsertPopulation — the origin split, without a database', () => {
  it('keeps core and overlay entries and drops package entries', () => {
    const population = firstBootInsertPopulation([
      coreEntry(CORE_ID),
      overlayEntry(OVERLAY_ID),
      packageEntry(PACKAGE_ID),
    ]);

    expect(population.map((e) => e.manifest.id)).toEqual([CORE_ID, OVERLAY_ID]);
  });

  it('classifies every entry the committed core registry ships as insertable', () => {
    // The registry the platform has always converged. If the origin ever stops
    // recognising this build's own modules, a fresh database boots with no
    // presence rows at all and every gated port throws — so the whole core set
    // is asserted rather than a sample.
    //
    // It is the real `REGISTERED_MANIFESTS`, entries and all, which is what
    // makes it the regression net for feature 080's T040b: `blog` moved into a
    // workspace package, its `filePath` left `backend/src`, the containment test
    // that used to answer this called it `'package'`, and this assertion is
    // where 65-of-66 showed up.
    const population = firstBootInsertPopulation(REGISTERED_MANIFESTS);

    expect(population).toHaveLength(REGISTERED_MANIFESTS.length);
  });
});
