/**
 * The entity set's **binding** — one supplier, and nothing else
 * (`specs/110-instance-repository/` T116; `contracts/instance-repository.md`
 * R7.4, FR-014).
 *
 * The merge is `@endora-commerce/platform/db`'s since T116: the committed core
 * registry, plus every installed extension package's entity classes, plus the
 * tenancy-chain reconciliation that has to happen after the last classification
 * decorator has run and before the ORM exists.
 *
 * What is left here is the input. `entities-registry.generated.ts` is a fact
 * about *this repository's tree* — a source-text walk for the MikroORM entity
 * decorator, emitted by `scripts/generate-composer.ts`, bare core under every
 * value of `DEPLOYMENT` — so the platform may not import it and receives it
 * instead. An instance writes the same three lines against its own artefact.
 *
 * **The memoisation is the binding's too**, and deliberately: how many times one
 * process may scan `node_modules` is a fact about that process, not about the
 * merge. The result is memoised because there are fourteen direct importers of
 * the ORM config and fourteen call sites must not mean fourteen scans; `env` is
 * read on the first call per deployment only, because it selects the
 * `node_modules` roots and an instance does not move underneath a running
 * platform.
 *
 * A **factory, not a promise-valued export**: a promise created at import scans
 * `node_modules` in every process that touches the module, including one that
 * only wanted a type, and turns a discovery failure into an unhandled rejection.
 */
import { configuredEntitiesFrom, type ConfiguredEntity } from '@endora-commerce/platform/db';

import { deploymentRoot, selectedDeployment } from '../overlay/overlay-roots.js';
import { ALL_ENTITIES } from './entities-registry.generated.js';

/** Re-exported so a caller that already reads this seam has one import. */
export type { ConfiguredEntity } from '@endora-commerce/platform/db';

/**
 * One answer per deployment the process asks about, `''` for bare core
 * (`specs/190-overlay-full-modules/` FR-035, FR-040): the active deployment's
 * overlay entities are read from {@link deploymentRoot}, so a test that selects
 * a deployment in-process gets that deployment's set, and a bare-core caller in
 * the same process keeps its own.
 */
const memoised = new Map<string, Promise<readonly ConfiguredEntity[]>>();

export async function configuredEntities(
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly ConfiguredEntity[]> {
  const key = selectedDeployment(env) ?? '';
  let entities = memoised.get(key);
  if (entities === undefined) {
    entities = configuredEntitiesFrom({ coreEntities: ALL_ENTITIES, env, deploymentRoot: deploymentRoot() });
    memoised.set(key, entities);
  }
  return entities;
}
