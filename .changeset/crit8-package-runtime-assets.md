---
'@endora-commerce/mod-product-feeds': minor
---

The Product Feeds module is now a package. `@endora-commerce/mod-product-feeds`
publishes `.` (the manifest), `./backend` (`registerModule`, `entities`, and the
`ProductFeedsBridge` / `ProductFeedsCradle` interfaces) and `./migrations` (the
seven migration classes plus the ordered `migrations` array).

It is also the first package to ship a **non-TypeScript runtime asset**: the four
bundled Google Merchant and Meta taxonomy files. `tsc` compiles `.ts` and copies
nothing else, so the package's `build` script is `tsc` followed by
`scripts/copy-package-assets.mjs`, which mirrors every ruled-in asset under the
package's `rootDir` into its `outDir` and refuses a build whose emitted tree does
not hold them. Nothing in the module's own sources changed for it:
`TaxonomyReconcilerService` still finds its data relative to `import.meta.url`,
which now resolves inside `dist`.

Consumers taking an entity class must take it from the `entities` array on
`./backend`, by name — the platform composes the published artefact, so a
filesystem path into this package's source is a second copy of the class.
