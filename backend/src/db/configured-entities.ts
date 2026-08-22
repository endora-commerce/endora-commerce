import { ALL_ENTITIES } from './entities-registry.generated.js';
import { discoverPackageSchema, type EntityClassLike } from '../packages/package-runtime.js';

/**
 * The entity classes this platform registers: the committed core registry plus
 * every installed extension package's own (feature 080, T033 — D-106.2).
 *
 * The sibling of `configured-migrations.ts`, and async for the same reason: the
 * committed registry is emitted by a source-text walk for `@Entity(` under
 * `backend/src` (`generate-composer.ts`), and compilation turns that decorator
 * into a `__decorate([...])` call — so a published package contributes nothing
 * to it and could not, whatever the generator did. Which packages an instance
 * installed is a fact about the process (D-119/D-155), so the second half is
 * read at runtime, through the package's own `./backend` export.
 *
 * A **factory, not a promise-valued export**, for the reason spelled out in
 * `configured-migrations.ts`: a promise created at import scans `node_modules`
 * in every process that touches the module, including one that only wanted a
 * type, and turns a discovery failure into an unhandled rejection.
 *
 * It lives beside the migration seam rather than inside it because the two
 * answer different questions to different readers — the ORM configuration is
 * the only reader of the entity set, while the order has three — but both are
 * one merge over the one discovery in `src/packages/`.
 */
export type ConfiguredEntity = (typeof ALL_ENTITIES)[number] | EntityClassLike;

let memoised: Promise<readonly ConfiguredEntity[]> | undefined;

export async function configuredEntities(
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly ConfiguredEntity[]> {
  memoised ??= (async () => {
    const packages = await discoverPackageSchema(env);
    return [...ALL_ENTITIES, ...packages.flatMap((contribution) => contribution.entities)];
  })();
  return memoised;
}
