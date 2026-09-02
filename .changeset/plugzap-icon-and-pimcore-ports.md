---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': patch
---

`KnownIconNameSchema` gains `'PlugZap'`, with the matching entry in the kit's
`resolveIcon` map. A module declaring a sidebar entry or a palette action names its icon as a
string rather than importing the component, so a glyph the allowlist does not carry cannot be
declared at all.

`@endora-commerce/contracts` also publishes the Pimcore connector's own surface — the
`Pimcore*` DTOs, the delivered-record envelope, `PIM_PIMCORE_SETTING_CODES` and seventeen
`PIM_PIMCORE_*` members of `ERROR_CODES` — and three catalogue shapes the connector's ports
need.

No existing export changes shape.
