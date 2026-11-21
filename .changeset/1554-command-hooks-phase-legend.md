---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

The execution plan on `/platform/command-hooks` explains each phase once, in a legend above the actions, instead of repeating both hints in every action (issue #1554). The actions are now sections of one card, with the owning module as each section's one-line description.

The English and Polish text of `platform.commandHooks.plan.afterCommit.hint` is shorter. A deployment that overrides that key keeps its own text.
