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
 * ## Why this half stayed, measured rather than preferred
 *
 * The root derivation was one `dirname` too high once: `declarationPathFor`
 * composed `backend/apps/<d>/divergence.ts`, `existsSync` said no, and **every
 * deployment read as declaring nothing**. D-101's declared escape from the boot
 * refusal had therefore never worked — in production or under `tsx` — and
 * nothing could see it while every declaration in the tree was empty, because an
 * absent file and an empty one are deliberately the same answer.
 *
 * Three `dirname`s from `packages/platform/src/lifecycle/services/` give
 * `packages/platform/src`, so moving this file into the platform reproduces that
 * state exactly, in the one mechanism where a wrong answer is silent. R4.2. The
 * root is therefore **given** rather than derived from wherever this file sits,
 * and the giver is `overlay-roots.ts`, one directory's worth of layout knowledge
 * in the tree that owns `apps/`.
 *
 * ## Why it sits here rather than in `lifecycle/`
 *
 * It is a deployment concept, and `overlay-roots.ts` — whose `selectedDeployment`
 * it already calls — is where the deployment tree's layout is decided. Two
 * `import.meta.url` root derivations in one application are two answers waiting
 * to disagree, and there were exactly two: this file's and that one's,
 * byte-identical, which is how the second came to be written (R4.3). There is
 * now one.
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

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';
import {
  emptyDivergenceDeclaration,
  parseDivergenceDeclaration,
} from '@endora-commerce/platform/lifecycle';
import { applicationSourceRoot, selectedDeployment } from './overlay-roots.js';

/**
 * Whether this process is running the compiled tree.
 *
 * It stays a fact about *this* file's own location, and may: the file is the
 * application's and travels with the `apps/` directory it composes a path into.
 * `applicationSourceRoot()` already answers `backend/dist` under a compiled run,
 * so the two agree by construction rather than by anyone keeping them in step —
 * what this decides is the **extension**, which the root cannot carry.
 */
const RUNNING_FROM_DIST = import.meta.url.includes('/dist/');

/**
 * Repo-relative, for a refusal the reader can act on.
 *
 * It belongs to the repository and not to the package (R4.4): a platform
 * telling a client that their declaration lives at
 * `backend/src/apps/<d>/divergence.ts` is a package asserting a layout it cannot
 * see.
 */
export function divergencePathFor(deployment: string): string {
  return `backend/src/apps/${deployment}/divergence.ts`;
}

/**
 * Authored under `backend/src/apps/…`, compiled to `backend/dist/apps/…`. Under
 * tsx and vitest the `.ts` source is imported directly, which is the same
 * mapping the overlay loader makes for the same reason.
 */
function declarationPathFor(deployment: string, root: string): string {
  const path = join(root, 'apps', deployment, 'divergence.ts');
  return RUNNING_FROM_DIST ? path.replace(/\.ts$/, '.js') : path;
}

/**
 * The active deployment's declaration, or one that declares nothing.
 *
 * Impure by necessity — it reads the disk and the environment — which is exactly
 * why it is not part of `assertLockedModulesPresent`. That function stays pure so
 * its proof does not need a boot; this one answers "what did this deployment
 * declare?" and hands it over as data.
 *
 * @param root the application source root holding `apps/`. A parameter rather
 *   than a derivation of this file's own path (R4.3), so the answer survives
 *   this file moving and there is one derivation of it in the application. The
 *   default names that one derivation; a caller passing its own is the shape
 *   `specs/110-instance-repository/` Phase 2 needs when the application root
 *   itself becomes a parameter.
 */
export async function loadDivergenceDeclaration(
  env: NodeJS.ProcessEnv = process.env,
  root: string = applicationSourceRoot(),
): Promise<DeploymentDivergenceDeclaration> {
  const deployment = selectedDeployment(env);
  if (deployment === null) return emptyDivergenceDeclaration();
  const path = declarationPathFor(deployment, root);
  if (!existsSync(path)) return emptyDivergenceDeclaration();
  const loaded = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const declared = loaded['divergence'] ?? loaded['default'];
  if (declared === undefined) return emptyDivergenceDeclaration();
  return parseDivergenceDeclaration(declared, divergencePathFor(deployment));
}
