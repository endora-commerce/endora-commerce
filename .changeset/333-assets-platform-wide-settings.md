---
'@endora-commerce/mod-assets-library': minor
---

**Breaking:** the Assets Library reads every `assets.*` setting platform-wide, through the platform's settings read (issue #333). A value saved in Admin Settings as the platform-wide value now takes effect: the active storage adapter (`assets.storage.adapter`), the local store (`assets.local.base_dir`, `assets.local.public_url_base`), every `assets.s3.*` and `assets.gcs.*` setting, and the upload policy (`assets.allowed_file_types`, `assets.max_file_size_mb`). Until now the module read those settings from the database itself and skipped the platform-wide value, so the manifest default applied; only `assets.soft_delete_retention_days` and `assets.private_url_ttl_sec` honoured it.

A per-channel value stored for an `assets.*` setting is no longer read. The module used to take whichever such value it found as the answer for every channel, and it now answers with the platform-wide value, or the default when there is none. An instance that configured its storage or upload policy as a per-channel value must save the same values as the platform-wide value in Admin Settings before it upgrades, or the module falls back to the defaults: the local store under `var/assets`, any file type, no size limit.

The active storage adapter is still built once per process, so a change to the adapter or its credentials applies after a restart, as before.
