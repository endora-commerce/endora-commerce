/**
 * The one name of a module package's UI layer (feature 091).
 *
 * It has two readers that must not disagree, and they are on opposite sides of
 * the build:
 *
 *  * `lib/module-package-manifest.ts` renders `"./admin"` into a package's
 *    `exports` map and switches the package's `build` to a second `tsc`
 *    invocation when the directory is there;
 *  * `check-action-route-permissions.ts` **skips** the directory, because its
 *    subject is Fastify registrations and a screen's `api/*-client.ts` writes
 *    `apiClient.post(`${BASE}/custom-events`, body)` — a method, a path and no
 *    `preHandler`, which is indistinguishable from an ungated route at the
 *    syntax that check reads. The first module to move its admin directory into
 *    its package therefore made one of its own routes report as gated by
 *    nothing (feature 091, Phase 4).
 *
 * It lives in a file of its own rather than in the manifest generator because
 * of *where* the second reader runs: `moved-module-tree.test.ts` spawns every
 * check over a synthetic backend that holds `backend/` and not the repository
 * root, and `module-package-manifest.ts` imports `scripts/lib/runtime-assets.mjs`
 * from that root. Importing it for one string turns a check into one that
 * cannot start in the fixture built to prove the check refuses a moved tree.
 */

/** The layer that compiles under `tsconfig.ui.json` rather than the backend build. */
export const ADMIN_LAYER_DIRECTORY = 'admin';
