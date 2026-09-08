/**
 * A deployment's divergence declaration — the **location half**
 * (`specs/115-lifecycle-container-move/`, D115-3;
 * `contracts/operator-half.md` §4).
 *
 * The shape rule is `@endora-commerce/platform/lifecycle`'s
 * (`parseDivergenceDeclaration`, `emptyDivergenceDeclaration`): pure over
 * `DeploymentDivergenceDeclarationSchema`, no disk, no environment, no
 * deployment. What is here is everything that knows *where a deployment's file
 * is*, which is a fact about this repository's tree and about no other.
 *
 * ## Why the root is given, measured rather than preferred
 *
 * The root derivation was one `dirname` too high once: `declarationPathFor`
 * composed `backend/apps/<d>/divergence.ts`, `existsSync` said no, and **every
 * deployment read as declaring nothing**. D-101's declared escape from the boot
 * refusal had therefore never worked — in production or under `tsx` — and
 * nothing could see it while every declaration in the tree was empty, because an
 * absent file and an empty one are deliberately the same answer.
 *
 * Three `dirname`s from anywhere inside `packages/platform/` give a directory
 * that holds no `apps/` at all, so a file in the package deriving its own root
 * reproduces that state exactly, in the one mechanism where a wrong answer is
 * silent. R4.2. The root is therefore **given**, and the giver is
 * `overlay-roots.ts`: one expression, in the tree that owns `apps/`.
 *
 * ## What T114a deleted, and why it was a supplier nobody could supply
 *
 * This file used to carry a second location fact,
 * `RUNNING_FROM_DIST = import.meta.url.includes('/dist/')`, which chose between
 * `divergence.ts` and `divergence.js`. It was correct only while the file sat in
 * the application, and **silently** wrong everywhere else: the string is true
 * inside `packages/platform/dist/overlay/` under `tsx` as well as under `node`,
 * and true in every instance whose platform came out of `node_modules`, which is
 * all of them. An extension is not a fact anyone has to know — it is a fact
 * about which file is on disk, and the disk can be asked. So the flag is gone
 * and `resolveOverlayUnit` answers instead, `.js` before `.ts`, for the reason
 * `UNIT_EXTENSIONS` gives in place: the compiled tree is the one where picking
 * up a stray source file would be wrong
 * (`contracts/application-root-supplier.md` §3).
 *
 * `divergencePathFor` went with it. R3.6 asked only that it stop returning the
 * literal `backend/src/apps/<d>/divergence.ts` — *"a platform telling a client
 * that their declaration lives at … is a package asserting a layout it cannot
 * see"* — and the resolution answers that better than a recomposition does: the
 * path handed to `parseDivergenceDeclaration` is now the file the loader
 * actually read, so a refusal names the reader's own tree and the spelling that
 * is really in it. Its only caller was that one line, and a function whose
 * caller stopped needing it is the dead export §5 is about.
 *
 * ## Its consumers take the value, never the loader
 *
 * `composition.ts` and `test/helpers/test-server.ts` each call this once and
 * hand the result into `composeApp`'s options; `kernel/compose.ts` says so in
 * its own comment. `scripts/generate-divergence.ts` is the third and is a build
 * script. So the platform has always consumed the declaration by injection, and
 * the only thing D115-3 changed is that the shape rule stopped travelling with
 * the locator.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';
import {
  emptyDivergenceDeclaration,
  parseDivergenceDeclaration,
} from '@endora-commerce/platform/lifecycle';
import { resolveOverlayUnit } from '@endora-commerce/platform/overlay';
import { deploymentRoot, selectedDeployment } from './overlay-roots.js';

/**
 * The declaration file that is **on disk** for this deployment, or `null`.
 *
 * A resolution, never a derivation: `.js` in a compiled tree, `.ts` under `tsx`
 * and `vitest`, decided by asking rather than by a flag about the reader's own
 * location. It is the same seam `manifest` and `backend` go through one
 * directory over, which is what makes an instance that compiles its `apps/`
 * tree and one that does not both correct with nobody deciding (R3.4).
 */
function declarationPathFor(deployment: string, root: string): string | null {
  return resolveOverlayUnit(join(root, 'apps', deployment), 'divergence');
}

/**
 * The active deployment's declaration, or one that declares nothing.
 *
 * Impure by necessity — it reads the disk and the environment — which is exactly
 * why it is not part of `assertLockedModulesPresent`. That function stays pure so
 * its proof does not need a boot; this one answers "what did this deployment
 * declare?" and hands it over as data.
 *
 * @param root the deployment root holding `apps/`. A parameter rather than a
 *   derivation of this file's own path (R4.3, R1.1), so the answer survives this
 *   file moving and there is one derivation of it in the application. The
 *   default names that one derivation; `composeApp` supplies its own, which is
 *   what an instance's entry point does with a root this package cannot see.
 */
export async function loadDivergenceDeclaration(
  env: NodeJS.ProcessEnv = process.env,
  root: string = deploymentRoot(),
): Promise<DeploymentDivergenceDeclaration> {
  const deployment = selectedDeployment(env);
  if (deployment === null) return emptyDivergenceDeclaration();
  const path = declarationPathFor(deployment, root);
  if (path === null) return emptyDivergenceDeclaration();
  const loaded = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const declared = loaded['divergence'] ?? loaded['default'];
  if (declared === undefined) return emptyDivergenceDeclaration();
  return parseDivergenceDeclaration(declared, path);
}
