---
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-pim-ergonode': patch
---

The Ergonode connector's two permission labels move into its own bundle

`adminRoles.permission.pim_ergonode:read` and `adminRoles.permission.pim_ergonode:write` ("View
Ergonode integration", "Manage Ergonode integration", with their Polish translations) leave
`@endora-commerce/mod-i18n`'s shared bundle and ship in `@endora-commerce/mod-pim-ergonode`'s own
`i18n/` bundle, where every other connector's permission labels already are. The role editor
shows the same text as before when both packages are upgraded together; with the new `mod-i18n`
and an older `mod-pim-ergonode`, the two permissions show their codes until the connector is
upgraded too.
