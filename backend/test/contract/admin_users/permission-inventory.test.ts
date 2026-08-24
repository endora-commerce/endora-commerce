import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REGISTERED_MANIFESTS,
  resolvedManifestEntries,
} from '../../../src/modules/_lifecycle/registered-manifests.js';
import {
  defaultScanRoots,
  scanEnforcedPermissionGates,
} from '../../../src/modules/admin_roles/permission-inventory.js';
import { resolveModuleLayout } from '../../../scripts/lib/module-roots.js';
import { activeOverlayModulesRoot } from '../../../src/overlay/overlay-roots.js';
import { listAssignablePermissionCodes } from '../../../src/modules/admin_roles/services/permission-catalogue.service.js';

/**
 * The `/admin-roles` catalogue and the server's gates have to describe the same
 * set of codes, in both directions (feature 026, SC-001):
 *
 *  - a gate argument the scanner cannot read is a code nothing checks;
 *  - a code enforced but not assignable is a screen only a `'*'` role can open;
 *  - a code assignable but enforced nowhere is a checkbox that grants nothing;
 *  - a code with no `adminRoles.permission.<code>` entry falls back to the
 *    manifest label, which is English-only however many languages ship.
 *
 * These sweeps replace a `toBe(<count>)` assertion that carried a per-feature
 * changelog: a number cannot say which side of the pair moved, and every feature
 * had to edit it whether or not anything was wrong.
 *
 * The scan is deployment-resolved on both sides — the gates under the active
 * overlay root and the manifests discovered for it (feature 057, FR-009) — so
 * `DEPLOYMENT=<name>` checks that deployment and a bare-core run checks core.
 */

const I18N_DIR = fileURLToPath(new URL('../../../src/modules/_i18n/i18n/', import.meta.url));
const SHIPPED_LANGUAGES = ['en', 'pl'] as const;

function bundleFor(language: string): Record<string, string> {
  return JSON.parse(readFileSync(`${I18N_DIR}${language}.json`, 'utf8')) as Record<string, string>;
}

/**
 * Deployment-resolved at module scope, with a top-level `await`: since D-104 the
 * deployment half of the manifest set is a runtime discovery rather than a
 * generated artefact's branch, so resolving it is asynchronous. It reads the
 * ambient `DEPLOYMENT`, which is what makes `DEPLOYMENT=<name>` sweep that
 * deployment's codes and a bare-core run sweep core's.
 */
const RESOLVED_MANIFESTS = await resolvedManifestEntries();

/**
 * Every directory this build enforces gates in — the application's own tree and
 * the active overlay, plus one root per module that has become a workspace
 * package (feature 080, T040b).
 *
 * The package half is supplied **here** rather than inside the scanner because
 * the layout derivation lives in `scripts/lib/module-roots.ts`, which a module
 * may not import — `permission-inventory.ts` belongs to `admin_roles`, and
 * `check:module-boundary` is right to refuse the edge. The scanner has no
 * runtime caller, so the caller that already resolves the layout is the right
 * place for the answer.
 *
 * Leaving a packaged module out is not a smaller sweep: its codes stay
 * grantable and stop being enforced *anywhere the scan can see*, so the
 * reverse direction reports a checkbox on `/admin-roles` that grants nothing —
 * which is what this file said about `blog.read` and `blog.write` the day
 * `blog` moved, with both gates sitting in `routes.admin.ts` untouched.
 */
const SCAN_ROOTS = await (async () => {
  const layout = await resolveModuleLayout();
  return [
    // The active deployment's overlay modules are resolved here too, since
    // feature 080's T051: `overlay/*` is how the platform discovers overlays,
    // and a module reading it as an installed package would be an artefact
    // enumerating its own siblings (`contracts/host-package.md` §1.4l). This
    // file is not a module.
    ...defaultScanRoots(activeOverlayModulesRoot()),
    ...layout.moduleRoots
      .filter((root) => root.moduleId !== null)
      .map((root) => ({ dir: root.directory, moduleId: root.moduleId as string })),
  ];
})();

describe('permission inventory (SC-001)', () => {
  const scan = scanEnforcedPermissionGates(SCAN_ROOTS);
  const assignable = listAssignablePermissionCodes(RESOLVED_MANIFESTS);
  /**
   * The `adminRoles.permission.<code>` keys live in the `core` namespace, and
   * `AdminRolesPage` falls back to the manifest `label` when a key is absent.
   * An overlay module ships its own bundle and takes that fallback by design,
   * so the label sweeps run over the core-owned codes only.
   */
  const coreAssignable = listAssignablePermissionCodes(REGISTERED_MANIFESTS);

  it('resolves every enforcement site to a code, a bare admin gate or a runtime value', () => {
    const unresolved = scan.unresolved.map((site) => `${site.file}: ${site.expression}`);
    expect(
      unresolved,
      'gate arguments the inventory scanner cannot read — it therefore cannot ' +
        'check them, so either write the code as a literal or a resolvable ' +
        'constant, or teach the scanner the shape',
    ).toEqual([]);
    // Non-vacuity needs no count of its own: a scanner that stopped matching
    // would report no enforced code at all, and the reverse sweep below fails
    // on every assignable code at once.
  });

  it('every enforced code is assignable on /admin-roles', () => {
    const assignableSet = new Set(assignable);
    const missing = [...scan.codes].filter((code) => !assignableSet.has(code)).sort();
    const where = missing
      .map((code) => {
        const sites = scan.sites.filter((s) => s.codes.includes(code));
        return `${code} (${sites.map((s) => s.file).join(', ')})`;
      })
      .join('; ');
    expect(
      missing,
      `enforced but not grantable — declare each in the owning module's manifest ` +
        `\`permissions\`, or drop the gate: ${where}`,
    ).toEqual([]);
  });

  it('every assignable code is enforced somewhere', () => {
    const stale = assignable.filter((code) => !scan.codes.has(code)).sort();
    expect(
      stale,
      'grantable but enforced by no gate and no capability check — a checkbox ' +
        'on /admin-roles that grants nothing',
    ).toEqual([]);
  });

  it.each(SHIPPED_LANGUAGES)('every core assignable code has a %s label', (language) => {
    const bundle = bundleFor(language);
    const missing = coreAssignable.filter((code) => !(`adminRoles.permission.${code}` in bundle));
    expect(missing, `missing adminRoles.permission.<code> entries in ${language}.json`).toEqual([]);
  });

  it.each(SHIPPED_LANGUAGES)('the %s bundle carries no label for a dropped code', (language) => {
    const assignableSet = new Set(coreAssignable);
    const prefix = 'adminRoles.permission.';
    const orphaned = Object.keys(bundleFor(language))
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter((code) => !assignableSet.has(code));
    expect(orphaned, `${language}.json labels codes no module declares`).toEqual([]);
  });
});
