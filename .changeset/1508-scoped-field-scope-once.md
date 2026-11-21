---
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-catalog': patch
---

The product editor states the scope once (issue #1508, UX audit CAT-08). `ScopedField` no longer shows an "Inherited", "Not translated" or "No value" badge on an inheriting field while its "Use value from <parent>" checkbox is shown, and its source line appears only when it adds a fact the field does not already show: no value at any scope above, a value inherited from further up than the checkbox's parent, an untick with nothing staged yet, what a staged tick will use, or what an own empty value means. "Set at this scope" no longer repeats the "Overridden" badge. Without write access, where there is no checkbox, the badge and the line stay as before. The product editor's scope bar drops its "Editing: <scope>" column — the channel and language selects and the banner already name the scope — and moves the Scope map link beside the language select; the `productEditor.scope.editing` string is removed.
