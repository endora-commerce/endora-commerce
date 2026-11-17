---
'@endora-commerce/mod-settings': patch
---

Every control on the Settings screen is named by its setting and described by the setting's description, its notice and its read-only reason (issue #1478). A screen reader used to announce each one as an unnamed field. The row renders through the kit's `FormField`; an address, asset or image editor is announced as a group named by the setting.
