---
'@endora-commerce/mod-i18n': minor
'@endora-commerce/mod-cms': minor
---

The fifteen `pageBuilder.colorPalette.*` strings move from `mod-cms`' bundle into
`mod-i18n`'s, in both shipped languages (feature 091, P5b — the remedy P5a applied to the
other thirty-three chrome keys, arriving for the one chrome file P5a's set did not include).

`ColorPaletteModal` is the shared page-builder chrome's, not `cms`' screen: `cms`,
`invoices` and the e-mail builder all render it, and it now ships in
`@endora-commerce/page-builder-admin`. A package cannot depend on one module's bundle for
strings three modules read, and a namespace is resolved at runtime by string — so a key the
namespace does not carry renders `cms.pageBuilder.colorPalette.title` into the operator's
screen instead of failing. The keys therefore live where the reader does, which for chrome
is the synthetic `core` scope `mod-i18n` serves.

**If you ship a translation override** keyed `cms.pageBuilder.colorPalette.*`, re-key it to
`core.pageBuilder.colorPalette.*`. The fifteen keys, their values and both languages are
otherwise unchanged; no other `cms` key moves, and the other sixty-five `pageBuilder.*` keys
in `mod-cms`' bundle are its own screens' and stay.
