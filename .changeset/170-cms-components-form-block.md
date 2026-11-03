---
'@endora-commerce/cms-components': minor
---

The `forms.Form` block renderer (`specs/170-forms-module/`).

- `Form` (with `FormBlockProps`) is exported and registered as `forms.Form` in the `cms` context: it renders a form of the `forms` module from its public read — every field type, conditional visibility and validation through the shared evaluator, an error summary, consents, CAPTCHA, the availability states — posts to the storefront's `/forms/submit` and works without JavaScript. Field look `boxed` / `underline` / `pill`, size, button look and alignment are presets; its styles are in `cms-components.css`, and it writes in the brand's body font like every other block.
- Block data: a new `form` kind (`{ kind: 'form', formId }`, owner `forms`), `formBlockDataRequest`, the optional `fetchForm` source on the block-data resolver, `fetchForm` in the catalog fetch helpers and an optional `fetchForm` on the editor's preview bridge (`FormBlockData`). A resolver without `fetchForm` skips `form` requests and the block renders nothing.
- Render context: the optional `forms` entry (`CmsFormsContext`, `CmsFormsText`) and `useCmsRenderForms()`; absent, the block uses English built-in words.
