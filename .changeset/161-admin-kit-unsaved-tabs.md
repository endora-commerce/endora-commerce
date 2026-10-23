---
'@endora-commerce/admin-kit': minor
---

`useUnsavedChangesPrompt(when, message?, options?)` takes an optional third argument (feature 161, FR-020): `{ guardTabsOutside: ref }` also asks before a `role="tab"` outside the referenced element is activated, and keeps the tab when the operator cancels — for a panel contributed into a host's tabbed screen, whose tab switch unmounts it. Existing two-argument calls are unchanged. Type: `UnsavedChangesPromptOptions`.
