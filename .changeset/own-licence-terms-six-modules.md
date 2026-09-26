---
'@endora-commerce/mod-comarch-xl': minor
'@endora-commerce/mod-infakt': minor
'@endora-commerce/mod-ksef': minor
'@endora-commerce/mod-pim-ergonode': minor
'@endora-commerce/mod-pim-pimcore': minor
---

These packages now declare `"license": "SEE LICENSE IN LICENSE.md"` and ship `LICENSE.md` in place of the MIT `LICENSE`

From this version on, each package's terms are the ones in the `LICENSE.md` beside its
`package.json`, which grants no licence; the MIT `LICENSE` file is no longer in the tarball, and
the package README points at `LICENSE.md`. The `.` subpath additionally exports
`packageLicense`, the string constant the manifest generator reads the field from; every other
export on every subpath is unchanged, so a deployment using any of these modules sees no change in
behaviour.

`minor` rather than `patch`: `packageLicense` is additive published surface on `.`, on the
`mod-ksef` `./test-support` precedent. In a `0.x` series a minor takes every caret dependent out
of range, which is what a consumer should notice about the licence field changing.
