---
'@endora-commerce/email-components': major
---

Renamed from `@b2b/email-components` to `@endora-commerce/email-components`. Nothing else
about the package changed — same components, same `exports` subpaths.

Update the dependency and every specifier, root and subpath alike:

```diff
-"@b2b/email-components": "workspace:^"
+"@endora-commerce/email-components": "workspace:^"
```

```diff
-import { renderEmailHtml } from '@b2b/email-components/render/render-email-html';
-import { walkEmbeds } from '@b2b/email-components/tree/walk-embeds';
+import { renderEmailHtml } from '@endora-commerce/email-components/render/render-email-html';
+import { walkEmbeds } from '@endora-commerce/email-components/tree/walk-embeds';
```

Its peer `@endora-commerce/page-builder-core` is renamed in the same release; both
specifiers must move together, or the application resolves two copies of the Page Builder
runtime and its React context reads `null`.
