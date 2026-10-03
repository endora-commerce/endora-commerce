---
'@endora-commerce/mod-organizations': patch
---

A newly created organization is stored with the tree path of a root, `/<id>/`, and the tree
service no longer trusts a stored path it cannot read.

**Who is affected.** Any instance holding organizations that were created by company registration,
as the personal organization of a B2C account, or by the demo seed, and never re-parented since.
Those rows were stored with an empty `organizations.path`.

**What was wrong for such an organization.**

- Its subtree was read too wide. That affects `GET /api/v1/admin/organizations/:id/subtree`,
  sales-rep subtree assignment, and the scope of a customer account with `subtreeRollupEnabled`.
- `POST /api/v1/admin/organizations/:id/parent` refused every move with
  `422 ORGANIZATION_TREE_INVALID` (`cycle`).

**What changes.**

- The `Organization` entity assigns the root path on create.
- A new migration, `Migration20261003T184802OrganizationsRepairEmptyPaths`, runs on the next
  `endora upgrade` or `pnpm run setup`. It rewrites `path` from the `parent_id` chain for every row
  where the two disagree and bumps that row's `version`; a row that was already right is not
  written.
- `OrganizationTreeService` judges a stored path before using it (`isReadableTreePath`, exported).
  For an organization whose path is empty or malformed, `subtreeIds` and `subtreeNodes` answer
  that organization alone, `ancestorIds` answers none, and a re-parent involving it is refused with
  `409 ORGANIZATION_TREE_INVALID` and the new token `path_unreadable`, whose `details` name the
  organization. The token has its sentence in English and Polish.

**If any customer account on your instance has `subtreeRollupEnabled` set, apply this release.**
