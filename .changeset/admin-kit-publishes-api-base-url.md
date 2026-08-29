---
'@endora-commerce/admin-kit': minor
---

Added `apiBaseUrl` to `@endora-commerce/admin-kit/lib`.

The origin the admin's `apiClient` was built from, published beside it. A screen that has to
build a URL the fetch client cannot make for it — an `<a download>` href, a form action — needed
that origin and had no supported way to ask for it, so it read `import.meta.env.VITE_API_BASE_URL`
itself. Inside a **module package** that is a second copy of the `http://localhost:3001` fallback
plus `vite/client` types in the package's own compiler configuration, for one string.

```diff
-const apiBaseUrl =
-  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';
+import { apiBaseUrl } from '@endora-commerce/admin-kit/lib';
```

The value is identical to the one `apiClient` uses — it is now the same binding, not a second
read — and the expression stays verbatim in the kit, because Vite replaces
`import.meta.env.VITE_API_BASE_URL` at build time and a cast or an indirection is a chance for
that replacement to stop happening in a way no type-check can see.
