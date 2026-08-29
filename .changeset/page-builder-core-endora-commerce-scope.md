---
'@endora-commerce/page-builder-core': major
---

Renamed from `@b2b/page-builder-core` to `@endora-commerce/page-builder-core`. Nothing
else about the package changed — same `exports` subpaths, same React contexts and hooks.

Update the dependency and every specifier, root and subpath alike:

```diff
-"@b2b/page-builder-core": "workspace:^"
+"@endora-commerce/page-builder-core": "workspace:^"
```

```diff
-import { DEFAULT_BREAKPOINTS } from '@b2b/page-builder-core/types/responsive';
-import { usePageBuilderPuck } from '@b2b/page-builder-core/editor';
+import { DEFAULT_BREAKPOINTS } from '@endora-commerce/page-builder-core/types/responsive';
+import { usePageBuilderPuck } from '@endora-commerce/page-builder-core/editor';
```

This package is a **peer** dependency of `@endora-commerce/cms-components` and
`@endora-commerce/email-components` and ships React contexts, so the application has to
resolve exactly one copy of it. Rename it in the same install as those two: a tree that
holds `@b2b/page-builder-core` for one consumer and `@endora-commerce/page-builder-core`
for another resolves two copies, and a provider in one against a consumer in the other is
a `null` context at runtime, not a type error.
