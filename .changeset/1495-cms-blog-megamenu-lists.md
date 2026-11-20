---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-blog': minor
'@endora-commerce/mod-megamenu': minor
---

The CMS page, block, template and hook lists, the blog post, tag and category lists and the megamenu list use the kit list page, and pages, blocks, templates, custom hooks, blog posts and megamenus can now be deleted from their lists (issue #1495). The blog tag form opens in a dialog (issue #1538).

- `@endora-commerce/admin-kit/components` exports `useDebouncedValue(value, delayMs?)` and `SEARCH_DEBOUNCE_MS` (300). The hook returns `value` once it has stayed unchanged for `delayMs`. Use it so a list's search runs while the operator types, with one request per pause.
- `@endora-commerce/admin-kit/components` also exports `useRemovalFocus(rows, idOf, ready)`. It returns a `returnFocusTo` for `useConfirmDialog` that moves focus to the next row after a delete, or to the list's create action once the list is empty.
- Each row has a menu with Open (Edit for a blog tag) and Delete. Delete asks for confirmation and calls the module's existing delete endpoint. When the server refuses (the record is still referenced, or a megamenu is active on a channel), the dialog stays open and says what to do. A system CMS hook is offered no delete. The menus, the blog tag's New button and the megamenu's New button need the module's write permission (`cms.write`, `blog.write`, `megamenu.write`).
- The card title that repeated the page title is gone. Loading shows a skeleton, an empty list shows the kit `EmptyState`, statuses are badges with translated text, and the CMS page and blog post searches run as you type. The blog post and tag lists use the kit pager.
- The megamenu list's name field in the header is replaced by a New megamenu button that opens a dialog.
- `@endora-commerce/mod-blog` now lists `lucide-react` (`^1`) as an optional peer dependency, like the other module packages with an admin UI.
- Translation keys removed: cms `*.cardTitle`, `*.description`, `*.empty` and `*.loading` for `pagesList`, `blocksList`, `templatesList` and `hooksList`, and `common.search`. Blog: `postList.cardTitle`, `postList.description`, `postList.empty`, `postList.loading` and `postList.total`; `tagList.cardTitle`, `tagList.description`, `tagList.empty` and `tagList.messages.*`; `tagList.validation.invalidForm` and `tagList.validation.missingTag`; `tagList.deleteConfirm.default` and `tagList.deleteConfirm.inUse`; `categoryTree.cardTitle`, `categoryTree.description` and `categoryTree.empty`; `pagination.*`. Megamenu: `list.cardTitle`, `list.description`, `list.empty` and `list.newNamePlaceholder`. A deployment that overrides one of these keys should move its override to the new key or drop it.
