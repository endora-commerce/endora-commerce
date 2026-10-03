---
'@endora-commerce/mod-settings': patch
---

Documentation: the Settings page now describes how settings are actually registered and
removed. A module declares its settings manifest as the `settings` field of its module
manifest; there is no array in `backend/src/composition.ts` to append to. The CLI section named
`modules:install` / `modules:uninstall`, which do not exist, with an `--force` flag that
`module:install` refuses; it now documents `module:install <id> [--dry-run] [--json]` and
`module:uninstall <id> [--hard --force] [--json]`, and that `--remove-settings` /
`--preserve-settings` survive only as aliases. The reconciler table no longer says a changed
`valueType` or `defaultValue` can be forced through, and the value-type list now includes
`secret` and `credential_ref`.
