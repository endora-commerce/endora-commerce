import { ALL_ENTITIES } from './entities-registry.generated.js';
import { discoverPackageSchema, type EntityClassLike } from '../packages/package-runtime.js';
import { assertTransitiveParentsResolve } from '../tenancy/org-scoped.decorator.js';

/**
 * The entity classes this platform registers: the committed core registry plus
 * every installed extension package's own (feature 080, T033 — D-106.2).
 *
 * The sibling of `configured-migrations.ts`, and async for the same reason: the
 * committed registry is emitted by a source-text walk under `backend/src` for
 * the MikroORM entity decorator (`generate-composer.ts`), and compilation turns
 * that decorator into a `__decorate([...])` call — so a published package
 * contributes nothing to it and could not, whatever the generator did. Which
 * packages an instance installed is a fact about the process (D-119/D-155), so
 * the second half is read at runtime, through the package's own `./backend`
 * export.
 *
 * (The decorator's spelling is deliberately not written out above: this file is
 * inside the tree that walk reads, and the walk is a text match.)
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
 *
 * ## It is also where the tenancy chains are reconciled (feature 080, T049)
 *
 * Since D-169 a `@TransitivelyScoped` entity names its parent by class name
 * rather than by importing the class, so a name that resolves to nothing is
 * possible in a way it was not before — and a transitively scoped entity has no
 * tenant column of its own, so that would leave it reachable with no tenant
 * predicate at all (Principle XI, non-negotiable).
 *
 * This is the first moment the question can honestly be asked. The decorator
 * cannot ask it: entity classes register in import order and a child is
 * routinely imported before its parent. The line below is the instant after
 * every classification decorator has run — the committed registry above plus
 * every installed package's entities — and still before the ORM exists, so no
 * query can have been issued under a chain that does not resolve. It throws
 * `UnresolvableTenantParentError`, which stops the boot; there is deliberately
 * no degraded mode, because the degraded mode is an untenanted read.
 */
export type ConfiguredEntity = (typeof ALL_ENTITIES)[number] | EntityClassLike;

let memoised: Promise<readonly ConfiguredEntity[]> | undefined;

export async function configuredEntities(
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly ConfiguredEntity[]> {
  memoised ??= (async () => {
    const packages = await discoverPackageSchema(env);
    const entities = [
      ...ALL_ENTITIES,
      ...packages.flatMap((contribution) => contribution.entities),
    ];
    assertTransitiveParentsResolve();
    return entities;
  })();
  return memoised;
}
