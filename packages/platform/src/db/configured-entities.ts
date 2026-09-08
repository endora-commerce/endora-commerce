import { discoverPackageSchema, type EntityClassLike } from '../packages/package-runtime.js';
import { assertTransitiveParentsResolve } from '../tenancy/org-scoped.decorator.js';
import { platformLogger } from '../kernel/logging.js';

/**
 * The entity classes this platform registers: the committed core registry the
 * host supplies, plus every installed extension package's own (feature 080,
 * T033 — D-106.2).
 *
 * The sibling of `configured-migrations.ts`, and async for the same reason: the
 * committed registry is emitted by a source-text walk for the MikroORM entity
 * decorator (`generate-composer.ts`), and compilation turns that decorator into
 * a `__decorate([...])` call — so a published package contributes nothing to it
 * and could not, whatever the generator did. Which packages an instance
 * installed is a fact about the process (D-119/D-155), so the second half is
 * read at runtime, through the package's own `./backend` export.
 *
 * ## The core half is **received**, not imported (`specs/110-instance-repository/` R7.4)
 *
 * `entities-registry.generated.ts` is a fact about *one repository's tree*, is
 * host-owned (D-160.3), and the platform may not name a file in the tree that
 * installs it (D-52/D-53). So it arrives as a parameter and this file knows
 * nothing about where it came from. `backend/src/db/configured-entities.ts` is
 * the binding that supplies it, and an instance writes the same three lines
 * against its own index — the shape `registered-manifests.ts` took in
 * `specs/115-lifecycle-container-move/` Phase 3.
 *
 * Memoisation stays with the binding for the same reason: how many times one
 * process may ask is a fact about that process.
 *
 * It lives beside the migration seam rather than inside it because the two
 * answer different questions to different readers — the ORM configuration is
 * the only reader of the entity set, while the order has three — but both are
 * one merge over the one discovery in `../packages/`.
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
 *
 * Since T054(a) (D-170) it walks the whole chain rather than one hop, and
 * refuses one that resolves at every step and grounds nowhere — a `global` or
 * `rule` terminus, a cycle, a run of transitives reaching no keyed
 * classification. It also emits an `info` line for a chain that terminates at a
 * `customer`, which is legal and has a gap worth naming; the logger is passed
 * from here because that is where the platform's destination is nameable, and
 * `tenancy/` deliberately imports nothing from `kernel/`.
 */
export type ConfiguredEntity = EntityClassLike;

/** What {@link configuredEntitiesFrom} needs from the host. */
export interface EntityConfigurationInputs {
  /**
   * The committed core registry — `ALL_ENTITIES` in this repository's tree.
   *
   * Declared as the structural shape rather than imported, for
   * `DiscoveredManifestEntry`'s reason: `tsc` holds the two together at the
   * binding's call site, so an entity dropped from the generated array fails in
   * the host's own type-check.
   */
  readonly coreEntities: readonly EntityClassLike[];
  /** Selects the `node_modules` roots the package scan reads. */
  readonly env?: NodeJS.ProcessEnv;
}

export async function configuredEntitiesFrom(
  inputs: EntityConfigurationInputs,
): Promise<readonly ConfiguredEntity[]> {
  const packages = await discoverPackageSchema(inputs.env ?? process.env);
  const entities = [
    ...inputs.coreEntities,
    ...packages.flatMap((contribution) => contribution.entities),
  ];
  assertTransitiveParentsResolve(platformLogger());
  return entities;
}
