import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { ModuleManifest } from '@b2b/contracts';
import {
  REGISTERED_MANIFESTS,
  deploymentShippedEntries,
  type RegisteredManifestEntry,
} from '../../../src/modules/_lifecycle/registered-manifests.js';
import { collectRegisteredSettingsManifests } from '../../../src/modules/settings/services/registered-settings-manifests.js';
import {
  coreModulesRoot,
  overlayModulesRootFor,
  repoRoot,
} from '../../../src/overlay/overlay-roots.js';

/**
 * Feature 080, T046 — which manifests the **boot** settings reconcile walks.
 *
 * Both composition roots used to hand `collectRegisteredSettingsManifests` the
 * bare-core `REGISTERED_MANIFESTS`, recorded in `composition.ts` as *"a cut and
 * not a widening"*. The cut has a live cost on the axis Principle XVII calls the
 * operator's: an **overlay** module's presence is converged by the first-boot
 * reconciler (`loadModulePresence`), so no `install` ever runs for it and boot is
 * the only author its settings rows can have. `example_overlay` declares
 * `activation: { settingCode: 'example_overlay.activation', default: true }` and
 * that row was never created — the module was installed, gated and switchable in
 * every respect except that the operator had nothing to switch.
 *
 * The population is therefore the **same split D-157.6(b) already ruled** for the
 * first-boot presence insert: core plus this deployment's overlay, never an
 * installed package. It is the same predicate, derived once
 * ({@link deploymentShippedEntries}), because two copies of an origin test are
 * two answers waiting to disagree (D-100).
 *
 * A package is excluded for a reason of its own, not merely for symmetry: since
 * D-157.6(b) a package's registration row has exactly one author, `install`,
 * which is also where its settings are reconciled
 * (`orchestrator.ts` step 2). Reconciling them at boot as well would let a
 * package that has been `pnpm add`ed and never installed abort a **boot** with
 * `SettingCodeConflict` — a stranger's manifest stopping a platform an operator
 * never asked it to join.
 *
 * Every fixture enters at the top of the analysis (issue #130): entries are built
 * from the real roots, so the origin derivation under test is the one that runs
 * in `composeApp()`.
 */

const CORE_ID = 'fixture_settings_core';
const OVERLAY_ID = 'fixture_settings_overlay';
const PACKAGE_ID = 'fixture_settings_package';

function manifest(id: string): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    dependencies: [],
    activation: { settingCode: `${id}.activation`, default: true },
    settings: {
      moduleCode: id,
      groups: [{ code: id, name: id }],
      settings: [
        {
          code: `${id}.activation`,
          name: `${id} enabled`,
          groupCode: id,
          valueType: 'boolean',
          defaultValue: true,
        },
      ],
    },
  } as ModuleManifest;
}

/** A core module's anchor: `backend/src/modules/<id>/manifest.ts`. */
function coreEntry(id: string): RegisteredManifestEntry {
  return { manifest: manifest(id), filePath: join(coreModulesRoot(), id, 'manifest.ts') };
}

/** An overlay module's anchor: `backend/src/apps/<deployment>/modules/<id>/manifest.ts`. */
function overlayEntry(id: string): RegisteredManifestEntry {
  return {
    manifest: manifest(id),
    filePath: join(overlayModulesRootFor('fixture_deployment'), id, 'manifest.ts'),
  };
}

/** A package's anchor is the resolved `package.json` that claimed the id. */
function packageEntry(id: string): RegisteredManifestEntry {
  return {
    manifest: manifest(id),
    filePath: join(repoRoot(), 'node_modules', '@vendor', id, 'package.json'),
  };
}

describe('the boot settings reconcile walks core and overlay, never a package', () => {
  it('keeps core and overlay entries and drops package entries', () => {
    const population = deploymentShippedEntries([
      coreEntry(CORE_ID),
      overlayEntry(OVERLAY_ID),
      packageEntry(PACKAGE_ID),
    ]);

    expect(population.map((entry) => entry.manifest.id)).toEqual([CORE_ID, OVERLAY_ID]);
  });

  it("reconciles an overlay module's activation Setting, so the operator has a row to flip", () => {
    const collected = collectRegisteredSettingsManifests(
      deploymentShippedEntries([coreEntry(CORE_ID), overlayEntry(OVERLAY_ID)]),
    );

    const overlaySettings = collected.find((m) => m.moduleCode === OVERLAY_ID);
    expect(
      overlaySettings,
      'an overlay module is converged by the first-boot reconciler and never installed, so ' +
        'boot is the only author its activation Setting can have (Principle XVII)',
    ).toBeDefined();
    expect(overlaySettings?.settings.map((s) => s.code)).toContain(`${OVERLAY_ID}.activation`);
  });

  it("leaves a package's settings to `install`, the only author of its registration row", () => {
    const collected = collectRegisteredSettingsManifests(
      deploymentShippedEntries([coreEntry(CORE_ID), packageEntry(PACKAGE_ID)]),
    );

    expect(collected.map((m) => m.moduleCode)).not.toContain(PACKAGE_ID);
  });

  it('classifies every module the committed core registry ships as reconcilable', () => {
    // If the origin derivation ever stops recognising this build's own modules,
    // a fresh database boots with no settings at all and `/settings` is empty —
    // so the whole core set is asserted rather than a sample.
    expect(deploymentShippedEntries(REGISTERED_MANIFESTS)).toHaveLength(
      REGISTERED_MANIFESTS.length,
    );
  });
});
