---
'@endora-commerce/demo-composition': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-admin-roles': patch
---

**A demo seed or reset that stops part-way no longer leaves the demo administrators without a
role.** An administrator without a role is refused, and a demo run is not one transaction, so the
pairing of the three demo accounts with their roles can no longer wait for a late step:

- `demo seed` creates each demo administrator already holding its role. An account that an
  earlier, interrupted run left without a role is given it on the next `demo seed`; a role
  somebody chose for one of these accounts is never replaced.
- The composition step "demo administrators take their roles" now runs first and only fills in a
  missing role. Its withdrawal no longer unassigns anything.
- `demo reset` deletes the demo accounts with their role still on them, then the demo's own
  `sales_representative` role. The `platform_admin` role stays.

`demo seed` now fails, naming the role, if a role a demo administrator needs does not exist,
rather than creating the account without one.

**Several processes can start at once on a database that does not hold the
platform-administrator role yet.** Each process ensures the role at boot; the ones that lose the
race now find the role the winner created instead of failing to start.
