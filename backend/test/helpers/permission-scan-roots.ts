import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  defaultScanRoots,
  type PermissionScanRoot,
} from '../../../packages/modules/admin_roles/src/backend/permission-inventory.js';
import { findAdminShellRoot } from '../../scripts/lib/admin-surfaces.js';
import { resolveModuleLayout } from '../../scripts/lib/module-roots.js';
import { nodeWorkspaceFs, workspaceMembers } from '../../scripts/lib/workspace-packages.js';
import { activeOverlayModulesRoot } from '../../src/overlay/overlay-roots.js';

/**
 * Every directory this build enforces admin gates in — the application's own
 * tree and the active overlay, plus one root per module that has become a
 * workspace package (feature 080, T040b).
 *
 * The package half is supplied **by the caller** rather than inside the scanner
 * because the layout derivation lives in `scripts/lib/module-roots.ts`, which a
 * module may not import — `permission-inventory.ts` belongs to `admin_roles`,
 * and `check:module-boundary` is right to refuse the edge. The scanner has no
 * runtime caller, so the caller that already resolves the layout is the right
 * place for the answer.
 *
 * Leaving a packaged module out is not a smaller sweep: its codes stay
 * grantable and stop being enforced *anywhere the scan can see*, so the reverse
 * direction reports a checkbox on `/admin-roles` that grants nothing — which is
 * what `permission-inventory.test.ts` said about `blog.read` and `blog.write`
 * the day `blog` moved, with both gates sitting in `routes.admin.ts` untouched.
 *
 * It lives here, rather than in the one test that used to compute it, because
 * D-173's `foreign-gate` sweep asks a second question of the **same**
 * population: two derivations of "where does this build enforce gates" are two
 * answers waiting to disagree, and the one that came back short would be the
 * one reporting a clean tree.
 */
const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

export async function permissionScanRoots(): Promise<Array<string | PermissionScanRoot>> {
  const layout = await resolveModuleLayout();
  // Issue #1106 — the admin shell, located the way the admin-surface checks
  // locate it (the source root holding the route table and the nav), never by
  // naming its package. A host root and an Admin UI layer: no module owns it,
  // and its nav entries and tiles declare `requiredPermission` as data.
  const shellRoot = findAdminShellRoot(workspaceMembers(REPO_ROOT, nodeWorkspaceFs()));
  return [
    // The active deployment's overlay modules are resolved here too, since
    // feature 080's T051: `overlay/*` is how the platform discovers overlays,
    // and a module reading it as an installed package would be an artefact
    // enumerating its own siblings (`contracts/host-package.md` §1.4l). A test
    // helper is not a module.
    ...defaultScanRoots(layout.srcRoot, activeOverlayModulesRoot()),
    ...layout.moduleRoots
      .filter((root) => root.moduleId !== null)
      .map((root) => ({ dir: root.directory, moduleId: root.moduleId as string })),
    { dir: shellRoot, moduleId: null, adminLayer: true },
  ];
}
