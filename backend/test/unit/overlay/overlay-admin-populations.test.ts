import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scanEnforcedPermissionGates } from '../../../../packages/modules/admin_roles/src/backend/permission-inventory.js';
import {
  analyse,
  loadActions,
  overlayRouteSources,
} from '../../../scripts/check-action-route-permissions.js';
import { permissionScanRoots } from '../../helpers/permission-scan-roots.js';
import { deploymentRoot, overlayModulesRootFor } from '../../../src/overlay/overlay-roots.js';

/**
 * The permission inventory and `check:action-route-permissions`, run with
 * `DEPLOYMENT=<name>`, include that deployment's overlay admin layers and
 * palette actions (`specs/190-overlay-full-modules/` T047, FR-086, #1855).
 *
 * Each proof enters at the population the real run builds — the scan roots the
 * contract test sweeps, the action list and route sources the check reads — and
 * the fixture is `overlay_notes_fixture`, the example deployment's overlay
 * module with an admin layer and a palette action. A red proof here is that
 * fixture's action or admin layer seen by the check, not a synthetic record
 * handed to the comparison.
 */

const DEPLOYMENT = 'example';
const MODULE = 'overlay_notes_fixture';

let before: string | undefined;
beforeAll(() => {
  before = process.env['DEPLOYMENT'];
  process.env['DEPLOYMENT'] = DEPLOYMENT;
});
afterAll(() => {
  if (before === undefined) delete process.env['DEPLOYMENT'];
  else process.env['DEPLOYMENT'] = before;
});

describe('the permission inventory reads the overlay admin layer (DEPLOYMENT=example)', () => {
  it("counts the layer's `requiredPermission` declarations as sites of the overlay module", async () => {
    const scan = scanEnforcedPermissionGates(await permissionScanRoots());
    const sites = scan.sites.filter((site) => site.file.includes(`/${MODULE}/admin/`));

    expect(sites.map((site) => site.moduleId)).toEqual(sites.map(() => MODULE));
    expect(new Set(sites.flatMap((site) => site.codes))).toEqual(new Set([`${MODULE}:read`]));
    // The route element is an enforcement site, the nav entry an admin control.
    expect(new Set(sites.map((site) => site.surface))).toEqual(new Set(['enforcement', 'admin-control']));
  });

  it('is bare core without DEPLOYMENT, so a deployment is judged only where it is composed', async () => {
    delete process.env['DEPLOYMENT'];
    try {
      const scan = scanEnforcedPermissionGates(await permissionScanRoots());
      expect(scan.sites.filter((site) => site.file.includes(`/${MODULE}/`))).toEqual([]);
    } finally {
      process.env['DEPLOYMENT'] = DEPLOYMENT;
    }
  });
});

describe('check:action-route-permissions reads the overlay action (DEPLOYMENT=example)', () => {
  const overlayRoot = overlayModulesRootFor(DEPLOYMENT);
  const sourcesOf = (): Map<string, string> =>
    new Map(
      overlayRouteSources(overlayRoot).map((file) => [relative(deploymentRoot(), file), readFileSync(file, 'utf8')]),
    );

  it("leaves the overlay admin layer's browser code out of the route walk", () => {
    const files = overlayRouteSources(overlayRoot).map((file) => relative(overlayRoot, file));
    expect(files).toContain(`${MODULE}/backend.ts`);
    expect(files.filter((file) => file.startsWith(`${MODULE}/admin/`))).toEqual([]);
  });

  it("loads the overlay module's palette action, and agrees with the gate on its entry route", async () => {
    const { actions } = await loadActions({ DEPLOYMENT });
    const overlay = actions.filter((action) => action.moduleId === MODULE);
    expect(overlay.map((action) => action.actionId)).toEqual(['open-overlay-notes-fixture']);

    expect(analyse({ sources: sourcesOf(), actions: overlay }, {}).findings).toEqual([]);
  });

  it('is red when that action declares a code its entry route does not enforce', async () => {
    const { actions } = await loadActions({ DEPLOYMENT });
    const wrong = actions
      .filter((action) => action.moduleId === MODULE)
      .map((action) => ({ ...action, requiredPermission: 'example_overlay:manage' }));

    const findings = analyse({ sources: sourcesOf(), actions: wrong }, {}).findings;
    expect(findings.map((finding) => [finding.kind, finding.declared, finding.enforced])).toEqual([
      ['mismatched', 'example_overlay:manage', `${MODULE}:read`],
    ]);
  });
});
