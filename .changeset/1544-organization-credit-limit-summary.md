---
'@endora-commerce/mod-credit-limits': minor
'@endora-commerce/mod-organizations': patch
---

**Credit limits on the Organization screen** (UX audit SALES-19, issue #1544). `credit_limits` contributes a read-only *Credit limit* summary to `organization.detail.after`, the Organization screen's Commerce tab: the granted, reserved and available amounts and the number of active reservations, or a note that no limit is granted. When reservations exceed the limit it says by how much. Its one link, *Adjust limit* or *Grant credit limit*, opens the Credit limits screen with that organization's dialog already open (`/credit-limits?organizationId=<id>`); closing the dialog drops the parameter. The panel needs `credit_limits:manage` and is absent while the module is off. `organizations` only updates a comment that lists the zone's contributors.
