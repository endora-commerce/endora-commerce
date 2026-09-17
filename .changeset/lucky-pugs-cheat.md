---
'@endora-commerce/mod-pim-ergonode': minor
'@endora-commerce/mod-pim-pimcore': minor
'@endora-commerce/mod-pim-unopim': minor
'@endora-commerce/mod-comarch-xl': minor
'@endora-commerce/mod-pim-akeneo': minor
'@endora-commerce/mod-infakt': minor
'@endora-commerce/mod-wfirma': minor
'@endora-commerce/mod-ksef': minor
'@endora-commerce/test-kit': minor
'@endora-commerce/cli': patch
---

A module package may publish its own test support, on a new `./test-support` subpath

Eleven vendor test doubles — the scripted Ergonode, UnoPim, Comarch XL, Infakt and wFirma
clients, the three scripted media fetchers, the two webhook signers and the XL installation
fixture — moved out of `backend/test/helpers/` into the packages whose protocols they encode.
Each is now published at `<package>/test-support`, which is the first consumer-visible change:
a specifier that was a relative path into an application's test tree is a bare one.

The tables a module's tests need emptied travel the same way. `pim_pimcore`, `pim_ergonode` and
`ksef` declare their own `volatileTables`, and `@endora-commerce/test-kit/support` gains
`collectVolatileTables` to merge them — refusing two modules that claim one table, and any name
that is not an unquoted identifier, because the collected set is interpolated into a
`truncate … cascade`.

`@endora-commerce/cli`'s command-coverage rule prunes the new layer from its walk. A fixture
writer is not a service write, for the same reason a migration is not.
