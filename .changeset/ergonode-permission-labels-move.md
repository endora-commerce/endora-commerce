---
'@endora-commerce/mod-i18n': patch
---

The Ergonode connector's two permission labels move into its own bundle

`adminRoles.permission.pim_ergonode:read` and `adminRoles.permission.pim_ergonode:write` ("View
Ergonode integration", "Manage Ergonode integration", with their Polish translations) leave
`@endora-commerce/mod-i18n`'s shared bundle. `@endora-commerce/mod-pim-ergonode` ships them in its
own `i18n/` bundle from its next release, which is cut from the paid-modules repository now that the
connector has left this one; until an instance runs that release beside this `mod-i18n`, the two
permissions show their codes in the role editor.
