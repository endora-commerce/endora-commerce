---
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-ksef': patch
---

The KSeF module's two permission labels move into its own bundle

`adminRoles.permission.ksef:read` and `adminRoles.permission.ksef:write` ("View KSeF status",
"Manage KSeF integration", with their Polish translations) leave `@endora-commerce/mod-i18n`'s
shared bundle and ship in `@endora-commerce/mod-ksef`'s own `i18n/` bundle, where the other
integrations' permission labels already are. The role editor shows the same text as before when
both packages are upgraded together; with the new `mod-i18n` and an older `mod-ksef`, the two
permissions show their codes until the module is upgraded too.
