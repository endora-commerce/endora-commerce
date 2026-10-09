---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
'@endora-commerce/admin-shell': minor
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-i18n': patch
---

The Admin UI says which Endora Commerce release it is talking to, and the health payload stops
saying `0.0.0`.

**A version badge in the admin header.** Under the wordmark in the sidebar, `AppShell` renders
the release the API runs — `v0.104.0` — in the kit's `Badge`. It is read from a new endpoint,
`GET /api/v1/admin/platform-info`, which any signed-in admin may call and which answers
`{ "version": string | null }` (`PlatformInfoSchema` / `PlatformInfo`, new exports of
`@endora-commerce/contracts`). With the sidebar collapsed the release moves into the logo's
tooltip. While the number is loading, when the read fails — an API older than this release
answers 404 — or when the platform cannot tell, the badge is not rendered at all; there is no
placeholder. An instance needs no change: upgrade the packages and the badge appears.

**`GET /api/v1/_health` reports the real release.** Its `version` was
`process.env.npm_package_version ?? '0.0.0'`: the *host application's* manifest version, which is
`0.0.0` in every scaffolded instance, and a variable no package manager sets when a container
starts the server with `node dist/index.js`. Every deployment therefore reported `0.0.0`. It is
now the version of the `@endora-commerce/platform` package the process loaded, and `unknown` if
that cannot be read. If you compared this field against `0.0.0`, or set `npm_package_version` to
steer it, neither works any more.

`npm_package_version` is no longer a declared platform environment input
(`PLATFORM_ENVIRONMENT_INPUTS`), since nothing reads it.

One key joins the `core` bundle in English and Polish — `appShell.brand.versionLabel`, the
sentence a screen reader and the tooltip are given — and `@endora-commerce/admin-kit`'s
`theme.css` gains `.b2b-sidebar__brand-row`, `.b2b-sidebar__brand-row--versioned` and
`.b2b-sidebar__brand-version`; the sidebar header is 14px taller while a release is shown. A
theme override that styles `.b2b-sidebar__brand`'s bottom border should move it to
`.b2b-sidebar__brand-row`, which owns the divider now.
