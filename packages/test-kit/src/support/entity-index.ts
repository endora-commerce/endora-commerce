/**
 * The entity index — its **type** and its **lookup**, and no module's name
 * (feature 109, T065; contract R2.2, FR-001).
 *
 * ## The one fact this file is built around not knowing
 *
 * A server-bound test writes rows, and to write a row it needs the entity
 * **class the ORM registered** — not a structurally identical copy read out of a
 * package's source, which is a class the ORM never discovered (D-160.6.1). A
 * module package publishes one `entities` array and **no entity class by name**
 * (D-168), so the class is picked out of that array by name, and the array comes
 * off the package's own `./backend`.
 *
 * Which packages are there is where this stops being a package's business.
 * *Which modules one deployment installed* is the single fact a kit that may
 * name no module is forbidden to know (R2.2, FR-001), and it is why
 * `backend/test/helpers/package-entities.ts` is permanently host-owned and may
 * not move here — `specs/084-small-f4-package-layout/contracts/module-package-layout.md`
 * R10's closing paragraph, which asks in as many words that this not be
 * re-opened on import volume.
 *
 * So the population arrives as an **argument**, exactly as
 * `PlatformComposition.modules` does, and it is rendered by the host's own
 * generator — `@endora-commerce/cli/lib/entity-index-artefact.js`, run by
 * `endora generate` in an instance and by `composer:generate` in this
 * repository. One derivation, two populations
 * (`contracts/instance-repository.md` R3.5).
 *
 * ## Why the lookup delegates rather than re-implements
 *
 * `entityNamed` is `@endora-commerce/platform/packages`', and two
 * implementations of one lookup are two answers waiting to disagree about what a
 * missing name does. What this file adds is the **module** dimension the
 * platform's lookup has no opinion about: the index is keyed by module id, so a
 * name that is absent has two different causes — the module is not installed, or
 * the module publishes no such class — and they have different remedies. A host
 * that gets `Cannot read properties of undefined` for the first has been told
 * nothing.
 */
import type { EntityClass } from '@mikro-orm/core';

import { entityNamed, type EntityRowTypeIsRequired } from '@endora-commerce/platform/packages';

/**
 * What a published `entities` array holds.
 *
 * A construct signature rather than `unknown`, for the platform lookup's own
 * reason: it refuses an argument that is not an array of classes at all, which
 * is the shape a package that lost its array answers with — the host reads a
 * missing `entities` export as `[]` and reports nothing.
 */
type PublishedEntityClass = abstract new (...args: never[]) => object;

/**
 * The index's type, and the whole of what the kit may say about its content.
 *
 * Keyed by **module id** — `endora.id`, the identity of record (D-142) — and
 * never by package name: a test names the module it is testing, and the package
 * name is a fact about how that module was delivered.
 *
 * The kit declares this shape and never a member of it. A union of the module
 * ids that happen to exist today would be the list R2.2 forbids, and it would
 * make a stranger's own module unnameable in the index their own host rendered.
 */
export type InstalledEntityIndex = Readonly<Record<string, readonly PublishedEntityClass[]>>;

/**
 * One entity class out of an installed module's published array, with the row
 * type the caller supplies.
 *
 * The row type is **required** and its default is unsatisfiable, which is the
 * platform lookup's decision and is inherited here rather than restated: with
 * `T` free, `em.create` checks the payload against `object` and accepts
 * everything, which is worse than the constructor-union collapse the mechanism
 * exists for. A caller takes it from an `import type` of the module's own
 * `./test-support`, which publishes the row types `export type`-only for exactly
 * this (R10 property 3).
 */
export function entityNamedIn<T extends object = EntityRowTypeIsRequired>(
  index: InstalledEntityIndex,
  moduleId: string,
  name: string,
): EntityClass<T> {
  // `Object.hasOwn`, not a truthiness test: the index is a plain object a
  // generator rendered, so `index['toString']` answers with a function off
  // `Object.prototype` — a truthy value where an array belongs, and on
  // `constructor` a value that would reach the lookup and fail somewhere else.
  if (!Object.hasOwn(index, moduleId)) {
    throw new ModuleNotInstalledError(moduleId, installedModuleIds(index));
  }
  const published = index[moduleId];
  if (!Array.isArray(published)) {
    throw new ModuleNotInstalledError(moduleId, installedModuleIds(index));
  }
  return entityNamed<T>(
    published as readonly PublishedEntityClass[],
    name,
    `the installed module '${moduleId}'`,
  );
}

/** Every module id the index carries, sorted, so a refusal reads the same way twice. */
function installedModuleIds(index: InstalledEntityIndex): readonly string[] {
  return Object.keys(index)
    .filter((key) => Object.hasOwn(index, key))
    .sort();
}

/**
 * A module id the index does not carry.
 *
 * Its own class rather than a bare `Error` because the two causes of "no such
 * entity" have different remedies and a caller may legitimately branch on which
 * it got: this one means *this host composed a different set of modules*, and
 * the platform lookup's means *that module publishes no such class*.
 */
export class ModuleNotInstalledError extends Error {
  override readonly name = 'ModuleNotInstalledError';

  constructor(
    readonly moduleId: string,
    readonly installed: readonly string[],
  ) {
    super(
      `the entity index carries no module '${moduleId}', so no entity class of it can be ` +
        `named. This host installed: ${installed.length === 0 ? '(no module at all)' : installed.join(', ')}. ` +
        `The index is rendered from the packages this host installed, so either install ` +
        `'${moduleId}' and re-run the generator, or name a module that is in the list — a ` +
        `stale index is a test asking the ORM about a table nothing mapped.`,
    );
  }
}
