---
'@endora-commerce/admin-kit': minor
---

`ScopedField` in `@endora-commerce/admin-kit/components` gains `help` (issue #1459, UX audit CAT-14).

`help` renders a `HelpTip` (ⓘ) beside the field's label, named after it ("More information <label>"), for an explanation too long for the one-clause `note`. It is not part of the control's `aria-describedby`, so a screen reader hears the note on every focus and the longer text only when asked for — the same split as `FormField`'s `hint` and `help`.
