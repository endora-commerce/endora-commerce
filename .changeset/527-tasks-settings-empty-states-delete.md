---
"@endora-commerce/mod-tasks": patch
---

Tasks admin: the Tags and Priorities settings screens show a proper empty state — an icon, what the list is for, and one primary *Add tag* / *Add priority* action — instead of a bare sentence. On a Task's screen *Delete task* moves from beside *Edit* in the Details section to the page header, and its confirmation is the kit's `ConfirmDialog`, which opens on *Cancel*. The i18n keys `tags.empty` and `priorities.empty` are replaced by `tags.empty.title` / `tags.empty.body` and `priorities.empty.title` / `priorities.empty.body`.
