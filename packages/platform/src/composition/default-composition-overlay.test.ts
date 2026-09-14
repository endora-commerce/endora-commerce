import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultComposition } from './compose-app.js';

/**
 * `specs/124-instance-customisation-gap/` FR-001, FR-002 — the default
 * composition resolves an overlay module's **manifest** from the same root it
 * composes its **entry** from.
 *
 * ## The defect
 *
 * `defaultComposition` is the composition an instance takes: it ships no
 * generated manifest index, so every module it runs is an overlay module of its
 * own or an installed package. It composed `overlayModuleEntriesUnder(...)` and
 * passed `overlay: async () => []` to `resolveManifestEntries` four lines below
 * it. A client's overlay module therefore reached the container, the permission
 * gate and the presence projection — the registration half — and never
 * `lifecycleManifestRegistry`, which is built from the resolved manifest set.
 *
 * That is the state `resolveManifestEntries`' own doc block calls *"Principle
 * XVII defeated in silence"*, reproduced by construction on the one path an
 * instance takes: no `module_registrations` row from the boot reconcile, no
 * activation Setting on `/platform/modules`, and nothing for the operator to
 * switch the module off against. Measured on a scaffolded instance holding one
 * overlay module: the boot reconcile accounted for 31 modules while the presence
 * projection enumerated 32 — the same arithmetic the instance acceptance
 * criterion's A4 asserts, which is why A4 was one overlay module away from
 * flapping.
 *
 * ## Why this file rather than a boot
 *
 * `composeApp` opens a PostgreSQL, a Redis and the installed module set before
 * it composes anything, and the property under test is decided entirely by what
 * `defaultComposition` reads off disk. So the fixture is a **deployment root on
 * disk**, scanned by the code the deployment path runs, and the assertion is
 * over the two arrays `composeApp` then hands on — `modules` to `composeModules`
 * and `manifests` to `loadModulePresence` and the lifecycle registry
 * (`resolvedRegistry` is `composition.manifests`, one expression above the
 * `loadModulePresence` call). Nothing is handed to the last function in the
 * chain (issue #130).
 *
 * The fixture is JavaScript with a `package.json` declaring `type: module`,
 * because `resolveOverlayUnit` prefers `.js` over `.ts` and a temporary
 * directory is outside every transform this run configures. That is the same
 * spelling a compiled deployment ships (D-165 step C).
 */

const DEPLOYMENT = 'acme';
const OVERLAY_MODULE_ID = 'acme_pricing';

let deploymentRoot: string;
let env: NodeJS.ProcessEnv;

const manifestSource = `export const manifest = {
  id: '${OVERLAY_MODULE_ID}',
  name: 'Acme Pricing',
  version: '1.0.0',
  dependencies: [],
  activation: { settingCode: '${OVERLAY_MODULE_ID}.activation', default: true },
};
`;

const backendSource = `export function registerModule(ctx) {
  ctx.di.register({ acmePricingMarker: ctx.asValue('overlay') });
}
`;

beforeAll(() => {
  deploymentRoot = mkdtempSync(join(tmpdir(), 'endora-124-overlay-'));
  const moduleDir = join(deploymentRoot, 'apps', DEPLOYMENT, 'modules', OVERLAY_MODULE_ID);
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(deploymentRoot, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(join(moduleDir, 'manifest.js'), manifestSource);
  writeFileSync(join(moduleDir, 'backend.js'), backendSource);
  // `ENDORA_INSTANCE_ROOT` points the installed-package scan at the fixture,
  // which holds no `node_modules` — so the population under test is the overlay
  // tree plus the platform's own resident, and nothing else.
  env = { DEPLOYMENT, ENDORA_INSTANCE_ROOT: deploymentRoot };
});

afterAll(() => {
  rmSync(deploymentRoot, { recursive: true, force: true });
});

describe('defaultComposition — an overlay module is a whole lifecycle participant', () => {
  it('resolves the overlay module’s manifest, with origin "overlay"', async () => {
    const composition = await defaultComposition(deploymentRoot, env);

    const resolved = composition.manifests.find(
      (entry) => entry.manifest.id === OVERLAY_MODULE_ID,
    );

    expect(resolved).toBeDefined();
    expect(resolved?.origin).toBe('overlay');
    expect(resolved?.filePath).toContain(OVERLAY_MODULE_ID);
  });

  it('composes the overlay module as an entry, which never broke', async () => {
    // The half that already worked, kept as the discrimination: without it a
    // repair that dropped the registration half would pass the assertion above.
    const composition = await defaultComposition(deploymentRoot, env);

    const entry = composition.modules.find((module) => module.id === OVERLAY_MODULE_ID);

    expect(entry).toBeDefined();
    expect(entry?.overlay).toBe(true);
    expect(entry?.version).toBe('1.0.0');
  });

  it('accounts for every composed module in the resolved manifest set', async () => {
    // A4's arithmetic, at fixture scale. `composeApp` passes `composition.manifests`
    // to `loadModulePresence` as `resolvedRegistry` and composes
    // `composition.modules`; a module in the second and not the first is one the
    // reconcile cannot see. This assertion is the one that reads 31 against 32 on
    // an instance, and it is deliberately a set difference rather than a count, so
    // its failure names the module.
    const composition = await defaultComposition(deploymentRoot, env);

    const resolvedIds = new Set(composition.manifests.map((entry) => entry.manifest.id));
    const unaccounted = composition.modules
      .map((module) => module.id)
      .filter((id) => !resolvedIds.has(id));

    expect(unaccounted).toEqual([]);
  });

  it('leaves a deployment root with no overlay tree composing nothing extra', async () => {
    // The empty case, which `overlayModulesUnder` takes rather than each caller:
    // `DEPLOYMENT` names a deployment that has no `modules/` directory, so the
    // root is `null` and both seams must answer `[]` rather than one of them
    // throwing on a path that is not there.
    const bare = mkdtempSync(join(tmpdir(), 'endora-124-bare-'));
    try {
      const composition = await defaultComposition(bare, {
        DEPLOYMENT,
        ENDORA_INSTANCE_ROOT: bare,
      });

      expect(composition.modules.map((module) => module.id)).not.toContain(OVERLAY_MODULE_ID);
      expect(composition.manifests.map((entry) => entry.manifest.id)).not.toContain(
        OVERLAY_MODULE_ID,
      );
      expect(composition.modules.map((module) => module.id)).toContain('_lifecycle');
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
