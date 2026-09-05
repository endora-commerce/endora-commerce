import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DeploymentDivergenceDeclarationSchema,
  type DeploymentDivergenceDeclaration,
} from '@endora-commerce/contracts';
import { selectedDeployment } from '../../overlay/overlay-roots.js';

/**
 * What a deployment declares about how it means to differ from core.
 *
 * Its first content is the declared escape from D-101's boot refusal. A
 * deployment may ship fewer modules than its manifests declare — that is the
 * reduced deployment feature 071's packaging split exists to make possible. What
 * it may not do is arrive at that state silently: the owner's E1 ruling is that
 * *"someone deliberately assembling a reduced deployment must declare that they
 * know"*.
 *
 * The declaration is a **committed, reviewed, per-deployment file**, not a flag.
 * D-69 refused a `--force` on the orchestrator's withdrawal guard on the ground
 * that a flag is weighed once, at 2 a.m., by one person; the same reasoning
 * points the same way here. A committed entry appears in the merge request that
 * assembles the deployment, where somebody who is not mid-incident reads it.
 *
 * `backend/src/apps/<deployment>/divergence.ts`, exporting `divergence`. No
 * file, or a declaration with nothing in it, means "this deployment differs from
 * core in no way it has to declare" — which is what `apps/example` says, in a
 * file that exists so the mechanism is discoverable rather than folklore.
 *
 * The file was `reduced-deployment.ts` exporting a bare array until D-205: it
 * now carries the omissions, the decoration order and one reason per derived
 * divergence, and *reduced* encodes a direction three of those do not have.
 *
 * The shape is {@link DeploymentDivergenceDeclaration}, declared in
 * `@endora-commerce/contracts`: the file carrying it belongs to a deployment, and a
 * deployment naming this module's internals is the coupling that outlives the
 * module (`test/unit/kernel/module-removal.test.ts` counts exactly that).
 */

/** `backend/src` — this file lives at `backend/src/lifecycle/services/`. */
const BACKEND_SRC = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const RUNNING_FROM_DIST = import.meta.url.includes('/dist/');

/** Repo-relative, for a refusal the reader can act on. */
export function divergencePathFor(deployment: string): string {
  return `backend/src/apps/${deployment}/divergence.ts`;
}

/**
 * Authored under `backend/src/apps/…`, compiled to `backend/dist/apps/…`. Under
 * tsx and vitest the `.ts` source is imported directly, which is the same
 * mapping the overlay loader makes for the same reason.
 */
function declarationPathFor(deployment: string): string {
  const source = join(BACKEND_SRC, 'apps', deployment, 'divergence.ts');
  return RUNNING_FROM_DIST ? source.replace('/src/', '/dist/').replace(/\.ts$/, '.js') : source;
}

/** A declaration that declares nothing — an absent file's answer, as data. */
export function emptyDivergenceDeclaration(): DeploymentDivergenceDeclaration {
  return { omittedModules: [], decorationOrder: {}, reasons: {} };
}

/**
 * A declaration is only a declaration if each entry carries its reason.
 *
 * Exported and pure so the shape rules have a proof that does not need a
 * deployment on disk: a fixture enters here as the raw exported value, which is
 * the top of this analysis rather than something the loader already computed.
 *
 * A field left out means *none of these*, which is the reading an absent file
 * already gets; a field that is present and malformed is refused, naming the
 * deployment's own file. An **array** is refused with the shape it should have
 * had, because that is what every declaration in the tree looked like before
 * D-205 and a client copying an older one deserves the sentence rather than
 * `expected object, received array`.
 */
export function parseDivergenceDeclaration(
  value: unknown,
  path: string,
): DeploymentDivergenceDeclaration {
  if (Array.isArray(value)) {
    throw new Error(
      `${path} must export \`divergence\` as an object — ` +
        '{ omittedModules, decorationOrder, reasons }. It was an array, which is the shape ' +
        'the declaration had while it carried omissions and nothing else (D-205); the ' +
        'omissions move into `omittedModules` unchanged.',
    );
  }
  const parsed = DeploymentDivergenceDeclarationSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(declaration)'}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `${path} is not a declaration — ${detail}. An omission says which module this ` +
        'deployment does not ship and what it does instead; the sentence is the review.',
    );
  }
  return parsed.data;
}

/**
 * The active deployment's declaration, or one that declares nothing.
 *
 * Impure by necessity — it reads the disk and the environment — which is exactly
 * why it is not part of `assertLockedModulesPresent`. That function stays pure so
 * its proof does not need a boot; this one answers "what did this deployment
 * declare?" and hands it over as data.
 */
export async function loadDivergenceDeclaration(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeploymentDivergenceDeclaration> {
  const deployment = selectedDeployment(env);
  if (deployment === null) return emptyDivergenceDeclaration();
  const path = declarationPathFor(deployment);
  if (!existsSync(path)) return emptyDivergenceDeclaration();
  const loaded = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const declared = loaded['divergence'] ?? loaded['default'];
  if (declared === undefined) return emptyDivergenceDeclaration();
  return parseDivergenceDeclaration(declared, divergencePathFor(deployment));
}
