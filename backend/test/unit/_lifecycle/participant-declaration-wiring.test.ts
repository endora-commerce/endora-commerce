import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverModulePackages } from '../../../scripts/lib/module-packages.js';
import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import { describe, expect, it } from 'vitest';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { buildStaticRegistry } from '../../../src/modules/_lifecycle/services/static-registry.js';

/**
 * Feature 080, T036a / D-159 — the participants reach the **terminal**, not
 * only the admin screen.
 *
 * This is the wiring half of `lifecycle-participants.test.ts`: that file proves
 * the orchestrator runs whatever participants its registry carries, this one
 * proves the registry a `module:*` command builds actually carries them. Both
 * are needed, because the defect was entirely in the second — the orchestrator
 * ran the reconcilers it was given, and the CLI gave it none.
 *
 * The subject of the source assertions is the five scripts' own text, for the
 * reason `module-cli-resolved-registry.test.ts` states: running them writes to
 * whatever database `DATABASE_URL` names.
 */

const MODULES_DECLARING_A_PARTICIPANT = ['_i18n', 'admin_actions'] as const;

const SCRIPTS = ['install', 'uninstall', 'enable', 'disable', 'status'] as const;

/** A file under `backend/src`, for the host-owned sources this file asserts on. */
const sourceOf = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../src/${relative}`, import.meta.url)), 'utf8');

/**
 * The **source** of a module's manifest, wherever the module lives.
 *
 * `src/modules/<id>/manifest.ts` stopped being the answer for `admin_actions`
 * the moment it became a package (feature 080, T040b), and a path built from
 * segments is invisible to every specifier rewrite — the file is simply not
 * there and the test reports ENOENT rather than a claim about the manifest. So
 * the package tree is asked where its own sources are: the root `exports`
 * target is `dist/manifest.js`, and `tsconfig.build.json`'s `outDir`/`rootDir`
 * map that back to `src/manifest.ts` (D-100 — derived per run, not written
 * down).
 */
const manifestSourceOf = (id: string): string => {
  const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  if (repoRoot === null) throw new Error('no pnpm-workspace.yaml above this test');
  const pkg = discoverModulePackages(repoRoot).find((candidate) => candidate.moduleId === id);
  if (pkg === undefined) {
    return readFileSync(
      fileURLToPath(new URL(`../../../src/modules/${id}/manifest.ts`, import.meta.url)),
      'utf8',
    );
  }
  const target = pkg.exports.get('.');
  if (target === undefined || pkg.emit === null) {
    throw new Error(`${id}'s package declares no root export or no build layout`);
  }
  const withinOut = target.replace(/^\.\//, '').slice(`${pkg.emit.outDir}/`.length);
  const source = withinOut.replace(/\.js$/, '.ts');
  return readFileSync(join(pkg.dir, pkg.emit.rootDir, source), 'utf8');
};

describe('the two projection-keeping modules declare a lifecycle participant', () => {
  it.each(MODULES_DECLARING_A_PARTICIPANT)('%s exports one from its manifest', (id) => {
    const source = manifestSourceOf(id);

    expect(source).toMatch(/export const lifecycleParticipant/);
    // Light manifest (D-159 §4): the generated index is imported by every check
    // script and by `configured-migrations.ts`, so the service graph the body
    // needs is pulled in at call time and not at import.
    expect(source).toMatch(/await import\(/);
  });

  it.each(MODULES_DECLARING_A_PARTICIPANT)(
    'the generated manifest index carries %s’s participant',
    (id) => {
      const entry = DISCOVERED_MANIFESTS.find((e) => e.id === id);

      expect(entry, `${id} is missing from the generated index`).toBeDefined();
      expect(typeof entry?.lifecycleParticipant?.onModuleInstalled).toBe('function');
      expect(typeof entry?.lifecycleParticipant?.onModuleHardUninstalled).toBe('function');
    },
  );

  it('and no other core module declares one, so the two are the whole population', () => {
    const declaring = DISCOVERED_MANIFESTS.filter((e) => e.lifecycleParticipant).map((e) => e.id);

    expect(declaring.sort()).toEqual([...MODULES_DECLARING_A_PARTICIPANT].sort());
  });
});

describe('a registry built the way a module: command builds one carries them', () => {
  it('buildStaticRegistry over the registered manifests enumerates both', () => {
    const registry = buildStaticRegistry(REGISTERED_MANIFESTS);

    expect(registry.participants).not.toBeNull();
    expect(registry.participants?.map((p) => p.moduleId).sort()).toEqual([
      ...MODULES_DECLARING_A_PARTICIPANT,
    ].sort());
  });

  it.each(SCRIPTS)('%s hands the resolved entries over without re-mapping them', (name) => {
    // The five scripts used to re-map every entry into a fresh object literal,
    // field by field. That literal is where a field added later is dropped:
    // six copies of one identity map, and the one thing that must not be
    // forgotten is the field nobody had written yet. Passing the entries
    // through is what makes the drop impossible rather than merely unlikely.
    // The positive half — that the registry is built from the resolved set —
    // is `module-cli-resolved-registry.test.ts`'s, and stays there. What this
    // asserts is the absence of the re-map, which is the property that makes
    // the drop impossible rather than merely absent today.
    const source = sourceOf(`modules/_lifecycle/scripts/${name}.ts`);

    expect(source).not.toMatch(/resolvedManifestEntries\(\)\)\.map\(/);
    expect(source).not.toMatch(/installHook: e\.installHook/);
  });
});

describe('the orchestrator takes no reconciler from a composition root any more', () => {
  it('OrchestratorDeps declares neither i18nReconciler nor adminActionsReconciler', () => {
    const source = sourceOf('modules/_lifecycle/services/orchestrator.ts');

    expect(source).not.toMatch(/i18nReconciler\??:/);
    expect(source).not.toMatch(/adminActionsReconciler\??:/);
  });

  it('composition.ts forwards neither, so a switched-off palette cannot abort an install', () => {
    // D-159 §9, the owner's ruling of 2026-08-22. `composition.ts` used to
    // forward `adminActionsReconciler` through a lambda so that a switched-off
    // command palette aborted the install of an *unrelated* module — chosen
    // over the only alternative then on the table, a backend that would not
    // start. The participant is invoked from the manifest and is gated on
    // nothing, so the rows are written whether or not anything is serving them,
    // which is what a projection should do.
    const source = sourceOf('composition.ts');

    expect(source).not.toMatch(/i18nReconciler:/);
    expect(source).not.toMatch(/adminActionsReconciler:/);
  });
});
