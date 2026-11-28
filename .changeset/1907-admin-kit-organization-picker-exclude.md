---
'@endora-commerce/admin-kit': minor
---

`OrganizationPicker` takes an optional `excludeIds`: organizations it never offers. The Organization
merge flow (issue #1907) uses it so the organization that stays is not offered as its own duplicate.
