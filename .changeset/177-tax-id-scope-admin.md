---
'@endora-commerce/mod-organizations': minor
---

**Tax-ID scope screen.** *Organizations → Tax-ID scope* (`/organizations/tax-id-scope`, also from ⌘K, *Tax-ID scope*) shows the scope in force, what each scope means, and how many tax IDs are shared, and switches it after a confirmation. If the switch to Global is refused, the screen lists the shared tax IDs with links to their organizations; if the database does not enforce the scope in force, it offers to apply it again. It is shown to holders of `organizations:manage-tax-id-scope` and reached from the Organizations list's header menu. *New organization* gains an optional parent organization for unscoped administrators, so a branch can be created under its head office.
