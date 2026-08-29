---
'@endora-commerce/mod-i18n': patch
---

Four keys for the InPost module's admin surfaces: `adminRoles.permission.inpost:manage`,
`appShell.nav.inpost`, and `legacyMethods.integrations.inpost.{name,description}`, in both
shipped languages.

Nothing else in `i18n/{en,pl}.json` moves. That is worth stating: the branch this arrives
on had regenerated both bundles with a tool that dropped 97 keys and replaced 18
hand-written sentences with placeholders, and the merge rebuilt them from `master` plus
these four rather than carrying that.
