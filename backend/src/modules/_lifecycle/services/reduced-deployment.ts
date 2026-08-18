import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ReducedDeploymentDeclarationSchema,
  type ReducedDeploymentDeclaration,
} from '@b2b/contracts';
import { selectedDeployment } from '../../../overlay/overlay-roots.js';

/**
 * The declared escape from D-101's boot refusal.
 *
 * A deployment may ship fewer modules than its manifests declare — that is the
 * reduced deployment feature 071's packaging split exists to make possible. What
 * it may not do is arrive at that state silently: the owner's E1 ruling is that
 * *"someone deliberately assembling a reduced deployment must declare that they
 * know"*.
 *
 * The declaration is a **committed, reviewed, per-deployment file**, not a flag,
 * and the shape is the one every other ledger in this repository already has —
 * an entry per omission, each carrying a reason in prose. D-69 refused a
 * `--force` on the orchestrator's withdrawal guard on the ground that a flag is
 * weighed once, at 2 a.m., by one person; the same reasoning points the same way
 * here. A committed entry appears in the merge request that assembles the
 * deployment, where somebody who is not mid-incident reads it.
 *
 * `backend/src/apps/<deployment>/reduced-deployment.ts`, exporting
 * `reducedDeployment`. No file, or an empty array, means "this deployment ships
 * the full set" — which is what `apps/example` says, in a file that exists so the
 * mechanism is discoverable rather than folklore.
 *
 * The entry shape is {@link ReducedDeploymentDeclaration}, declared in
 * `@b2b/contracts`: the file carrying it belongs to a deployment, and a
 * deployment naming this module's internals is the coupling that outlives the
 * module (`test/integration/kernel/module-removal.test.ts` counts exactly that).
 */

/** `backend/src` — this file lives at `backend/src/modules/_lifecycle/services/`. */
const BACKEND_SRC = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const RUNNING_FROM_DIST = import.meta.url.includes('/dist/');

/**
 * Authored under `backend/src/apps/…`, compiled to `backend/dist/apps/…`. Under
 * tsx and vitest the `.ts` source is imported directly, which is the same
 * mapping the overlay loader makes for the same reason.
 */
function ledgerPathFor(deployment: string): string {
  const source = join(BACKEND_SRC, 'apps', deployment, 'reduced-deployment.ts');
  return RUNNING_FROM_DIST ? source.replace('/src/', '/dist/').replace(/\.ts$/, '.js') : source;
}

/**
 * A declaration list is only a declaration if each entry carries its reason.
 *
 * Exported and pure so the shape rules have a proof that does not need a
 * deployment on disk: a fixture enters here as the raw exported value, which is
 * the top of this analysis rather than something the loader already computed.
 */
export function parseReducedDeploymentDeclarations(
  value: unknown,
  path: string,
): ReducedDeploymentDeclaration[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `${path} must export \`reducedDeployment\` as an array of ` +
        '{ moduleId, reason } entries; a deployment that ships the full set exports [].',
    );
  }
  return value.map((entry, index) => {
    const parsed = ReducedDeploymentDeclarationSchema.safeParse(entry);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(entry)'}: ${issue.message}`)
        .join('; ');
      throw new Error(
        `${path}[${index}] is not a declaration — ${detail}. An entry says which module this ` +
          'deployment does not ship and what it does instead; the sentence is the review.',
      );
    }
    return parsed.data;
  });
}

/**
 * The active deployment's declared omissions, or none.
 *
 * Impure by necessity — it reads the disk and the environment — which is exactly
 * why it is not part of `assertLockedModulesPresent`. That function stays pure so
 * its proof does not need a boot; this one answers "what did this deployment
 * declare?" and hands it over as data.
 */
export async function loadReducedDeploymentDeclarations(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReducedDeploymentDeclaration[]> {
  const deployment = selectedDeployment(env);
  if (deployment === null) return [];
  const path = ledgerPathFor(deployment);
  if (!existsSync(path)) return [];
  const loaded = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const declared = loaded['reducedDeployment'] ?? loaded['default'];
  if (declared === undefined) return [];
  return parseReducedDeploymentDeclarations(declared, `backend/src/apps/${deployment}/reduced-deployment.ts`);
}
