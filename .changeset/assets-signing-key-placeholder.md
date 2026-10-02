---
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/cli': patch
---

`ASSETS_LIBRARY_HMAC_KEY` no longer accepts a placeholder as a signing key. A value beginning `change-me` — what the env examples carried — is not hex, so `HmacSigner.fromEnv` read it as raw bytes and signed private asset links with a string every copy of the example shares. It now throws, naming the key and `openssl rand -hex 32`, exactly where an unset key already did. The `deploy/` examples `endora new instance` writes leave the key empty, with the sentence saying what empty costs. A deployment still running on a copied placeholder will have its private asset links refused until a real key is set.
