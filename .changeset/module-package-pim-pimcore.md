---
'@endora-commerce/mod-pim-pimcore': minor
---

`pim_pimcore` is a package: `@endora-commerce/mod-pim-pimcore`, with three subpaths (`.` for
the manifest, `./backend` for composition, `./migrations` for the two migration classes) and an
`i18n/` bundle directory beside `dist`.

**`./backend` exports an `entities` array and no entity class by name** (D-168). The eight
`Pimcore*` classes are reachable only through that array, which is the value the host's ORM
registers, so there is exactly one of each in a process. If you want a row's *shape*, the
contract is in `@endora-commerce/contracts`.

Nothing about the module's behaviour, schema or HTTP surface changes. The two migration classes
keep their names, so a database that has applied them sees nothing pending.
