---
'@endora-commerce/mod-pim-pimcore': minor
---

New package: `@endora-commerce/mod-pim-pimcore`, the Pimcore PIM connector.

Pimcore sends complete, Endora-targeted catalogue records over HMAC-authenticated HTTPS;
Endora accepts them durably and applies them asynchronously. It never calls Pimcore.

Four subpaths: `.` for the manifest, `./backend` for composition, `./migrations` for the two
migration classes, and `./admin` for the three admin screens and the sidebar entry the module
declares for itself. `i18n/` ships beside `dist`.

**`./backend` exports an `entities` array and no entity class by name** (D-168). The eight
`Pimcore*` classes are reachable only through that array, which is the value the host's ORM
registers, so there is exactly one of each in a process. For a row's *shape*, import the
contract type from `@endora-commerce/contracts`.

**`./admin` exports `contributions` and nothing else.** Every route component is a
`() => import(...)` factory, so a consumer's bundler gets a split point and an operator
downloads only what their role can reach.

The module is switchable (`pim_pimcore.enabled`, default on) and declares two permission codes,
`pim_pimcore:read` and `pim_pimcore:write`, plus seventeen `PIM_PIMCORE_*` error codes routed to
its own translation bundle.
