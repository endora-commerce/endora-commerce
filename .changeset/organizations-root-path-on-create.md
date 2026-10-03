---
'@endora-commerce/mod-organizations': patch
---

A newly created organization is stored with the path of a root, `/<id>/`. Until now only the
re-parent command wrote `organizations.path`, so every organization created by registration, as
the personal organization of a B2C account or by the demo seed kept the column's empty default.
The tree reads a path as a prefix, and an empty one is the prefix of every path, so for such an
organization:

- `OrganizationTreeService.subtreeIds` and `GET /api/v1/admin/organizations/:id/subtree` returned
  **every** organization, which is also the set a customer account with `subtreeRollupEnabled` is
  widened to;
- `POST /api/v1/admin/organizations/:id/parent` refused as `422 ORGANIZATION_TREE_INVALID`
  (`cycle`) whatever parent was chosen.

The `Organization` entity now assigns the root path on create. Existing rows are repaired by a new
migration, `Migration20261003T184802OrganizationsRepairEmptyPaths`, which runs on the next
`endora upgrade` or `pnpm run setup`: it rewrites `path` from the `parent_id` chain for every row
where the two disagree, and writes nothing else. **If any customer account on your instance has
`subtreeRollupEnabled` set, apply this release before relying on that account's scope.**
