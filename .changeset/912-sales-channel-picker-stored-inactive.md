---
'@endora-commerce/admin-kit': patch
---

`SalesChannelPicker` with `activeOnly` keeps a stored inactive channel among its options (#912). It used to ask the endpoint for active channels only, so a saved value pointing at a deactivated channel was missing from the options: the field showed nothing and offered no Clear. The picker now reads the whole list and narrows the options itself, as the CRM's sales-channel lookup does — the stored channel stays visible, marked inactive in the list, and can be cleared or replaced, while other inactive channels are still not offered as new choices. Its request is now always `activeOnly=false`.
