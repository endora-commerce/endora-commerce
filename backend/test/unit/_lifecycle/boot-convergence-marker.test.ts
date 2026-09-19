import { afterAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleManifest, RegistryState } from '@endora-commerce/contracts';
import { ModuleRegistration } from '@endora-commerce/platform/composition';
import { Setting } from '@endora-commerce/platform/kernel';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  bootConvergenceWarnings,
  firstBootInsertPopulation,
  installGatingGraph,
  loadModulePresence,
  type ShippedModuleEntry,
} from '@endora-commerce/platform/lifecycle';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { overlayModulesRootFor, repoRoot } from '../../../src/overlay/overlay-roots.js';

/**
 * A database that boots before it installs used to silence every install hook,
 * for ever — and this is the boot half of the repair.
 *
 * `reconcileExistingModules` inserts `state='installed'` for every shipped
 * manifest with no row, from `composeApp`, and runs no hook: it cannot, and its
 * own doc-block says why. `install` then short-circuited on
 * `state === 'installed'` and answered `already-installed`, hook included. So on
 * a database whose first action after the migrations is a boot, an install hook
 * never ran and never would.
 *
 * Nothing noticed until feature 134's W7, because until then the tree had **no
 * `installHook` at all** — `custom_fields`' `uninstallHook` was the only
 * lifecycle hook in it. **Re-derived twice, because W7 merged mid-task and the
 * answer moved**: at this branch's original base (`512e22ac5`) zero `installHook`
 * exports and one `uninstallHook`; after the rebase onto W7, **three**
 * `installHook` (`inpost`, `dhl_parcel`, and the `carrier_fixture` overlay) and
 * four `uninstallHook`. The first measurement is the one the **no-backfill**
 * argument rests on — no `installed` row predating the column can have skipped a
 * hook that did not exist, so `null` everywhere is correct — and the second is
 * why this is no longer hypothetical: a `db:fresh` followed by `pnpm run dev` now
 * warns about three real modules.
 *
 * The repair is two halves and this file is the first:
 *
 *  - **here** — the reconciler stamps `bootConvergedAt` on every row *it* wrote,
 *    and warns once per converged manifest that declares an `installHook`. It
 *    still inserts only and still decides nothing, so its
 *    `command-coverage-ignore` justification survives verbatim.
 *  - **`orchestrator.test.ts`** § *install — a boot-converged row is repaired* —
 *    `install` completes a row it did not write, and clears the marker.
 *
 * Both halves of the analysis are **pure functions beside the boot step**, for
 * the reason `first-boot-package-reconcile.test.ts` states about
 * `assertLockedModulesPresent` and `firstBootInsertPopulation`: the server
 * harness never calls {@link loadModulePresence} — it seeds the registry cache
 * directly — so logic written into that body would be proved by nothing that
 * runs.
 *
 * The fixture shape is `first-boot-package-reconcile.test.ts`' deliberately:
 * same subject, same real roots, and every entry carrying the `origin` its
 * discovery would have set (issue #130).
 */

const CORE_ID = 'fixture_marker_core';
const CORE_HOOK_ID = 'fixture_marker_core_hook';
const OVERLAY_HOOK_ID = 'fixture_marker_overlay_hook';
const PACKAGE_HOOK_ID = 'fixture_marker_package_hook';

function manifest(id: string): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    dependencies: [],
    activation: { settingCode: `${id}.enabled`, default: true },
  };
}

/** A no-op stand-in for a module's exported `installHook`. */
const noopHook = async (): Promise<void> => {};

function entry(
  id: string,
  origin: ShippedModuleEntry['origin'],
  withHook: boolean,
): ShippedModuleEntry {
  const filePath =
    origin === 'core'
      ? join(repoRoot(), 'packages', 'modules', id, 'package.json')
      : origin === 'overlay'
        ? join(overlayModulesRootFor('fixture_deployment'), id, 'manifest.ts')
        : join(repoRoot(), 'node_modules', '@vendor', id, 'package.json');
  return {
    manifest: manifest(id),
    filePath,
    origin,
    // `exactOptionalPropertyTypes`: an absent key, never `undefined`, because
    // the whole question this file asks is `'installHook' in entry`.
    ...(withHook ? { installHook: noopHook } : {}),
  };
}

interface CreatedRow {
  moduleId: string;
  state: RegistryState;
  bootConvergedAt?: Date | null;
}

/** The precedent file's stub, plus the marker field the insert now carries. */
function stubEm(
  registrations: ReadonlyArray<{ moduleId: string; state: RegistryState }>,
  created: CreatedRow[],
): () => EntityManager {
  const rows = [...registrations];
  const pending: CreatedRow[] = [];
  return () =>
    ({
      find: async (e: unknown): Promise<unknown[]> => {
        if (e === ModuleRegistration) return [...rows];
        if (e === Setting) return [];
        return [];
      },
      create: (_e: unknown, data: unknown): unknown => {
        created.push(data as CreatedRow);
        pending.push(data as CreatedRow);
        return data;
      },
      flush: async (): Promise<void> => {
        rows.push(...pending.splice(0));
      },
    }) as unknown as EntityManager;
}

/** Every line the boot step emitted, at the level it emitted it. */
interface CapturedLog {
  warned: string[];
}

function stubLog(captured: CapturedLog): {
  info: (o: object, m: string) => void;
  warn: (o: object, m: string) => void;
  error: (o: object, m: string) => void;
} {
  return {
    info: () => {},
    warn: (_o: object, m: string) => captured.warned.push(m),
    error: () => {},
  };
}

async function boot(
  entries: readonly ShippedModuleEntry[],
  registrations: ReadonlyArray<{ moduleId: string; state: RegistryState }> = [],
  captured: CapturedLog = { warned: [] },
): Promise<CreatedRow[]> {
  const created: CreatedRow[] = [];
  registryCache.__resetForTesting();
  await loadModulePresence({
    em: stubEm(registrations, created),
    entries,
    log: stubLog(captured),
  });
  return created;
}

describe('the first-boot reconciler records that *it* wrote the row', () => {
  afterAll(() => {
    // Both are process singletons and one fork runs the whole file list: leave
    // them the way every other test expects to find them.
    registryCache.__setEnabledForTesting(REGISTERED_MANIFESTS.map((e) => e.manifest.id));
    installGatingGraph(REGISTERED_MANIFESTS.map((e) => e.manifest));
  });

  it('stamps `bootConvergedAt` on every row it inserts', async () => {
    const created = await boot([entry(CORE_ID, 'core', false)]);

    expect(created).toHaveLength(1);
    // The marker is on **every** converged row, not only a hook-bearing one:
    // it means "boot wrote this and no install has run", which is true of both,
    // and a module that gains a hook later is then already marked. Narrowing it
    // to hook-bearing manifests would re-make the residual case this repair is
    // about, one release later.
    expect(created[0]?.bootConvergedAt).toBeInstanceOf(Date);
  });

  it('emits the warning from the boot step itself, not only from the pure function', async () => {
    // The wiring, asserted separately from the analysis. `bootConvergenceWarnings`
    // being right is worth nothing if `loadModulePresence` never calls it, and the
    // server harness never calls `loadModulePresence` at all — so this file is the
    // only place the two halves are ever joined.
    const captured = { warned: [] as string[] };
    await boot([entry(CORE_HOOK_ID, 'core', true), entry(CORE_ID, 'core', false)], [], captured);

    expect(captured.warned).toHaveLength(1);
    expect(captured.warned[0]).toContain(`module:install ${CORE_HOOK_ID}`);
  });

  it('boots silently on a converged database, which is the steady state', async () => {
    const captured = { warned: [] as string[] };
    await boot(
      [entry(CORE_HOOK_ID, 'core', true)],
      [{ moduleId: CORE_HOOK_ID, state: 'installed' }],
      captured,
    );

    expect(captured.warned).toEqual([]);
  });

  it('leaves a row it did not write alone, marker included', async () => {
    const created = await boot([entry(CORE_ID, 'core', true)], [
      { moduleId: CORE_ID, state: 'installed' },
    ]);

    // Inserts only — the property the `command-coverage-ignore` justification
    // rests on. A converged database gets no second insert and therefore no
    // marker written over an install that really happened.
    expect(created).toEqual([]);
  });
});

describe('bootConvergenceWarnings — it stops being silent', () => {
  it('warns for a manifest it is about to converge that declares an install hook', () => {
    const warnings = bootConvergenceWarnings(
      [entry(CORE_HOOK_ID, 'core', true)],
      new Set<string>(),
    );

    expect(warnings.map((w) => w.moduleId)).toEqual([CORE_HOOK_ID]);
    // The remedy is named, because a warning an operator cannot act on is noise.
    // `module:install --all` is the whole-set form and is what the companion
    // `setup` script runs.
    expect(warnings[0]?.message).toContain(`module:install ${CORE_HOOK_ID}`);
  });

  it('says nothing about a manifest with no install hook', () => {
    expect(bootConvergenceWarnings([entry(CORE_ID, 'core', false)], new Set())).toEqual([]);
  });

  it('says nothing about a manifest that already has a row', () => {
    // A converged database is the steady state and boots many times a day. A
    // warning here would be printed on every one of them, which is how a real
    // warning stops being read.
    expect(
      bootConvergenceWarnings([entry(CORE_HOOK_ID, 'core', true)], new Set([CORE_HOOK_ID])),
    ).toEqual([]);
  });

  it('includes the overlay, because that is the one path a customer instance takes', () => {
    // `deploymentShippedEntries` excludes `'package'` **only**, so an instance's
    // own overlay modules are in the insert population. Principle XV makes the
    // overlay *the* client customisation seam, so an overlay `installHook`
    // silenced by a premature `start` is a customer path, not only a dev one.
    const warnings = bootConvergenceWarnings(
      [entry(OVERLAY_HOOK_ID, 'overlay', true), entry(PACKAGE_HOOK_ID, 'package', true)],
      new Set(),
    );

    expect(warnings.map((w) => w.moduleId)).toEqual([OVERLAY_HOOK_ID]);
  });

  it('says nothing about a package, which the insert population never converged', () => {
    // D-157.6(b) already keeps a package out of the insert, so it has no row to
    // be silenced about: `module:install` still has all of its work to do. A
    // warning here would tell an operator to run a command that is not late.
    expect(
      bootConvergenceWarnings([entry(PACKAGE_HOOK_ID, 'package', true)], new Set()),
    ).toEqual([]);
  });

  it('reads the same population as the insert, by calling it rather than restating it', () => {
    // The two answers cannot disagree, because there is one: the warning walks
    // `firstBootInsertPopulation`'s output. A second origin test here would be
    // the D-100 shape in the function whose whole job is to describe the first.
    const entries = [
      entry(CORE_HOOK_ID, 'core', true),
      entry(OVERLAY_HOOK_ID, 'overlay', true),
      entry(PACKAGE_HOOK_ID, 'package', true),
    ];

    expect(bootConvergenceWarnings(entries, new Set()).map((w) => w.moduleId)).toEqual(
      firstBootInsertPopulation(entries)
        .filter((e) => e.installHook !== undefined)
        .map((e) => e.manifest.id),
    );
  });
});
