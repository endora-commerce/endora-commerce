---
'@endora-commerce/cms-components': major
---

Renamed from `@b2b/cms-components` to `@endora-commerce/cms-components`. Nothing else
about the package changed — same components, same `exports` subpaths, same stylesheet.

Update the dependency and every specifier, including the CSS one:

```diff
-"@b2b/cms-components": "workspace:^"
+"@endora-commerce/cms-components": "workspace:^"
```

```diff
-import { CmsRenderProvider } from '@b2b/cms-components';
-import '@b2b/cms-components/styles.css';
+import { CmsRenderProvider } from '@endora-commerce/cms-components';
+import '@endora-commerce/cms-components/styles.css';
```

Its peer `@endora-commerce/page-builder-core` is renamed in the same release; both
specifiers must move together, or the application resolves two copies of the Page Builder
runtime and its React context reads `null`.
