---
'@endora-commerce/api-client': major
---

Renamed from `@b2b/api-client` to `@endora-commerce/api-client`. Nothing else about the
package changed — same client, same exported types.

Update the dependency and every specifier:

```diff
-"@b2b/api-client": "workspace:*"
+"@endora-commerce/api-client": "workspace:*"
```

```diff
-import { createApiClient } from '@b2b/api-client';
+import { createApiClient } from '@endora-commerce/api-client';
```

Its peer in this rename is `@endora-commerce/contracts`, whose types it re-exports: move
both specifiers in the same change, or one half of your types resolves to a package that
is no longer there.
