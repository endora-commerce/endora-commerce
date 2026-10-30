---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

Two block presets, both optional; a stored block renders exactly as before.

- `cms.Accordion`: `itemStyle` accepts `filled` (root class `cmsc-pb-accordion--filled`): each title bar sits on the colour scheme's surface tint (`--cmsc-surface-tint`, today's light neutral outside a scheme), the panel inset below it, items 8 px apart; the dividers fields are hidden for it, as for boxed items.
- `cms.DownloadTile`: with the round icon button (`linkLook: 'icon'`), `iconButtonSize` (`s` 48 px as today, `m` 72 px, `l` 112 px; class `cmsc-pb-download-tile--icon-<s|m|l>`) and `iconButtonStyle` (`outline` as today, or `filled`: a disc in the text colour with the glyph in the card's background; class `cmsc-pb-download-tile--icon-filled`). Presets only — no px value and no colour.

`mod-cms` ships the English and Polish editor labels of the new options.
