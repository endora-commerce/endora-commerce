---
'@endora-commerce/mod-assets-library': patch
---

`assets.soft_delete_retention_days` is held to 1–3650 whole days (issue #332). The settings write refuses any other value with `422 VALIDATION_FAILED`, and a value stored before this rule that is above 3650 is read as 3650 days. A large stored value used to make the purge date invalid, so every asset delete and every recursive folder delete failed until somebody corrected the setting.
