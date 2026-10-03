---
'@endora-commerce/mod-cms': patch
---

Every admin write to a CMS page now runs through the Command Bus and leaves one audit entry,
written in the write's own transaction and attributed to the acting admin. Creating, updating,
saving content, publishing, archiving, unarchiving and deleting a page each used to change the
row and record nothing, so "who published this page" could not be answered afterwards.

The entries carry `objectType: 'cms_page'`, the page id as `objectId`, and one of seven actions:
`cms_page.create`, `cms_page.update`, `cms_page.set_content`, `cms_page.publish`,
`cms_page.archive`, `cms_page.unarchive` and `cms_page.delete`. An entry records the page's name,
slug, status, languages, sales channels, meta and version on each side of the write; a content
save records the language and the version it produced rather than the content tree. A refused
write, a patch that names no field and a delete of a page that is not there record nothing.

Routes, request and response shapes and status codes are unchanged. A host composed through
`composeApp` or the test kit's `composeTestServer` needs no change: both already register the
`commandBus` the module now resolves. A composition assembled by hand must register one, or the
module's boot fails with `Could not resolve 'commandBus'`.
