---
'@endora-commerce/mod-pim-ergonode': minor
'@endora-commerce/mod-pim-unopim': minor
'@endora-commerce/mod-pim-pimcore': minor
'@endora-commerce/mod-comarch-xl': minor
---

Each of these modules publishes its own handle accessor, and `comarch_xl` its own volatile tables

`pimErgonodeHandle`, `pimUnopimHandle` and `pimPimcoreHandle` — the same inversion `ksefHandle`
is. They existed as fields on the application harness's returned handle, typed off each package's
published `./backend` subpath. That was never the compile-time hard stop, because a published
subpath is not a directory; it was the **undeclared dependency** that replaces it, and a free
instance that does not install the module resolves nothing at that specifier.

`comarch_xl` also declares the twelve `xl_*` tables its tests need emptied. They arrived on
`fix/master-red-baseline` as additions to the harness's wipe list, closing a cross-file leak: six
of them reach no other module's table, so without the wipe an *"is this ERP connected?"* read
answers from a neighbour's fixture. The repair is unchanged and now travels with the module.
