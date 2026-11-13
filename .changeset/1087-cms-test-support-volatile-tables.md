---
'@endora-commerce/mod-cms': patch
---

`@endora-commerce/mod-cms` now publishes a development-only `./test-support` subpath (issue #1087). It exports `volatileTables`, which lists `cms_templates` and `cms_template_sales_channels`. A test harness that collects module test support with `@endora-commerce/test-kit/support`'s `collectVolatileTables` now empties both tables between test files. Before this change, a CMS template written by one test file was still there in later files, with no channel binding, and tests that read every template failed. Runtime code, migrations and the other exports are unchanged.
