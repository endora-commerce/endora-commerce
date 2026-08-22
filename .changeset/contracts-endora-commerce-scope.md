---
'@endora-commerce/contracts': major
---

Renamed from `@b2b/contracts` to `@endora-commerce/contracts`. Nothing else about the
package changed — same exports, same schemas, same `dist` layout.

Update the dependency and every specifier:

```diff
-"@b2b/contracts": "workspace:*"
+"@endora-commerce/contracts": "workspace:*"
```

```diff
-import { productTypeSchema } from '@b2b/contracts';
-import { cmsContentEnvelopeSchema } from '@b2b/contracts/cms';
+import { productTypeSchema } from '@endora-commerce/contracts';
+import { cmsContentEnvelopeSchema } from '@endora-commerce/contracts/cms';
```

`@endora-commerce` is the commerce platform's own npm scope; `@endora` is reserved for
the company's other packages.
