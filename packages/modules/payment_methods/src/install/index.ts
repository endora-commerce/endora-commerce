/**
 * The **install surface** this module publishes: one factory, on a subpath whose
 * declared meaning is foreign consumption (feature 134, FR-064;
 * `module-package-layout.md` R11, D-251).
 *
 * A module that ships its own payment gateway seeds its `payment_methods` rows
 * from its `installHook` through `createPaymentMethodSeeder()`, handing `ctx.em`
 * to every call; the interface it returns is published type-only on this
 * package's `./ports`. `autopay`, `paypal`, `payu`, `stripe`, `tpay` and the
 * example deployment's `payment_gateway_fixture` are its six consumers today,
 * and the fixture is the one that stays once wave 2 extracts the five.
 *
 * ## Why this is a subpath of its own rather than a line on `./backend`
 *
 * The delivery twin — `packages/modules/delivery_methods/src/install/index.ts` —
 * carries the argument in full, with the emitted-graph measurement that decided
 * it. **Wave 2 reuses that decision rather than retaking it**
 * (`contracts/foreign-write-repair.md` §2, §8 item 2h). In three lines:
 *
 *  * **The npm edge coincides with a declared lifecycle dependency rather than
 *    substituting for one.** All five gateways already declare
 *    `dependencies: ['…', 'payment_methods', '…']` in their manifests, so the
 *    lifecycle, the migration order and the operator's switch all know about
 *    this edge; the npm declaration says the same thing a second way, in the
 *    only vocabulary a published tarball has. That is what puts this seam
 *    **inside** R4's reason rather than beside it.
 *  * **`./backend` is deliberately discriminating and must stay so.**
 *    `module-package-layout.md` R7: after D-168, *"every reach into
 *    `<pkg>/backend` really is a wiring reach"*. A factory there would make one
 *    subpath mean either "this consumer is wiring `payment_methods`", a real
 *    Principle I violation, or "this consumer seeds its own rows through the
 *    sanctioned surface" — two findings with opposite remedies behind one name,
 *    multiplied by five gateways and a fixture.
 *  * **The import is evaluated at every boot, and it is measured.**
 *    `manifest-index.generated.ts` imports every module's manifest statically and
 *    eagerly, in the server, the CLI and every worker — so a consumer's
 *    `installHook` is *called* at install and its `import` is *loaded* at boot.
 *    On the emitted artefact, walked the same way wave 1 walked the delivery
 *    twin: `dist/backend/index.js` pulls **9 emitted files and 7 external
 *    specifiers**, `@endora-commerce/platform/http` among them, where
 *    `dist/install/index.js` pulls **3 and 4, with no HTTP layer** — this file,
 *    the reconciler and the entity. `dist/ports/index.js` pulls **1 and 0**,
 *    being `export {};`. The delivery twin's install subpath measures 3 and 4 as
 *    well, which is what says the two seams cost the same.
 *
 * ## It is a pure re-export, and that is a rule
 *
 * No behaviour is added here and none may be. The install hook is **not** inside
 * a database transaction — measured in wave 1: a hook that threw half-way left
 * the first of two seeded rows behind and never wrote the second — so every
 * behaviour placed on this path is a new partial-write surface. The write stays
 * in `../backend/services/payment-method-reconciler.ts`, where its tests, its
 * `command-coverage-ignore` classification and its Constitution XIII reasoning
 * already live.
 */
export { createPaymentMethodSeeder } from '../backend/services/payment-method-reconciler.js';
