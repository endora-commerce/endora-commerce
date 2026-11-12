---
'@endora-commerce/mod-organizations': patch
---

`@endora-commerce/mod-organizations` now publishes a development-only `./test-support` subpath
(issue #1056). It exports `volatileTables`, which lists `organization_sales_rep_assignments` and
`organization_reach_governor`. A test harness that collects module test support with
`@endora-commerce/test-kit/support`'s `collectVolatileTables` now empties both tables between
test files. Before this change, sales-rep assignments written by one test file were still there
in later files, so those files saw a different sales-rep reach. Runtime code, migrations and the
other exports are unchanged.
