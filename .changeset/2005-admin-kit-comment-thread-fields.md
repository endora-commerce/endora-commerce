---
'@endora-commerce/admin-kit': minor
---

**`CommentThread` shows a note's custom fields** (issue #2005). New optional prop `customFieldEntityType`: on a note thread it reads that type's definitions once, offers them in the composer and in a note's edit form with `CustomFieldValuesPanel`'s inputs (a `422 CUSTOM_FIELD_VALUE_INVALID` shown at its field), and shows a line of each note's stored values. A message thread ignores it. `CommentThreadApi.add` and `.update` gain an optional trailing `customFieldValues` argument, sent only when a value was chosen or changed; `RecordComment` gains an optional `customFieldValues`; `CommentComposer` takes `children`, drawn above its button. `CustomFieldValuesPanel` takes optional `definitions` (the panel then asks for none) and `fieldIdPrefix` (default `cf`). All additive: existing callers need no change.
