---
"@endora-commerce/mod-newsletter": patch
"@endora-commerce/mod-pwa": patch
"@endora-commerce/mod-transactional-emails": patch
"@endora-commerce/page-builder-admin": patch
"@endora-commerce/mod-i18n": patch
---

The newsletter screens, the PWA screen with its push audience builder, the transactional e-mail, e-mail block and e-mail template lists, and the e-mail builder's preview are now shown in the operator's language, English or Polish. They used to be in English whatever language was chosen.

Statuses, audiences, trigger types, field types, display modes and scopes are shown by name rather than by code (`draft`, `tag_list`, `minimal-ui`, `channel`). Every input has a label tied to it instead of a placeholder that disappears on typing. A campaign's language is chosen from the languages the active sales channels offer instead of typed as a code.

The page descriptions of these screens were removed, and the PWA push hint was shortened. Keys that nothing read were deleted: `newsletter.nav.*` and `newsletter.editor.*` from `newsletter`, `page.description`, `list.title`, `editor.preview`, `editor.viewport.*`, `editor.variables.*` and `editor.livePreview` from `transactional_emails`, and `settings.description` from `pwa`.
