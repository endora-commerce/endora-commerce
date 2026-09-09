---
'@endora-commerce/mod-admin-roles': minor
---

The module declares its demo data: `manifest.demo` creates the `platform_admin` and
`sales_representative` roles the demo signs in with, and withdraws them again.

`endora demo seed` now reports `admin_roles` by name with what it created, and `endora demo
reset` removes it. Both bodies are reached by a relative `await import()` from the manifest, so
nothing is loaded by the processes that merely compose the platform, and the module gained no
`exports` subpath, no `files` entry and no manifest `dependencies` entry.

**`SALES_REPRESENTATIVE_PERMISSIONS` is published on `./backend`.** It was
`backend/src/seeds/seeded-role-permissions.ts` in the application tree, and it is a constant
rather than four lines inside a seed because six `permission-authority` contract tests assert
what the seeded representative may reach and have to read the list the seed *writes* — a copy
agrees with the seed on the day it is written and never again. Since the seed that writes it is
now this package's, so is the list.

**The withdrawal changed, and it is a repair.** The host's demo reset cleared this table with a
`truncate … cascade`, and this table is shared: `blog` and `cms` seed a role apiece from their
own boot hooks, an operator's own role is indistinguishable from a demo one by every other
column, and the cascade reached `admin_users`. The reset now deletes only the two codes `seed`
assigns.

**Which administrator holds which role is not this module's.** An `admin_users` row carrying an
`admin_roles` id is two modules' rows in one statement, so the assignment stays with the
instance composition.

Seeding twice creates nothing the second time and reports the same count.
