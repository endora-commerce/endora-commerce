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
 * `VERSION_CONFLICT` routes to `core` in `ERROR_TRANSLATION_KEYS` and `_i18n`
 * ships a sentence for it in both languages, so resolving it walks the whole
 * path the envelope walks on a real refusal: the merged bundle for the
 * language, the `_i18n` → `core` namespace rename, and the `errors.<CODE>` key
 * inside it.
 *
 * Three further properties are what make it a defensible pick, and the third is
 * the one the constant it replaces failed. It reaches `core` by **explicit
 * membership** of `GENERIC_ERROR_CODES`, so no future `startsWith` family rule
 * can capture it; it is a platform mechanism eighteen modules throw, so no
 * module can claim ownership of the noun; and its sentence exists in **no other
 * bundle**, so nothing can strand it. `CART_EMPTY` had none of the three: issue
 * #231 routed the `CART_*` family to `carts` — where the better sentence had
 * been written all along — and this proof would have started failing on a
 * correct tree, reporting a broken harness where there was none.
 *
 * **A comment is not the guarantee** (feature 082, D-126). The four properties
 * above are exactly what the previous constant's comment asserted about
 * `CART_EMPTY`, in the same careful tone, and every one of them was wrong. So
 * the constant is exported and `test/unit/_i18n/translation-proof.test.ts`
 * checks all four against the real routing table and the real bundles on every
 * run. If this constant is ever changed, that file is where the change is
 * argued.
 */
export const TRANSLATION_PROOF = { moduleId: 'core', key: 'errors.VERSION_CONFLICT' } as const;
