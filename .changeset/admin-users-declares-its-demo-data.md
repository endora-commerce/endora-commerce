---
'@endora-commerce/mod-admin-users': minor
---

The module declares its demo data: `manifest.demo` creates the three administrator accounts the
quickstart signs in with — the platform administrator and two sales representatives — and
withdraws them again.

`endora demo seed` now reports `admin_users` by name with what it created, and `endora demo
reset` removes it. Both bodies are reached by a relative `await import()` from the manifest, so
nothing is loaded by the processes that merely compose the platform, and the module gained no
`exports` subpath, no `files` entry and no manifest `dependencies` entry.

**The sign-in details come back as `DemoSeedResult.credentials`**, so the runner prints them
once under `Sign in with:` instead of the seed logging them itself.

**The accounts are created with no `adminRoleId`.** A row carrying an `admin_roles` id is two
modules' rows in one statement, so the assignment is the instance composition's; the column is
nullable, which is what makes that split available at all. A consumer that seeds these accounts
through this body and applies no composition gets three accounts with no role.

**The withdrawal changed, and it is a repair.** The host's demo reset cleared this table with a
`truncate … cascade`, which took an administrator a developer had created for themselves. It now
deletes only the three addresses `seed` assigns.

Seeding twice creates nothing the second time, re-hashes nothing, and reports the same count and
the same credentials.
