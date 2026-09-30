---
"@endora-commerce/cli": patch
---

`endora new instance`'s deployment examples now leave `SETTINGS_SECRET_ENCRYPTION_KEY` empty
instead of `change-me-generate-one`, with a comment saying how to generate a key.

The placeholder was not a usable key. It decodes to 16 bytes where the backend needs 32, and the
backend's boot warning fires only for an unset key, so a stack started from the example as copied
booted without a word and then failed every save of a secret setting (an API token a module
stores, for instance). Empty is the state that says so: the backend boots, logs a warning naming
the key, and secret settings stay unavailable until one is set. The line in `deploy/.env.example`
and `deploy/three-host/.env.backend.example` now reads:

```dotenv
# Generate one with `openssl rand -base64 32`. Left empty, the backend boots with a
# warning and secret settings stay unavailable until it is set.
SETTINGS_SECRET_ENCRYPTION_KEY=
```

**If you scaffolded an instance with an earlier version** and your deployment `.env` still holds
`SETTINGS_SECRET_ENCRYPTION_KEY=change-me-generate-one` (or any other `change-me` value), replace
it with a real key and restart the backend:

```sh
openssl rand -base64 32
```

No secret setting can have been saved under the placeholder, so there is nothing to re-encrypt.
