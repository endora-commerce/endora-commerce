---
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-blog': patch
---

The CMS page list and the blog post list have **Archive** and **Unarchive** in their row menus, before **Delete** (issue #1495). Neither asks for confirmation, as in the editors. The row's status badge changes in place, the result is announced next to **New page** / **New post**, and focus stays on the row's menu. A row that no longer matches the status filter leaves the list, and focus moves to the next row. **Unarchive** returns a page or a post to a draft; a blog post goes through the existing `/unpublish` endpoint, since the blog has no `/unarchive`.
