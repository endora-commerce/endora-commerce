---
'@endora-commerce/cms-components': minor
'@endora-commerce/page-builder-core': minor
'@endora-commerce/mod-i18n': patch
---

The rich-text editors' toolbars and dialogs now speak the operator's language (issue #1680). Every word of `RichContentEditorField`'s toolbar and of its link, heading anchor and image dialogs, the empty read-only view, the "Loading editor…" placeholder of the rich-text and inline rich-text fields, and `InlineRichTextEditor`'s bold, italic, link and emphasis buttons is read through `useFieldText`, the mechanism `richText.fullscreen` uses since #1652. The English is unchanged. The `Read more` summary the toolbar seeds into a new read-more passage is page content and stays a fixed default.

`PAGE_BUILDER_FIELD_TEXT` gains 76 keys under `richText.*`, `emphasis.*`, `richLink.*`, `richAnchor.*` and `richImage.*`; the `core` bundle carries each in English and Polish as `pageBuilder.fieldText.<key>`.

`components/RichContentEditorField` exports `LINK_DISPLAY_VARIANTS`, the link button styles (`primary-solid` … `light-solid`). Two exports of that subpath are deprecated and hold the English names only:

- `EMPHASIS_LABELS` — use `useFieldText()` with the key `` `emphasis.${variant}` `` instead.
- `LINK_DISPLAY_OPTIONS` — build the options from `LINK_DISPLAY_VARIANTS`, labelling each with `useFieldText()` and `` `richLink.display.${variant}` ``, and the plain link with `richLink.display.link`.
