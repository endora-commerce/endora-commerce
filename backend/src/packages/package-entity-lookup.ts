import type { EntityClass } from '@mikro-orm/core';

/**
 * How a **host program** names one entity class out of a module package's
 * published `entities` array, with the entity's own type (feature 080, T040b —
 * criterion 7).
 *
 * ## The problem this exists for
 *
 * A module package publishes `export const entities = [...]` and **no entity
 * class by name**, type-only exports included (D-168;
 * `test/unit/packages/module-package-entity-surface.test.ts` is the arbiter, and
 * `d169PortsFindings` shuts the `./ports` door on the same shape). That is the
 * ruling's load-bearing half: `import { Megamenu } from
 * '@endora-commerce/mod-megamenu/backend'` has to fail in a stranger's compiler,
 * where none of this repository's checks run.
 *
 * A host program that has to **construct** one of those entities therefore picks
 * it out of the array, and a `find` over a heterogeneous array returns the
 * **union** of its constructors. Measured on `@endora-commerce/mod-returns`
 * (eleven entities): `em.create(entityNamed(returnsEntities, 'ReturnReason'), …)`
 * type-checks the payload against `RequiredEntityData<ReturnStatus>` — TypeScript
 * collapses the union to one constituent and it is not the one asked for. The
 * failure is silent whenever the two shapes happen to agree, which is the whole
 * reason this is a mechanism and not a call-site fix.
 *
 * The union is precise only for a package publishing **one** entity, which is
 * why `delivery_methods`, `payment_methods` and `taxes` went through the
 * inferred form and `megamenu` could not.
 *
 * ## The mechanism
 *
 * Two halves, and the split is the whole content of this file:
 *
 *  * the **runtime class** comes off the package's published `entities` array —
 *    the one array `entities-registry.generated.ts` hands the ORM, so there is
 *    exactly one of it in the process (D-160.6, D-160.6.1). Resolution is **by
 *    name and never by index**: a tuple index compiles for any ordering, so
 *    re-ordering the array in the package would silently re-point an insert at
 *    another table;
 *  * the **type** is supplied by the caller as `T`, from an `import type` of the
 *    entity's declaration inside the package's **built** artefact. It erases at
 *    compile time and constructs nothing, so no second copy exists and
 *    `check:singleton-identity` reads it for what it is (its `valueImportOrigins`
 *    skips a type-only import outright).
 *
 * ## Why the type import names `dist` and not `src`
 *
 * `backend/test/helpers/package-entities.ts` does the same split against the
 * package's **source**, which is legal there and is refused here:
 * `backend/tsconfig.build.json` sets `rootDir: ./src`, and a `.ts` outside it is
 * **TS6059 even for an `import type`** — measured, because a type-only import
 * still joins the program. A `.d.ts` does not: declaration files are exempt from
 * the `rootDir` check, so the emitted declaration inside the package's own
 * `dist` is the one spelling a file in this build may name. This file is in that
 * build: `deploy/README.md` documents running the dev seed as
 * `node dist/seeds/dev-catalog-seed.js`, and D-165 makes the compiled tree the
 * production path.
 *
 * That is not a workaround wearing a rule's clothes. The `.d.ts` inside `dist`
 * is the declaration of the class the platform actually registered, which is the
 * identity D-160.6 is about; the source spelling is the one that merely happens
 * to be structurally identical.
 *
 * D-168 is untouched by either: the guarantee is about the **bare specifier** an
 * installed consumer is limited to, and a package's `exports` map does not gate
 * a filesystem path — the ruling's own delivery note says so. A stranger has no
 * such path to write.
 *
 * ## What is checked, and where
 *
 * A name that is not in the array throws **here**, at module load, naming every
 * class the array does declare. That is the one failure mode D-160.6 calls
 * acceptable, precisely because it is loud.
 *
 * The remaining hazard is a call that asks for one entity's **type** while
 * naming another's — both are members of the same package, so no constraint
 * expressible on `T` can separate them (`EntityClass<T>` is
 * `Function & { prototype: T }`, and `Function.prototype` is `any`, so the type
 * argument is an assertion rather than a check). It is closed outside the type
 * system, by `test/unit/packages/package-entity-lookup.test.ts`: it walks every
 * host program that calls this, resolves each call's type argument back to its
 * `import type`, and refuses a specifier whose original name is not the string
 * literal beside it — and refuses one that is not the **emitted counterpart**,
 * derived from the package's own `tsconfig.build.json`, of a file in that
 * package declaring that class. So the `dist/…` path spelled at a call site is a
 * checked copy of a derived fact rather than a written-down one (D-100).
 */

/**
 * What a published `entities` array holds.
 *
 * Deliberately a construct signature and not `unknown`: it refuses an argument
 * that is not an array of classes at all — the shape a package that lost its
 * array answers with, since the host reads a missing `entities` export as `[]`
 * and reports nothing.
 */
type PublishedEntityClass = abstract new (...args: never[]) => object;

/**
 * The default `T`, whose whole job is to be unsatisfiable.
 *
 * Omitting the row type is the pre-repair shape and it has to be a compile
 * error, not a quieter version of the same defect: with `T` free, it resolves to
 * its own constraint and `em.create` then checks the payload against `object`,
 * which accepts everything. That is *worse* than the union collapse this file
 * exists for — the collapse at least errors when the two shapes disagree.
 * So the default is a shape no entity has and no payload satisfies: the first
 * `em.create` against it is TS2353 naming this interface, which is the
 * instruction. It is a required, plainly-typed property on purpose — a `never`
 * or a `unique symbol` key is filtered out of MikroORM's `RequiredEntityData`
 * mapped type and accepts everything, measured both ways.
 *
 * The default is the *loud* half. The half a type cannot reach — a call that
 * asks for one entity's row type while naming another's — belongs to
 * `test/unit/packages/package-entity-lookup.test.ts`.
 */
export interface EntityRowTypeIsRequired {
  readonly entityNamedNeedsTheRowTypeOfTheClassItIsAskedFor: 'see src/packages/package-entity-lookup.ts';
}

export function entityNamed<T extends object = EntityRowTypeIsRequired>(
  published: readonly PublishedEntityClass[],
  name: string,
  source = "a module package's published `entities` array",
): EntityClass<T> {
  // The `typeof` test is not redundant with the parameter type: the array comes
  // out of a package, which at runtime may be an installed one this repository
  // never compiled, so its members are whatever that package put there.
  const found = published.find(
    (candidate) => typeof candidate === 'function' && candidate.name === name,
  );
  if (found === undefined) {
    const declared = published
      .map((candidate) => (typeof candidate === 'function' ? candidate.name : String(candidate)))
      .join(', ');
    throw new Error(
      `[package-entities] ${source} publishes no entity class named '${name}' ` +
        `(it declares: ${declared || '(empty)'}). Either the class was renamed, or it was ` +
        `left out of the array — which the host answers by mapping it to no table, ` +
        `silently. See D-168.`,
    );
  }
  return found as unknown as EntityClass<T>;
}
