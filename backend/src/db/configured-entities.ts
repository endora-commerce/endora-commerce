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
 * read on the first call only, because it selects the `node_modules` roots and
 * an instance does not move underneath a running platform.
 *
 * A **factory, not a promise-valued export**: a promise created at import scans
 * `node_modules` in every process that touches the module, including one that
 * only wanted a type, and turns a discovery failure into an unhandled rejection.
 */
import { configuredEntitiesFrom, type ConfiguredEntity } from '@endora-commerce/platform/db';

import { ALL_ENTITIES } from './entities-registry.generated.js';

/** Re-exported so a caller that already reads this seam has one import. */
export type { ConfiguredEntity } from '@endora-commerce/platform/db';

let memoised: Promise<readonly ConfiguredEntity[]> | undefined;

export async function configuredEntities(
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly ConfiguredEntity[]> {
  memoised ??= configuredEntitiesFrom({ coreEntities: ALL_ENTITIES, env });
  return memoised;
}
