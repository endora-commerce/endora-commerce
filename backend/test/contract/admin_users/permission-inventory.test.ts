import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REGISTERED_MANIFESTS,
  resolvedManifestEntries,
} from '../../../src/lifecycle/registered-manifests.js';
import { scanEnforcedPermissionGates } from '../../../../packages/modules/admin_roles/src/backend/permission-inventory.js';
import { permissionScanRoots } from '../../helpers/permission-scan-roots.js';
import { listAssignablePermissionCodes } from '../../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js';

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

const I18N_DIR = fileURLToPath(
  new URL('../../../../packages/modules/_i18n/i18n/', import.meta.url),
);
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
 * Every directory this build enforces gates in — resolved by
 * `test/helpers/permission-scan-roots.ts`, which carries the reasoning.
 *
 * It used to be computed here. D-173's `foreign-gate` sweep asks a second
 * question of the same population, and two derivations of "where does this
 * build enforce gates" are two answers waiting to disagree — with the short one
 * reporting a clean tree.
 */
const SCAN_ROOTS = await permissionScanRoots();

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
