/**
 * `PlatformComposition` — what a caller hands the kit (feature 109, contract
 * R2.1).
 *
 * ## The inversion, and why it is the whole feature
 *
 * `backend/test/helpers/test-server.ts` composes a platform by *finding* one:
 * it imports the generated module list, the application's ORM configuration,
 * the resolved manifest registry, the overlay loader and the package loader —
 * seven bindings, every one of them a fact about **this repository's tree**
 * (§2.1). A package cannot have any of them, so a harness that reaches for them
 * cannot be a package, and a module's server-bound test therefore had nowhere
 * to run but `backend/test`.
 *
 * So the kit is *handed* its composition and never builds one. That is the same
 * inversion the platform already applies to every other host value: a
 * composition root registers `redis`, `eventBus` and the `*RunWorkers` flags
 * above the compose call because no module defaults them (AGENTS.md
 * § Composition item 8), and the composition itself is one more of those.
 *
 * ## What the kit deliberately will not do (R2.2)
 *
 * It does not read `process.env.DEPLOYMENT`, walk `node_modules` or read a
 * generated artefact. Every one of those is a fact about the caller's process —
 * D-104's predicate — and a kit that answered them would answer them
 * differently from the platform that composes for real. Discovery lives with
 * the host, which is where `loadOverlayModuleEntries` and
 * `loadPackageModuleEntries` already are; a second copy in the kit would be a
 * second answer waiting to disagree.
 */

import type { MikroORM } from '@mikro-orm/postgresql';
import type { ModuleManifest } from '@endora-commerce/contracts';
import type { composeModules } from '@endora-commerce/platform/composition';

import type { TestSupportContribution } from '../support/index.js';

/**
 * One composed module, named through `composeModules`' own signature.
 *
 * `ModuleEntry` is not one of the 27 symbols `./composition` carries and this
 * feature widens no barrel (R3.1), so the type is taken from the function that
 * *is* published rather than by publishing a second symbol to spell it. It
 * stays correct by construction: a field added to the entry is a field here in
 * the same compile.
 */
type ModuleEntry = Parameters<typeof composeModules>[0][number];

/**
 * How this composition opens and closes its ORM.
 *
 * A pair rather than an instance, for the reason the harness's own
 * `initOrm`/`closeOrm` are a pair: the ORM configuration captures
 * `DATABASE_URL` at import, so *when* it is opened is part of what the caller
 * decides. The application supplies its own; a module package's test supplies
 * one built over the entity classes its installed set declares.
 */
export interface TestOrmLifecycle {
  open(): Promise<MikroORM>;
  close(): Promise<void>;
}

/**
 * One entry of the loaded manifest registry, as the kit reads it.
 *
 * **Structural on purpose.** The application's own entry type carries a file
 * path, an origin, install hooks and the operator commands a module declares —
 * none of which the composition seam needs, and all of which are host-owned
 * (`backend/src/lifecycle/registered-manifests.ts`, which a package may not
 * name). Declaring the one member the kit reads keeps the application's array
 * assignable without the kit knowing what else is on it.
 */
export interface ComposedManifestEntry {
  readonly manifest: ModuleManifest;
}

/**
 * The four things only the caller knows.
 *
 * Each member is one of §2.1's rows, and the table there is the normative
 * statement of what belongs here: a fifth member would have to be something a
 * *stranger's* test could not answer, and there is nothing left in that class.
 */
export interface PlatformComposition {
  /**
   * The module entries to compose — this repository's `MODULES` plus its
   * overlay and its discovered packages, or a third party's own set.
   *
   * A composition lacking a module that declares `activation.nonDeactivatable`
   * is refused by `composeModules` before the first module registers (issue
   * #258), and the kit adds no second check and swallows no refusal (R2.4): a
   * stranger composing an incomplete set gets the platform's own sentence,
   * naming the module, the reason its manifest gives and the remedy.
   */
  readonly modules: readonly ModuleEntry[];
  /** An opener and a closer, per {@link TestOrmLifecycle}. */
  readonly orm: TestOrmLifecycle;
  /**
   * The loaded manifest registry the lifecycle needs.
   *
   * It is what the required-module set, the activation declarations and the
   * seeded enabled set are all derived from — three derivations from one input,
   * on every composition, so a caller that withdraws a module changes all three
   * in the same run and there is no list anywhere (D-100).
   */
  readonly manifests: readonly ComposedManifestEntry[];
  /**
   * The test-support contributions of **exactly the modules in `modules`**,
   * collected by the caller (contract §4).
   *
   * The kit does not discover them for the same reason it does not discover
   * modules. In Phase 1b only `registrations` is applied; `volatileTables` and
   * `seed` are declared and not yet collected — see `../support/index.ts`.
   */
  readonly testSupport?: readonly TestSupportContribution[];
}
