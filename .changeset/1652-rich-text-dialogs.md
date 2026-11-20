---
'@endora-commerce/cms-components': patch
'@endora-commerce/page-builder-core': patch
'@endora-commerce/mod-i18n': patch
---

The rich-text editors' dialogs are now accessible modal dialogs (issue #1652). The link, heading anchor and image dialogs of `RichContentEditorField`, the link, icon and highlight-colour dialogs of `InlineRichTextEditor`, and `RichContentEditorField`'s full-screen mode are named by their title (`role="dialog"`, `aria-modal`, `aria-labelledby`), hold focus while open, close on Escape (only the topmost of stacked dialogs answers it, so the asset library opened from the image dialog closes alone), and return focus to the toolbar button that opened them. They are drawn by a new internal `CmsModalDialog`, which keeps the admin kit `ModalDialog`'s contract without depending on the kit, so the package stays storefront-safe. The dialog headings are now `<h2>` (were `<h3>`), and the link dialog is named "Link" (was "Edit link").

`PAGE_BUILDER_FIELD_TEXT` gains `richText.fullscreen`, the full-screen editor's accessible name; the `core` bundle carries it in English and Polish as `pageBuilder.fieldText.richText.fullscreen`.
