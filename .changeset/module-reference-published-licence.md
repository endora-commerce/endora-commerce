---
'@endora-commerce/cli': minor
---

The generated module reference page's licence row now states what the module's package is
published under — its `package.json` `license` — instead of the manifest's `license` field, an
edition-tier enum no module sets, which rendered `—` on every page. The row is renamed from
`Licence tier` to `Licence`; an SPDX licence renders as declared (`` `MIT` ``), and a
`SEE LICENSE IN <file>` licence renders as declared with a note that the terms ship in that file.
A module no package ships (`core`) still renders `—`.

New export: `publishedLicenseOf(manifestPath, shipsFrom)` from
`@endora-commerce/cli/lib/docs-artefacts.js` reads the licence from the nearest `package.json`
above a manifest, and answers `null` unless that file's `name` is the shipping package.
`referenceOf(moduleId, loaded, shipsFrom, prosePage, publishedLicense?)` takes the licence as a
new optional fifth argument; without it the row renders `—`.

An instance running `endora generate` sees every reference page's licence row change once.
