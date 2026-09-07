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

/**
 * Every UI-layer directory a module package may ship — one declaration, the two
 * readers above (feature 091, P4a; Z9 of `admin-component-contribution.md`).
 *
 * `admin-ui` is the sibling directory D-191's published-component exit lands
 * in, and it has a name of its own below because a **third** reader needs it
 * specifically rather than as one of the two: `module-package-manifest.ts`'
 * R4 refusal has to tell a published component's subpath apart from `./admin`,
 * which publishes a contribution *descriptor* no other module may name.
 *
 * It is a **sibling** and not a second entry file inside `src/admin/`, because
 * `admin-contribution.md` R2 is *"`src/admin/index.ts` exports exactly one
 * value"* and a second file in that directory turns the rule into a rule with a
 * filename carve-out.
 *
 * The first two readers take the list rather than the single name, and the
 * second of them is why
 * this lands with the mechanism rather than with the first package that ships
 * the directory: `check-action-route-permissions` skips a UI layer for a reason
 * that is about **browser code**, not about `admin` in particular — a published
 * component's `apiClient.post(path, body)` is a method, a path and no
 * `preHandler`, which is indistinguishable from an ungated route at the syntax
 * that check reads. A skip that arrives with the directory arrives one merge
 * request after the false finding.
 */
export const PUBLISHED_COMPONENT_LAYER_DIRECTORY = 'admin-ui';

export const UI_LAYER_DIRECTORIES: readonly string[] = [
  ADMIN_LAYER_DIRECTORY,
  PUBLISHED_COMPONENT_LAYER_DIRECTORY,
];
