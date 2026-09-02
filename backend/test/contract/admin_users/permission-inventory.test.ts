import { SUPPORTED_LANGUAGES } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import {
  REGISTERED_MANIFESTS,
  resolvedManifestEntries,
} from '../../../src/lifecycle/registered-manifests.js';
import { scanEnforcedPermissionGates } from '../../../../packages/modules/admin_roles/src/backend/permission-inventory.js';
import { permissionScanRoots } from '../../helpers/permission-scan-roots.js';
import {
  PermissionCatalogueService,
  listAssignablePermissionCodes,
} from '../../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js';
import {
  LEGACY_LABEL_MODULE_ID,
  LEGACY_PERMISSION_LABELS,
  compareToLegacyBlock,
  countLegacyLabelsByOwner,
  findPermissionLabelDefects,
  permissionLabelReadSize,
  walkPermissionLabels,
  type PermissionLabelInput,
} from '../../helpers/permission-labels.js';
import { readSizeLine, readSizeRefusal } from '../../../scripts/lib/read-size.js';

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
 * The last of the four is the second `describe` below, and since feature 091's
 * Phase 3 it asks a sharper question than "is the label in `_i18n`": a module
 * owns its own labels, and what is left in the shared bundle is a ratcheted
 * legacy block.
 *
 * These sweeps replace a `toBe(<count>)` assertion that carried a per-feature
 * changelog: a number cannot say which side of the pair moved, and every feature
 * had to edit it whether or not anything was wrong.
 *
 * The scan is deployment-resolved on both sides — the gates under the active
 * overlay root and the manifests discovered for it (feature 057, FR-009) — so
 * `DEPLOYMENT=<name>` checks that deployment and a bare-core run checks core.
 */

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

});

/**
 * A module owns its own permission labels — feature 091, Phase 3.
 *
 * `/admin-roles` translates every catalogue row through
 * `adminRoles.permission.<code>`, and until this phase that key had one home:
 * `_i18n`'s bundle, which no module installed from a registry can edit. The
 * rule is now the one every other module-owned string already follows, and
 * `_i18n`'s remaining labels are {@link LEGACY_PERMISSION_LABELS}, a two-way
 * ratchet in `test/helpers/permission-labels.ts`.
 *
 * The sweep is **core-only**, for the reason the inventory's label sweeps
 * always were: an overlay module is deployment-resolved and its bundle is not
 * in this repository's tree under a bare-core run.
 */
describe('permission labels (feature 091, Phase 3)', () => {
  const walk = walkPermissionLabels(REGISTERED_MANIFESTS);
  const owners = new PermissionCatalogueService({
    registryEntries: REGISTERED_MANIFESTS,
  }).listOwnersByCode();
  const input: PermissionLabelInput = {
    owners,
    bundles: walk.bundles,
    languages: SUPPORTED_LANGUAGES,
  };
  const findings = findPermissionLabelDefects(input);
  const counts = countLegacyLabelsByOwner(input);

  /**
   * What the sweep read, beside what it found (issue #244) — and the three
   * refusals that make "found nothing" distinguishable from "read nothing".
   *
   * The independent derivation is the generated manifest index: it says how
   * many modules declare a permission, the walk says how many of their
   * directories it located. A module tree that moved leaves every
   * `dirname(filePath)` pointing at nothing, so the walk comes back short
   * rather than clean over the remainder (issue #215).
   */
  it('discloses what it read, and refuses a walk that came back short', () => {
    const record = permissionLabelReadSize(walk);
    const refusal = readSizeRefusal(record);
    expect(
      refusal === null ? null : `${refusal.kind}: ${refusal.message}`,
      'the label sweep may not report on a population it did not read',
    ).toBeNull();
    // eslint-disable-next-line no-console -- the disclosure is the point (issue #244).
    console.log(readSizeLine(record));
  });

  it('every code is labelled by its owner, or by the legacy block, in every language', () => {
    const missing = findings
      .filter((f) => f.kind === 'missing-label' || f.kind === 'split-label')
      .map((f) => `${f.kind} ${f.code} [${f.module}] ${f.language ?? ''}: ${f.detail}`);
    expect(
      missing,
      `a code with no label falls back to the manifest \`label\`, which is English-only ` +
        `however many languages ship`,
    ).toEqual([]);
  });

  it('no module labels a code it does not own, and the shared bundle labels no dropped code', () => {
    const foreign = findings
      .filter((f) => f.kind === 'foreign-label' || f.kind === 'orphan-legacy-label')
      .map((f) => `${f.kind} ${f.code} [${f.module}]: ${f.detail}`);
    expect(foreign).toEqual([]);
  });

  it('the legacy block records exactly what is left in the shared bundle', () => {
    const drift = compareToLegacyBlock(counts, LEGACY_PERMISSION_LABELS);
    expect(
      drift.unrecorded.map((d) => `${d.owner}: ${d.actual} labels, block records ${d.declared}`),
      `a permission label was added to \`${LEGACY_LABEL_MODULE_ID}\`'s bundle instead of the ` +
        `owning module's own — put it in packages/modules/<owner>/i18n/{en,pl}.json. Do not ` +
        `raise a number in LEGACY_PERMISSION_LABELS to make this pass.`,
    ).toEqual([]);
    expect(
      drift.stale.map((d) => `${d.owner}: ${d.actual} labels, block still records ${d.declared}`),
      `labels moved out of the shared bundle and LEGACY_PERMISSION_LABELS still claims them — ` +
        `lower the number, or delete the entry when the owner has drained`,
    ).toEqual([]);
  });
});
