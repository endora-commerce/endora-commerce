---
'@endora-commerce/mod-comarch-xl': patch
'@endora-commerce/mod-infakt': patch
'@endora-commerce/mod-ksef': patch
'@endora-commerce/mod-pim-akeneo': patch
'@endora-commerce/mod-pim-ergonode': patch
'@endora-commerce/mod-pim-pimcore': patch
'@endora-commerce/mod-pim-unopim': patch
---

These packages now declare `"license": "SEE LICENSE IN LICENSE.md"` and ship `LICENSE.md` in place of the MIT `LICENSE`

From this version on, each package's terms are the ones in the `LICENSE.md` beside its
`package.json`, which grants no licence; the MIT `LICENSE` file is no longer in the tarball, and
the package README points at `LICENSE.md`. The `.` subpath additionally exports
`packageLicense`, the string constant the manifest generator reads the field from; every other
export on every subpath is unchanged, so a deployment using any of these modules sees no change in
behaviour.
