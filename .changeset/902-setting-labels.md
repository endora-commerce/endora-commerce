---
'@endora-commerce/mod-admin-notifications': patch
'@endora-commerce/mod-shipments': patch
---

The Settings screen names and describes the `admin_notifications.enabled` and `shipments.enabled` switches in the administrator's language (#902). Both modules ship translation bundles for the first time, with `settingLabels.<setting code>.name` and `.description` and the settings group's `settingGroups.<group code>.name` in English and Polish. Their manifests declare `i18n: { bundlesDir: 'i18n' }` and their tarballs carry `i18n/`.
