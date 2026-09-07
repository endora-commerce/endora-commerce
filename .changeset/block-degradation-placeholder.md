---
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

A stored Page Builder block whose owning module is absent now degrades to a visible,
data-preserving placeholder instead of vanishing.

**`@endora-commerce/cms-components`** gains `withMissingBlockPlaceholders(config, storedNames)`.
Give it a Puck `Config` and the block names a stored document carries, and every name the
config cannot render comes back keyed to a placeholder that names the block and its owning
module. It adds no category entry: a degraded block stays editable where it already is and is
insertable by nobody.

```diff
 const filtered = filterConfigByContext(merged, context);
+const degraded = withMissingBlockPlaceholders(filtered, [...countBlockNames(doc).keys()]);
```

It takes names rather than the document deliberately — a React caller needs a stable memo key,
and a keystroke inside a text block moves the document without moving its names.

**`makeMissingComponentConfig` gains a third, optional argument**, `{ visible?: boolean }`.
Existing calls are unchanged: omitting it keeps the placeholder deciding for itself from the
`?cms_admin=1` preview parameter, which is right for a customer-facing surface. Pass
`{ visible: true }` on an editing surface, where the operator has to be told which module the
block is waiting on.

**`@endora-commerce/page-builder-core`** exports `countBlockNames`, `mapBlockNames`,
`renameBlockNames` and their two types from the package root. They were reachable only through
the `./migration` subpath, which still exports them, so no existing import changes. What that
subpath quarantines is the frozen rename map; the walk itself is a generic "which node `type`
values does this document hold" and is now needed at runtime.

**`@endora-commerce/mod-cms`**'s `PageBuilderEditor` applies both. Its canvas previously
rendered nothing at all for a block whose owner had been switched off — indistinguishable
from a block somebody had deleted — because the placeholder it merged was built only for
names the backend descriptor declares, and a switched-off module's blocks are filtered out
of that descriptor. Every placeholder it did merge rendered an empty `<span>`, the
`?cms_admin=1` parameter being set by nothing.
