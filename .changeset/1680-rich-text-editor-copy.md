---
'@endora-commerce/cms-components': patch
'@endora-commerce/page-builder-core': patch
'@endora-commerce/mod-i18n': patch
---

The rich-text editors' toolbars and dialogs now speak the operator's language (issue #1680). Every word of `RichContentEditorField`'s toolbar and of its link, heading anchor and image dialogs, the empty read-only view, the "Loading editor…" placeholder of the rich-text and inline rich-text fields, and `InlineRichTextEditor`'s bold, italic, link and emphasis buttons is read through `useFieldText`, the mechanism `richText.fullscreen` uses since #1652. The English is unchanged.

`PAGE_BUILDER_FIELD_TEXT` gains 76 keys under `richText.*`, `emphasis.*`, `richLink.*`, `richAnchor.*` and `richImage.*`; the `core` bundle carries each in English and Polish as `pageBuilder.fieldText.<key>`. `RichContentEditorField` exports `LINK_DISPLAY_VARIANTS`, the link button styles; `EMPHASIS_LABELS` and `LINK_DISPLAY_OPTIONS` stay exported for importers of the `components/RichContentEditorField` subpath, deprecated, and hold the English names only.
