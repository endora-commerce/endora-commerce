# Contract: Cross-module ports touched

Published with `ctx.di.providePort(...)`, consumed with `lazyPort<T>(ctx, '<name>')`. Types live in
`packages/contracts` (`specs/conventions/module-composition.md`).

| Port / registry | Owner | Change | Consumers in this feature |
| --- | --- | --- | --- |
| `adminUserReadPort` (`AdminUserReadPort`, `contracts/src/admin-users.ts`) | `admin_users` | `AdminUserRecord` gains `avatarAssetId`, `bio`. New `findByAvatarAssetIds(ids)`. | `blog` (author candidates, author enrichment), `assets_library` (avatar references) |
| `assetReferenceRegistry` | `assets_library` | New descriptor kind `admin_user_avatar`, registered by `assets_library` itself (research R9). | — |
| `assetsLibraryPort` | `assets_library` | none | `admin_users` (avatar existence check; `nonBindingDependencies` because `assets_library` depends on `admin_users`), `blog` (avatar URL, existing resolver) |
| `cmsPageReadPort` (or the CMS port the blog already resolves) | `cms` | New `firstSegmentsInChannel(salesChannelId): Promise<string[]>`. | `blog` prefix validator |
| `cmsReservedSegmentRegistry` | `cms` | **New** registry (routing-and-settings §5). | `blog` (contributor) |
| `salesChannelResolutionPort` | `sales_channels` | none | `blog` (`ChannelUrlFacts` for `blogPath`, language codes for the validator) |
| `SettingWriteValidatorRegistryPort` | `settings` | none | `blog` (prefix validator) |

## Manifest edges

- **`blog`:**
  - Adds `admin_users` to `dependencies`. `admin_users` is non-deactivatable, so this cannot switch
    the blog off.
  - Already lists `cms`, `assets_library`, `sales_channels` and `settings`.
  - `seo` is read through `effectiveState.isPresent('seo')` only, as the catalog does. No dependency
    is added.
- **`admin_users`:** the avatar check resolves `assetsLibraryPort` lazily at request time. The edge
  to `assets_library` is declared in `nonBindingDependencies` (kind per
  `module-composition.md` §36-41) so that the graph stays acyclic. The avatar field answers
  `MODULE_DISABLED` while `assets_library` is off.
- **`assets_library`:** unchanged; it already depends on `admin_users`.
- **`cms`:** gains nothing. It consults its own registry and never names the blog.
