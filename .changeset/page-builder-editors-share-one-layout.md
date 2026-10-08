---
'@endora-commerce/page-builder-admin': minor
'@endora-commerce/mod-blog': minor
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-i18n': patch
---

Every Page Builder editor is laid out the same way: the blog post, blog category and
transactional e-mail editors join the CMS ones.

**`@endora-commerce/page-builder-admin` publishes the editor shell.** New exports on `.`:
`PageBuilderEditorLayout`, `usePageBuilderEditorSettingsPanel`,
`PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY`, `PAGE_BUILDER_EDITOR_TWO_COLUMN_MIN_WIDTH` and the
types `PageBuilderEditorLayoutProps` and `PageBuilderEditorSettingsPanel`. It is the layout the CMS
editors already have — canvas as the main column, the entity's cards in a settings panel that is a
column beside it from 1800 px, a block above it below that, collapsed by default there, always open
for a new entity, revealed when a save is refused, the choice remembered per browser — moved out of
`cms` so that a module does not have to depend on `cms` to lay out an editor. Three shapes: with a
settings panel; without one (`settings` omitted — the canvas has the page); and `builder={null}`
for an entity that has no canvas yet, where the cards are the page and nothing collapses. Its four
strings are `pageBuilder.editorLayout.*` in the `core` bundle (`@endora-commerce/mod-i18n`).

**Blog post and blog category editors.** The Page Builder is the main column and the fields are in
the settings panel, grouped: Metadata, Scope, Search engines (SEO), then for a post Tags, Related
posts, Related products and Lifecycle. **One Save replaces "Save metadata" and "Save content" /
"Save description"**: it is in the header with "Save and exit", sends the same requests (the fields,
then the canvas only if it was edited), and a save that cannot go through names what is missing and
opens the panel instead of leaving a disabled button. Publish / Unpublish moved to the header;
Archive is in the Lifecycle card. The canvas now follows the language tab, and saving tags or
related content no longer puts the stored content back under unsaved canvas edits. A new post or
category, which has no canvas until it exists, shows the fields as the page. `mod-blog` gains
`@endora-commerce/page-builder-admin` as an optional peer dependency, next to the
`@endora-commerce/mod-cms` one it already had. Removed bundle keys: `common.saveContent`,
`common.saveDescription`, `common.saveMetadata`, `messages.contentSaved`,
`messages.descriptionSaved`.

**Transactional e-mail, e-mail block and e-mail template editors.** The canvas takes the full
editor width and starts on the first screen; the scope, the language and the subject sit on one row
above it instead of in three stacked cards. These editors deliberately have **no** settings panel:
those fields say which message is on the canvas or are part of it. Their labels and messages are
now translated (`pl` included) instead of hard-coded English. A save without a subject is refused
on the screen, with a sentence that names the field and the cursor put in it, instead of the API's
generic validation error; `EmailSubjectWithVariables` (`@endora-commerce/page-builder-admin/email`)
gains the optional `invalid` and `describedBy` props that carry it.

**`mod-cms`**: no visible change. Its three editors import the shell from
`@endora-commerce/page-builder-admin`; the `editorLayout.*` keys left its bundle for `core`. The
shell was never exported from `cms` (`./admin-ui` still publishes only `PageBuilderEditor`), so no
import breaks. The remembered choice keeps its storage slot, `b2b-admin.cms-editor.settings-panel`,
so operators who already chose keep their choice — and it now applies to the blog editors too.
One behaviour differs: when a refused save opens the panel, the page scrolls to the top of the
editor, so the message is on screen with the fields under it, rather than to the panel alone.

No request, response or payload shape changed.
