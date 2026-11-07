---
'@endora-commerce/admin-shell': patch
'@endora-commerce/admin-kit': patch
---

A signed-in admin who opens `/login` (a bookmark, a link in an e-mail) is redirected instead of seeing "Page not found" (issue #859). `App` gains a `/login` route for the authenticated tree. It leads to the `?next=` target when that is a path of this application, and to the dashboard (`/`) otherwise. Nothing else in the query is carried over, so `?error=` is still never shown.

`readReturnTo(params, param?)` in `@endora-commerce/admin-kit/lib` takes an optional parameter name, which defaults to `returnTo`. It reads `next` by the same rule: a path of this application only, never a scheme, a host or `//`. Existing calls are unchanged.
