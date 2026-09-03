---
'@endora-commerce/admin-kit': major
---

`@endora-commerce/api-client` is gone; its client is now `@endora-commerce/admin-kit`'s own
(owner ruling D-202).

**What changes for you.** Nothing you imported from `@endora-commerce/admin-kit/lib` moved:
`apiClient`, `ApiError`, `apiBaseUrl` and `onUnauthorized` are the same bindings at the same
subpath. What moved is where `ApiError` is *declared* — it is now the kit's class rather than a
re-export — so a consumer that reached past the kit for it has to stop:

```diff
-import { ApiError } from '@endora-commerce/api-client';
+import { ApiError } from '@endora-commerce/admin-kit/lib';
```

Identity is the reason this matters rather than a rename: every `catch` in the admin decides
what it is looking at with `instanceof ApiError`, and two classes of that name pass every
structural comparison while failing that test.

Three symbols the deleted package exported are **not** published: `createApiClient` and the
`ApiClient` / `ApiClientOptions` types are internal to the kit now, because the kit's own
`apiClient` was their only caller and this package's surface is derived from what its consumers
reach for. Ask for them if you need to build a second client.

Drop the `@endora-commerce/api-client` dependency from your manifest; the kit no longer peers
on it.
