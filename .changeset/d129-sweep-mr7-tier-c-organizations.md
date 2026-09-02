---
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-i18n': patch
---

Error-code ownership: `organizations` declares the eight codes it owns and ships its first i18n
bundle.

`CANNOT_REVOKE_LAST_ADMIN_INVITE`, `EMAIL_ALREADY_IN_ORGANIZATION`,
`EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION`, `ORGANIZATION_HAS_CHILDREN`, `ORGANIZATION_SUSPENDED`,
`ORGANIZATION_TAX_ID_EXISTS`, `ORGANIZATION_TREE_INVALID` and `ORG_OWNER_DEPLETION` move from
`@endora-commerce/mod-i18n`'s manifest to `@endora-commerce/mod-organizations`'. For a consumer the
observable difference is **which bundle answers for them**: the sentences are no longer served from
the platform bundle and are now in this module's own `i18n/{en,pl}.json`, so a deployment that
ships `@endora-commerce/mod-organizations` gets them and one that does not gets the raising code's
own English. Two of the eight are raised by another module — `ORG_OWNER_DEPLETION` by
`@endora-commerce/mod-customers` and `ORGANIZATION_SUSPENDED` by `@endora-commerce/mod-orders` — so
for those two the sentence and the raise now ship in different packages.

Five of the eight arrive with prose written for the first time; they carried a machine-shaped
restatement of their own code (`"Organization Suspended."`), which is deleted rather than moved.
`ORG_OWNER_DEPLETION` had no sentence in either language and now has one.

**Three token sub-keys are new and are the ones the error envelope actually reads.** Every raise of
`ORGANIZATION_HAS_CHILDREN` and `ORGANIZATION_TREE_INVALID` carries a `details.code`, so the
envelope looks up `errors.<CODE>.<token>`: `errors.ORGANIZATION_HAS_CHILDREN.has_children`,
`errors.ORGANIZATION_TREE_INVALID.cycle` and `errors.ORGANIZATION_TREE_INVALID.max_depth_exceeded`.
Until now only the base keys existed and neither code rendered a translated sentence at all.

**The 422 `ORGANIZATION_TREE_INVALID` depth response now carries `details.maxDepth`** beside its
`code`, a number. It carried the token alone before, while the English message named the bound —
so a translated sentence had no way to say how deep is too deep. This is additive; the member is
`maxDepth` and never a second `code`, which is the refusal token.

**`cycleRefusal()`, `maxDepthRefusal(maxDepth?)` and `hasChildrenRefusal()` are new exports** of
`@endora-commerce/mod-organizations/backend`'s `services/organization-tree-service.js`. They are the
refusals the tree rules and the admin delete route already threw, extracted as pure functions for
the reason `@endora-commerce/mod-admin-roles`' `roleInUseRefusal` was: only a test that renders a
real refusal against the bundle can see that the token, the key and the placeholder agree.
