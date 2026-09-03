---
'@endora-commerce/cms-components': major
'@endora-commerce/email-components': major
'@endora-commerce/page-builder-core': minor
'@endora-commerce/contracts': minor
---

Page Builder block names are namespaced. **Every renderer map is re-keyed.**

`defaultPageBuilderConfig` and `defaultEmailBuilderConfig` stop being `Config` objects
keyed by bare names (`Row`, `EmailHeading`) and become renderer maps keyed by the
persisted, namespaced name (`cms.Row`, `transactional_emails.EmailHeading`). The
`categories` block is **deleted** from both: a palette section is declared by the module
whose blocks occupy it and is served, merged across the effectively present modules, by
`GET /api/v1/admin/cms/page-builder/config`.

```diff
-import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
-const row = defaultPageBuilderConfig.components?.Row;
-const layout = defaultPageBuilderConfig.categories?.layout;
+import { defaultPageBuilderConfig, buildPaletteCategories } from '…';
+const row = defaultPageBuilderConfig.components?.['cms.Row'];
+// Sections come from the descriptor, merged per (key, context):
+const layout = buildPaletteCategories(descriptor.components, descriptor.categories, 'cms', {
+  title: (section) => t(section.ownerModule, section.titleKey),
+  renderable: new Set(Object.keys(config.components ?? {})),
+});
```

`@endora-commerce/email-components` additionally re-keys `EMAIL_SAFE_COMPONENT_NAMES`,
`EMAIL_COMPONENT_REQUIRED_VARIABLES` and `EMAIL_ORDER_LABELED_FIELDS`, and its 28 renderer
`case` labels in `render-email-html` / `render-email-text`. `emailContexts` is gone: every
entry now declares `contexts: ['email']`, and the newsletter palette is served by the
`email → newsletter` admission rather than by a widened declaration.

`@endora-commerce/page-builder-core` gains two things and breaks nothing:

- `buildPaletteCategories(blocks, sections, context, options)` — the one implementation of
  "which sections does the palette for this context have, and what is in them". It applies
  `contextAdmits` to blocks **and** to sections, which is what keeps the newsletter palette
  sectioned rather than 28 entries in Puck's *Other* drawer.
- a `./migration` subpath exporting `FROZEN_BLOCK_RENAMES`, its inverse, the structural
  walk (`renameBlockNames`, `countBlockNames`, `mapBlockNames`) and the SQL builders the
  five rename migrations use. **It is not a runtime path** — the map is a frozen historical
  constant, not an alias table, and the difference is only real while nothing resolves
  through it.

`@endora-commerce/contracts` extends `cmsPageBuilderDescriptorSchema.categories` additively
with `ownerModule`: the module whose declaration won the merge, derived and never declared.
