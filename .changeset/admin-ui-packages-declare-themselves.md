---
'@endora-commerce/admin-kit': minor
'@endora-commerce/cli': minor
---

`adminUiPackages` / `declaresAdminUi`: a workspace member may now declare
`endora: { type: 'admin-ui' }`, the third value of that block beside
`'platform'` and `'module'`, and `@endora-commerce/cli/lib/workspace-packages.js`
exports the two functions that read it.

`@endora-commerce/admin-kit` declares it. Nothing about what the kit publishes
changes; the declaration is what puts its sources into two static checks'
populations — `i18n:hardcoded`'s walk, which found the kit by name until now,
and `check:admin-zones`' third `foreign-module-id` population, which found it
not at all. A second admin-ui package (feature 091 P5b's
`@endora-commerce/page-builder-admin`) is judged from its first commit by
declaring the same block, with no edit to either check.

The declaration only ever *adds* obligations, which is what distinguishes it
from the self-certified exemption D-171 refused: forgetting it is a hard-coded
string that goes unread and a `HARDCODED_STRINGS_BASELINE` entry that reports
itself drained in the same run.
