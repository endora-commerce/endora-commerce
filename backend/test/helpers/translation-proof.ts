/**
 * The harness's translation proof, kept out of `test-server.ts` on purpose.
 *
 * This is a constant, not a connection — but `test/unit/harness/service-dependent-ledger.test.ts`
 * classifies any unit test that imports `helpers/test-server.js` as needing a live PostgreSQL,
 * and it is right to: that file boots a server. So a static test that only wanted the constant
 * was read as service-dependent, and the fast run
 * (`pnpm --filter backend run test:unit:fast`) went red on `master`.
 *
 * The two repairs available were to ledger the test — which would have EXCLUDED a purely static
 * assertion from the fast run, the opposite of what it is for — or to stop the import reaching
 * the harness. This file is the second. The detector's rule is unchanged and stays correct.
 */

/**
 * The error code this harness proves the translation path with, and why it is a
 * constant rather than "any key that happens to be there".
 *
 * `VERSION_CONFLICT` is declared by `_i18n`, which ships a sentence for it in
 * both languages, so resolving it walks the whole path the envelope walks on a
 * real refusal: the merged bundle for the language, the `_i18n` -> `core`
 * namespace rename, and the `errors.<CODE>` key inside it.
 *
 * **The module id is `_i18n` and not `core`, and that is load-bearing since
 * D-185.** `core` is the namespace the merged bundle is keyed by, so asking for
 * it walks past the rename rather than through it. Asking for the **module id**
 * is what the envelope does — the routing map is keyed on declaring modules —
 * and it is the one call in the harness that would go silent if the single
 * surviving `_i18n` -> `core` normalisation in `i18n-service.ts` were ever lost.
 * `translate` answers a miss with `<moduleId>.<key>`, and both composition roots
 * turn that placeholder back into the raiser's untranslated English, so without
 * this the loss shows up as 41 codes quietly rendering in the wrong language and
 * nothing failing anywhere.
 *
 * Three further properties are what make it a defensible pick, and the third is
 * the one the constant it replaces failed. It is declared **explicitly**, by one
 * module, in that module's manifest — there is no fall-through left for a code
 * to arrive at the platform bundle by (feature 090 §4.1), so nothing can capture
 * it; it is a platform mechanism eighteen modules throw, so no module can claim
 * ownership of the noun; and its sentence exists in **no other bundle**, so
 * nothing can strand it. `CART_EMPTY` had none of the three: issue #231 routed
 * the `CART_*` family to `carts` — where the better sentence had been written
 * all along — and this proof would have started failing on a correct tree,
 * reporting a broken harness where there was none.
 *
 * **A comment is not the guarantee** (feature 082, D-126). The four properties
 * above are exactly what the previous constant's comment asserted about
 * `CART_EMPTY`, in the same careful tone, and every one of them was wrong. So
 * the constant is exported and `test/unit/_i18n/translation-proof.test.ts`
 * checks all four against the real routing map and the real bundles on every
 * run. If this constant is ever changed, that file is where the change is
 * argued.
 */
export const TRANSLATION_PROOF = { moduleId: '_i18n', key: 'errors.VERSION_CONFLICT' } as const;
