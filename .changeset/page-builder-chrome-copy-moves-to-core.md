---
'@endora-commerce/mod-i18n': minor
'@endora-commerce/mod-cms': major
---

The shared admin page-builder chrome's copy moves out of `mod-cms`' bundle and into
`mod-i18n`'s, which the admin serves under the synthetic `core` scope (feature 091 P5a;
ruling R-1: a translation namespace is module knowledge, and this copy is nobody's).

**`@endora-commerce/mod-cms`' bundle loses 33 keys**, every one of them under
`pageBuilder.*` and every one of them read only by `PageBuilderHeaderActions.tsx` — the
header shell, the template actions and the header tools that `cms`, `invoices` and the
e-mail builder all render. The blocks that moved whole are
`pageBuilder.saveAsTemplate.*` (9), `pageBuilder.applyTemplate.*` (9),
`pageBuilder.copyLanguage.*` (8, minus `emptySource`), `pageBuilder.clearCanvas.*` (5) and
`pageBuilder.fullscreen.*` (2). The bundle keeps its other 65 `pageBuilder.*` keys —
`components.*`, `categories.*`, `drawer.*`, `copyLanguage.emptySource` and the rest — which
belong to `cms`' own screens, and it keeps `common.saving`, `fields.name` and `fields.code`,
which its editors read.

**`@endora-commerce/mod-i18n` gains those 33 plus three new `common.*` entries**:
`common.state.saving`, `common.field.name` and `common.field.code`. They are additions
rather than moves because `cms` reads its own copies of the same three concepts from its own
screens; no existing `core` key carried those values.

**What a consumer that supplies its own bundle has to do:** move the 33 `pageBuilder.*` keys
from the `cms` scope into `core`, and add the three `common.*` entries. A key left behind
does not fail to compile and does not 404 — it renders `core.pageBuilder.clearCanvas.button`
into the operator's screen as a label.

`common.state.saving` is `"Saving…"` / `"Zapisywanie…"`, with the typographic ellipsis its
`common.state.loading` sibling uses, where `cms`' own `common.saving` is `"Saving..."`. That
is the one rendered character this release changes.
