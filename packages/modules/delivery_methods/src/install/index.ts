/**
 * The **install surface** this module publishes: one factory, on a subpath whose
 * declared meaning is foreign consumption (feature 134, FR-064;
 * `module-package-layout.md` R11).
 *
 * A module that ships its own carrier seeds its `delivery_methods` row from its
 * `installHook` through `createDeliveryMethodSeeder()`, handing `ctx.em` to every
 * call; the interface it returns is published type-only on this package's
 * `./ports`. `inpost`, `dhl_parcel` and the example deployment's
 * `carrier_fixture` are its three consumers today, and wave 2 gives
 * `payment_methods` the twin surface for five payment gateways.
 *
 * ## Why this is a subpath of its own rather than a line on `./backend`
 *
 * Three reasons, and the checker is not one of them.
 *
 * **The npm edge coincides with a declared lifecycle dependency rather than
 * substituting for one.** R4 in `backend/scripts/lib/module-package-manifest.ts`
 * refuses a module package importing another because a package edge is one *"the
 * lifecycle, the migration order and an operator switching the owner off all know
 * nothing about"* — D-11 rule 3's mirror false positive. Both carriers already
 * declare `dependencies: ['…', 'delivery_methods', '…']` in their manifests, so
 * the lifecycle, the migration order and the operator's switch all know about this
 * edge; the npm declaration says the same thing a second way, in the only
 * vocabulary a published tarball has. That is what puts this seam **inside** R4's
 * reason rather than beside it.
 *
 * **`./backend` is deliberately discriminating and must stay so.**
 * `module-package-layout.md` R7: after D-168, *"every reach into `<pkg>/backend`
 * really is a wiring reach"*. A factory there would make one subpath mean either
 * "this consumer is wiring `delivery_methods`", a real Principle I violation, or
 * "this consumer seeds its own row through the sanctioned surface" — two findings
 * with opposite remedies behind one name, for as many modules as adopt the seam.
 *
 * **The import is evaluated at every boot, and it is measured.**
 * `manifest-index.generated.ts` imports every module's manifest statically and
 * eagerly, in the server, the CLI and every worker — so a consumer's `installHook`
 * is *called* at install and its `import` is *loaded* at boot. Measured on the
 * emitted artefact, and both measurement points are given because the split moved
 * one of them: with the factory on the barrel, `dist/backend/index.js` pulled **12
 * emitted files and 7 external specifiers**, `@endora-commerce/platform/http`
 * among them; after the split it pulls **11 and 7**, because the reconciler left
 * it, and `dist/install/index.js` pulls **3 and 4 — this file, the reconciler, the
 * entity — with no HTTP layer**. So a consumer that had to name the barrel loaded
 * twelve modules and the HTTP layer where it now loads three and none of it,
 * per process, for as many modules as adopt the seam.
 *
 * ## It is a pure re-export, and that is a rule
 *
 * No behaviour is added here and none may be. The install hook is **not** inside a
 * database transaction — measured: a hook that threw half-way left the first of
 * two seeded rows behind and never wrote the second — so every behaviour placed on
 * this path is a new partial-write surface. The write stays in
 * `../backend/services/delivery-method-reconciler.ts`, where its tests, its
 * `command-coverage-ignore` classification and its Constitution XIII reasoning
 * already live.
 */
export { createDeliveryMethodSeeder } from '../backend/services/delivery-method-reconciler.js';
