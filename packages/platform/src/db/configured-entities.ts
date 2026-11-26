import { discoverOverlaySchema } from '../overlay/overlay-schema.js';
import { discoverPackageSchema, type EntityClassLike } from '../packages/package-runtime.js';
import { assertEntitiesClassified } from '../tenancy/entity-classification.js';
import { assertTransitiveParentsResolve } from '../tenancy/org-scoped.decorator.js';
import { platformLogger } from '../kernel/logging.js';
import { PLATFORM_ENTITIES, mergeByIdentity } from './platform-schema.js';

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
 *
 * ## And where an unclassified entity is refused (#1849)
 *
 * The same instant answers the plainer question first: does every persisted
 * entity in the list carry exactly one tenancy classification? The static
 * checks ask it of this repository's source text; this asks it of the classes
 * the ORM is about to be handed, whichever tree they came from, and throws
 * `UnclassifiedEntityError` naming each class and its contributor.
 *
 * ## And the deployment's overlay modules (#1850, D-297)
 *
 * Given `deploymentRoot`, the active deployment's overlay entities are the third
 * half, discovered at runtime for the reason a package's are — which deployment a
 * process runs as is a fact about the process, so the committed registry stays bare
 * core (D-104). They are held to the classification refusal like every other, with
 * `overlay apps/<deployment>/modules/<id>` as the contributor.
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
  /** Selects the `node_modules` roots the package scan reads, and the deployment (`DEPLOYMENT`). */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * The directory holding `apps/` — what the active deployment's overlay modules are
   * read from (`specs/190-overlay-full-modules/` FR-035). Absent, or `DEPLOYMENT`
   * unset, and the set is exactly what it was before an overlay could own a table.
   */
  readonly deploymentRoot?: string;
}

export async function configuredEntitiesFrom(
  inputs: EntityConfigurationInputs,
): Promise<readonly ConfiguredEntity[]> {
  const env = inputs.env ?? process.env;
  const packages = await discoverPackageSchema(env);
  // The deployment's own modules, read the way a package's are (#1850, contract
  // `overlay-schema-discovery.md` §2) — after the packages, so a list with no
  // overlay is the list it always was. Their `schemaExtensions` are judged by the
  // migration merge, which sees the composed graph V10 walks (FR-065); this set
  // is built without it, so it does not judge them a second time.
  const overlays = await discoverOverlaySchema(inputs.deploymentRoot, env, { schemaExtensions: false });
  // The platform's own six first (`specs/110-instance-repository/` T141).
  // They are this package's, and an instance supplies `coreEntities: []` —
  // which used to mean it registered none of them, so nothing mapped the
  // tables its own migrations create. Where a host names them, as this
  // repository's generated registry does by bare specifier, the merge is an
  // identity de-duplication over the same class objects.
  const core = mergeByIdentity(PLATFORM_ENTITIES, inputs.coreEntities);
  const entities = [
    ...core,
    ...packages.flatMap((contribution) => contribution.entities),
    ...overlays.flatMap((contribution) => contribution.entities),
  ];
  // Principle XI's backstop for what the static checks cannot read — a
  // compiled package, an instance (`specs/190-overlay-full-modules/` FR-020,
  // #1849). Before the chains, so a class with no classification is named as
  // that rather than as a chain that happens not to resolve through it.
  assertEntitiesClassified([
    ...core.map((cls) => ({ cls, contributor: 'core' })),
    ...packages.flatMap((contribution) =>
      contribution.entities.map((cls) => ({ cls, contributor: contribution.packageName })),
    ),
    ...overlays.flatMap((contribution) =>
      contribution.entities.map((cls) => ({ cls, contributor: contribution.source })),
    ),
  ]);
  assertTransitiveParentsResolve(platformLogger());
  return entities;
}
