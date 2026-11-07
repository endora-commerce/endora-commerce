---
'@endora-commerce/admin-kit': patch
---

`ScopedField` no longer drops an untick of "Use value from <parent>" made right after the field renders. The reset that a new read (a new `view`) applies now happens while rendering instead of in an effect, so it can no longer be queued behind the untick and undo it. A new `view` still starts the field over, as before.
