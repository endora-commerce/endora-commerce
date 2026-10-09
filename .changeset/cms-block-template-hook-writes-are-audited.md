---
'@endora-commerce/mod-cms': patch
---

Every admin write to a CMS block, a CMS template and a CMS hook now runs through the Command Bus
and leaves one audit entry, written in the write's own transaction and attributed to the acting
admin. Page writes already did; these three kinds changed the row and recorded nothing, so "who
edited this block" or "who detached it from that hook" could not be answered afterwards.

- **Blocks** — `objectType: 'cms_block'`, actions `cms_block.create`, `cms_block.update`,
  `cms_block.set_content`, `cms_block.delete`.
- **Templates** — `objectType: 'cms_template'`, actions `cms_template.create`,
  `cms_template.update`, `cms_template.set_content`, `cms_template.delete`.
- **Hooks** — `objectType: 'cms_hook'`, actions `cms_hook.create`, `cms_hook.update`,
  `cms_hook.delete`, and for the blocks attached to a hook `cms_hook.attach_block`,
  `cms_hook.reorder_block`, `cms_hook.detach_block`. An attachment has no id of its own, so its
  entries carry the hook id as `objectId` and name the block and its position in the state.

An entry records the facts an operator sets — name, code, active flag, description, languages,
sales channels and version — on each side of the write; a content save records the language and
the version it produced rather than the content tree, as a page's does. A refused write, a patch
that names no field, and detaching or reordering a block that was not attached record nothing.

Routes, request and response shapes and status codes are unchanged. Deleting a block, a template
or a hook, and detaching a block, now run inside a transaction; they ran as bare statements
before. `CmsBlockService`, `CmsTemplateService` and `CmsHookService` take the `CommandBus` as
their second constructor argument; the module's own composition supplies it, so a host composed
through `composeApp` or the test kit's `composeTestServer` needs no change.
