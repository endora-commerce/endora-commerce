/**
 * Cross-module imports still standing in `product_feeds` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 */
export const entries: Readonly<Record<string, string>> = {
  // The `product_feeds` cut retired sixteen of the seventeen. This is the one
  // Phase P named in advance and declined to guess at, in
  // `packages/contracts/src/catalog.ts:1579-1585`: *"`product_feeds` compiles
  // its own selection DSL into a MikroORM `where` object and hands it to
  // `em.find(Product, where as never)`. A port cannot take that argument — a
  // query object is the ORM, not a contract — and inverting it means either
  // publishing the DSL or teaching `catalog` about feeds. That is a design
  // question rather than a naming one, so it is escalated and left for the
  // `product_feeds` cut to resolve, not guessed at here."*
  //
  // This cut escalates it back, with the three options measured against the
  // file rather than imagined:
  //
  //  1. **Publish the filter.** `selection-rule-compiler.ts` (436 lines) emits a
  //     MikroORM filter object over `id`, `type`, `status`, `createdAt`,
  //     `updatedAt` and `attributeValues.<key>`, with `$and` / `$or` / `$in` /
  //     `$gt` / `$ne` / `$like` and a JSONB path. Publishing a
  //     `CatalogProductFilter` in `@b2b/contracts` and translating it inside
  //     `catalog` is a real port, but it is a **query language** in the package
  //     the browser bundles, and it is a Phase-P-sized piece of work rather
  //     than a transcription.
  //  2. **Evaluate everything in memory.** The exact stage already exists —
  //     `CompiledSelection.evaluate` decides a `SelectionCandidate`, which is
  //     `{ id, type, status, attributeValues, createdAt, updatedAt }` and so a
  //     subset of `CatalogProductRecord`. But it is emitted only for the stock
  //     and price leaves; making it total means rewriting the compiler to give
  //     every leaf a JS evaluator, and JSONB comparison semantics in SQL and in
  //     JavaScript are not the same function. That is a behaviour change wearing
  //     a refactor, which plan.md trap 6's neighbour forbids.
  //  3. **Teach `catalog` about feeds.** Refused outright: it inverts the
  //     dependency and puts a consumer's vocabulary in the provider.
  //
  //  Recommendation: option 1, as a Phase-P addition on `catalog`, with the
  //  filter type deliberately **narrower** than MikroORM's — the six fields and
  //  six operators above and nothing else, so it can never become a general
  //  query surface. The keyset cursor and the eligibility floor go into the
  //  same port rather than being composed by the caller, because the floor is
  //  what FR-026 makes non-overridable and a caller-composed `$and` is exactly
  //  how it could stop being.
  //
  // Retired by: that ruling, and the Phase-P merge request it authorises.
  'modules/product_feeds/services/product-selection.service.ts:catalog/entities/product.entity':
    'F3 Phase C — product_feeds, escalated. The selection rule compiles to a MikroORM filter ' +
    'object, which no port may take; cutting it needs a published, narrowed product-filter ' +
    'port on `catalog`. Retired by the ruling described above.',
};
