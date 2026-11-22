---
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

The six section presets in the Page Builder's block drawer now insert their placeholder copy in the content language being edited, not in the operator's admin language (issue #1684). A Polish page gets Polish copy in an English admin. A content language with no copy of its own gets the English. The drawer still names the presets in the admin language.

`@endora-commerce/page-builder-core` exports:
- `contentDefaultsIn(table, locale)`, which returns the row of a per-language table (`Record<SupportedLanguage, Row>`) for a BCP-47 locale, and the English row for a language with no row. `contentDefaultFor` now goes through it.
- `useContentLocale()`, which returns the locale the nearest `PageBuilderContentLocaleProvider` names, or `null` outside one.

`@endora-commerce/cms-components`:
- **Breaking:** `SectionPreset.build` in `editor/section-presets` now takes the resolved copy (`SectionPresetCopy`) instead of a translator. `PresetTranslate` is removed. Before: `preset.build((key) => t(key))`. After: `preset.build(contentDefaultsIn(SECTION_PRESET_COPY, useContentLocale()))`.
- The new `editor/section-preset-copy` subpath exports `SECTION_PRESET_COPY` (one row per shipped language) and the `SectionPresetCopy` type.

`@endora-commerce/mod-cms`: the `cms` bundle's `presets.*` keys now hold only the drawer's chrome (names, descriptions, status). The 29 placeholder-copy keys are removed from `en` and `pl`.
