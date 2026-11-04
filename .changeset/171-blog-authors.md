---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-blog': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/mod-assets-library': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/admin-shell': minor
---

Blog post authors and administrator author profiles (feature 171, US6–US7).

An administrator keeps an avatar (a library asset) and an *about me* text per language on their
profile page: `PATCH /api/v1/admin/me` and `PATCH /api/v1/admin/admin-users/:id` take
`avatarAssetId` and `bio`; an avatar that is no live asset is refused with
`422 ADMIN_USER_AVATAR_NOT_FOUND`. The library counts an avatar as a use of the asset (reference kind
`admin_user_avatar`). `admin_users` declares `assets_library` as a non-binding dependency.

A blog post names one author, an administrator (`authorAdminUserId` on create and patch;
`422 BLOG_AUTHOR_NOT_FOUND` for anyone but an active administrator). Editors with `blog.write` pick
one from `GET /api/v1/admin/blog/author-candidates` (names and avatars only). The storefront shows the
author's name, avatar and biography on the post page, the name on cards and a `Person` in the post's
JSON-LD; an inactive author is still shown, a deleted one is not. `blog` now depends on `admin_users`.

`@endora-commerce/contracts`: `AdminUserRecord.avatarAssetId` and `.bio`, and
`AdminUserReadPort.findByAvatarAssetIds` — **an implementer of the port must add it**;
`adminUserSchema.avatarAssetId`/`.bio`; `ADMIN_USER_BIO_MAX_LENGTH`; `blogAuthorSchema`,
`blogAuthorCardSchema`, `blogAuthorCandidateSchema`, `blogPostAuthorAdminSchema`; `authorId` and
`author` on post cards and the resolved post; `assetReferenceKindSchema` gains `admin_user_avatar`.
`@endora-commerce/admin-kit`: `AdminMe.adminUser.avatarAssetId` and `.bio`.
