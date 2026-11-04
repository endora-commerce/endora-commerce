---
'@endora-commerce/mod-assets-library': minor
---

**Breaking:** the Assets Library reads every `assets.*` setting platform-wide, through the platform's settings read (issue #333). A value saved in Admin Settings as the platform-wide value now takes effect: the active storage adapter (`assets.storage.adapter`), the local store (`assets.local.base_dir`, `assets.local.public_url_base`), every `assets.s3.*` and `assets.gcs.*` setting, and the upload policy (`assets.allowed_file_types`, `assets.max_file_size_mb`). Until now the module read those settings from the database itself and skipped the platform-wide value, so the manifest default applied; only `assets.soft_delete_retention_days` and `assets.private_url_ttl_sec` honoured it.

A per-channel value stored for an `assets.*` setting is no longer read. The module used to take whichever such value it found as the answer for every channel, and it now answers with the platform-wide value, or the default when there is none. An instance that configured its storage or upload policy as a per-channel value must save the same values as the platform-wide value in Admin Settings before it upgrades, or the module falls back to the defaults: the local store under `var/assets`, any file type, no size limit.

`assets.s3.secret_access_key` and `assets.gcs.service_account_json` are now the `secret` value type, as other modules' credentials are: Admin Settings stores a value saved from now on encrypted, never shows it again, and the settings cache holds it encrypted too. The type changes in place at boot, and a value stored before the upgrade keeps working — **but it stays plaintext, in the database and in the settings cache (Redis), until it is saved again.** After upgrading, save both credentials again in Admin Settings as the platform-wide value, and reset any per-channel value they still have, which is no longer read but is not removed. Saving either one needs `SETTINGS_SECRET_ENCRYPTION_KEY`, which every secret setting already requires.

The active storage adapter is still built once per process, so a change to the adapter or its credentials applies after a restart, as before.
