---
'@endora-commerce/admin-kit': minor
---

`useUnsavedChangesGuard().confirm(action, ask?)` takes an optional second argument, the new exported type `UnsavedChangesAsk` — `{ title?, message?, onStay? }` (issue #1606). `title` and `message` word that one question instead of the guard's own (a scope switch can say it is a switch while a link keeps the screen-wide wording), and `onStay` runs when the operator answers *Stay here* or presses Escape, for undoing what the switch already moved — for example putting back an address the browser's Back / Forward changed. Existing `confirm(action)` calls are unchanged.
