---
'@endora-commerce/mod-i18n': patch
---

`_i18n`'s bundle stops carrying eight permission labels four modules already ship.

`adminRoles.permission.mfa:reset`, `mfa:manage`, `prompt_actions:use`,
`pwa:read`, `pwa:write`, `pwa:send_push`, `stripe:read` and `stripe:write` are
removed from `i18n/en.json` and `i18n/pl.json`. Each of them is declared by
`@endora-commerce/mod-mfa`, `mod-prompt-actions`, `mod-pwa` and `mod-stripe` in
those packages' own bundles, in both shipped languages, and has been since
feature 042 — the copy here was the one the admin actually rendered, because
`/admin-roles` resolved the key in the synthetic `core` namespace alone. Feature
091's Phase 3 makes the lookup read the merged bundle, so the module's own copy
is now the answer and this one was a duplicate.

No exported binding changes. A consumer that reads this package's bundle for one
of those eight keys should read the owning module's bundle instead; the
platform's merged bundle answers identically.
