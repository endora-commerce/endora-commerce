---
'@endora-commerce/mod-credentials': patch
---

Saving or resolving a credential on an instance with no usable `SETTINGS_SECRET_ENCRYPTION_KEY`
now answers `500 SETTING_SECRET_KEY_MISSING` with a message naming the variable — and, for a key
of the wrong length, how long it must be — instead of `500 INTERNAL` "Internal server error.".
`POST` and `PUT /api/v1/admin/credentials` and `CredentialsPort.resolve` are the three places
affected. It is the code `@endora-commerce/mod-settings` already raises for the same key. The
write still fails closed: nothing is stored and nothing is decrypted.
