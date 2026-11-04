# Contract: Admin API changes

## Blog (`packages/modules/blog/src/backend/routes.admin.ts`)

### Post create / patch (changed) — US7, US3

`createBlogPostRequestSchema` / `patchBlogPostRequestSchema` gain:

```ts
authorAdminUserId: uuidSchema.nullable().optional()
```

- The ID must name an active, non-deleted administrator → else 422 `BLOG_AUTHOR_NOT_FOUND`.
- Keeping an author who has since become inactive is allowed. Only a *new* assignment must be
  active.
- The admin post read returns `author: { id, name, avatarUrl, state: 'active' | 'inactive' | 'deleted' } | null`.

**Publish guard (FR-022):** a transition to `published`, or a patch of a published post, is refused
with 422 `BLOG_LANGUAGE_INCOMPLETE` unless every assigned language has all of:
- a non-empty name;
- an effective key;
- non-empty content.

Drafts are not checked. For categories, the guard requires a name per assigned language on every
save.

### URL keys (new) — US4

| Method | Path | Gate | Command |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/blog/posts/:id/url-keys` | `blog.read` | — |
| PUT | `/api/v1/admin/blog/posts/:id/url-keys` | `blog.write` | `blog.url_keys.update` |
| DELETE | `/api/v1/admin/blog/posts/:id/url-redirects/:redirectId` | `blog.write` | `blog.url_redirect.delete` |
| GET / PUT / DELETE | same under `/categories/:id/` | same | same |

```ts
blogUrlKeysReadSchema = z.object({
  slug: blogSlugSchema,                                   // the base key
  keys: z.array(z.object({ languageCode: z.string(), key: blogSlugSchema })),
  effective: z.array(z.object({                           // per (channel, language) the entity is in
    salesChannelId: uuidSchema, languageCode: z.string(), key: blogSlugSchema, path: z.string(),
  })),
  redirects: z.array(z.object({ id: uuidSchema, languageCode: z.string(), key: blogSlugSchema })).optional(), // omitted while seo is absent
});
putBlogUrlKeysRequestSchema = z.object({
  keys: z.array(z.object({ languageCode: z.string(), key: blogSlugSchema.nullable() })), // null removes the language key
  confirmTakeover: z.array(z.object({ languageCode: z.string(), key: blogSlugSchema })).optional(),
  expectedVersion: z.number().int(),
});
```

The Command records `before` and `after` key sets, so its `before` restores the previous keys (as the
catalog's `product.url_keys.update` does). On success, every blog cache entry is invalidated.

### Author candidates (new) — US7

`GET /api/v1/admin/blog/author-candidates?q=` — gate `blog.write`.

```ts
{ data: Array<{ id: string; name: string; avatarUrl: string | null }> }  // active, non-deleted; sorted by name; q filters by name
```

The response never includes the e-mail address, role or status (SC-006).

### Prefixes (new) — US1, US5

| Method | Path | Gate | Command |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/blog/addresses?salesChannelId=` | `blog.read` | — |
| DELETE | `/api/v1/admin/blog/addresses/:id` (former rows only) | `blog.write` | `blog.url_prefix.forget` |

The prefixes themselves are written through the settings module's existing endpoints. The blog's
registered validator refuses invalid values (see `routing-and-settings.md`).

## Admin users (`packages/modules/admin_users/src/backend/routes.admin.ts`) — US6

`updateAdminUserSelfRequestSchema` (`PATCH /api/v1/admin/me`) and `updateAdminUserRequestSchema`
(`PATCH /api/v1/admin/admin-users/:id`, gate `admin_users:manage`) gain:

```ts
avatarAssetId: uuidSchema.nullable().optional(),
bio: z.record(z.string().min(2), z.string().max(2000)).nullable().optional(),
```

- **Response:** `adminUserSchema` gains `avatarAssetId` and `bio`. `GET /api/v1/admin/me` also
  returns `avatarUrl` for the shell header.
- **Avatar existence:** an unknown asset ID → 422 `ADMIN_USER_AVATAR_NOT_FOUND`, checked through
  `assetsLibraryPort` (resolved lazily).
- **When `assets_library` is off:** the avatar field is refused with `MODULE_DISABLED`; the bio field
  is unaffected.
- **Audit:** the existing `admin_user.update` audit entry carries the new fields in `before` and
  `after`.
