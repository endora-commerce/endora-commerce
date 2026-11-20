---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-cms': minor
---

CMS pages, blocks and templates can be duplicated from their lists (issue #1495, UX audit CONTENT-13, DEC-17).

- New routes `POST /api/v1/admin/cms/pages/:id/duplicate`, `POST /api/v1/admin/cms/blocks/:id/duplicate` and `POST /api/v1/admin/cms/templates/:id/duplicate`, gated `cms.write`. Each answers `201` with the kind's existing detail schema, the same envelope as its create. The body is `duplicateCmsRecordRequestSchema` from `@endora-commerce/contracts`, `{ name?: string }` (1–200 characters, trimmed, no other key); without a name the copy is called `"<name> (copy)"`.
- The copy's slug or code is derived and never accepted: the original's with `-copy`, then `-copy-2`, `-copy-3`, … up to `-copy-1000`, the first one no record of its kind holds in any sales channel. A page's language slugs get the same ending as its slug.
- A page copy is always a draft at version 1 and is not on the storefront until published. It keeps the content of every language, the languages, description, meta fields, names per language, parent, breadcrumb settings, sharing image, `active` and sales channels. A block copy keeps its content, languages, description, `active` and channels, but not its hook attachments. Child pages, inbound references and the `seo` module's overrides are not copied.
- Each copy is one Command, `cms_page.duplicate`, `cms_block.duplicate` or `cms_template.duplicate`, with one audit entry against the copy: no state before, the copy's state plus `sourcePageId` / `sourceBlockId` / `sourceTemplateId` after. A refusal (`409 CMS_SLUG_RESERVED`, `409 CMS_SLUG_CONFLICT`, `409 CMS_CODE_CONFLICT`, `400 CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`, `404` for an unknown or malformed id) leaves no row and no entry. Two duplicates of one record at once get `-copy` and `-copy-2`.
- The admin lists' row menus read Open, Duplicate, Delete. Duplicate runs at once, is unavailable while a copy is being made, and opens the copy's editor with focus on its name; a refusal stays on the list with a translated reason.
- New translation keys in the cms bundle: `listActions.duplicate` and `duplicate.*` (`copyName`, `created`, `createdDraft`, `slugReserved`, `slugConflict`, `codeConflict`, `failed`).
