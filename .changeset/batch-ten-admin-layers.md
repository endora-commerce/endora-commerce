---
'@endora-commerce/mod-credentials': minor
'@endora-commerce/mod-dictionaries': minor
'@endora-commerce/mod-settings': minor
'@endora-commerce/mod-pwa': minor
'@endora-commerce/mod-i18n': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/contracts': minor
---

`dictionaries`, `settings` and `credentials` ship their admin surfaces, and a module can
publish a React component to another module for the first time.

**New `./admin` subpath on four packages.** `@endora-commerce/mod-dictionaries`,
`@endora-commerce/mod-settings` and `@endora-commerce/mod-credentials` each export
`contributions` — an `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`,
and nothing else. `@endora-commerce/mod-pwa` already exported one and it grows a `routes`
entry. Nine routes and ten nav entries in total, all at the paths and codes the
hand-written host registrations carried:

- `mod-dictionaries` — `/dictionary`, `/dictionaries/audit` and `/admin/dictionaries/audit`,
  all `dictionary.write`; sidebar rows for `/dictionary` and `/admin/dictionaries/audit`.
- `mod-settings` — `/settings` and `/settings/groups` on `settings:read`, `/settings/cache`
  on `settings:write`; a sidebar row for each.
- `mod-credentials` — `/credentials` on `credentials:read` and `/credentials/new` on
  `credentials:write`; one sidebar row.
- `mod-pwa` — `/settings/pwa` on `pwa:read`, beside the sidebar row it has declared since
  the previous wave. `PwaPage`, `PushAudienceRuleBuilder` and the `pwa` admin API client
  moved into this package from `mod-settings`' directory, where they had been since before
  either was a package.

Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

**New `./admin-ui` subpath on `@endora-commerce/mod-credentials`, and it is a new kind of
subpath.** It exports `ConfigurationPreviewModal` and its `ConfigurationPreviewModalProps` —
a read-only view of one credential configuration with every secret masked, taking
`{ open, configuration, onClose }`. This is the first package in the repository to publish a
React component to another package rather than to the admin application, and three things
about it are contract rather than convenience:

- **It is not the kit.** A component whose rendering is generic over its data belongs in
  `@endora-commerce/admin-kit`; this one calls `useTranslation('credentials')`, so every
  string it shows is the owner's vocabulary and the kit refuses it.
- **A consumer gates presence itself.** `credentials` carries an operator activation
  control, and a statically imported component is filtered by nothing — so the consumer
  wraps the render in `useSurfaceVisibility()({ module: 'credentials' })`. With the module
  switched off the caller must render nothing rather than a modal over an API that answers
  503.
- **`@endora-commerce/mod-credentials` becomes a peer dependency of
  `@endora-commerce/mod-settings`.** The reach survives into emitted JavaScript, so a
  consumer that bundles `mod-settings`' admin layer has to resolve the owner.

**`@endora-commerce/admin-kit`:** `toAbsoluteAssetUrl` now trims its argument and returns a
protocol-relative URL (`//cdn.example.com/x.png`) unchanged. It previously prefixed such a
URL with the API origin, producing `https://api.example.com//cdn.example.com/x.png`, which
loads nothing. Existing callers passing an absolute, `data:`, `blob:` or host-relative URL
are unaffected. `resolveIcon` answers for two more names, `Languages` and `Eraser`.

**`@endora-commerce/contracts`:** `KnownIconNameSchema` gains `'Languages'` and `'Eraser'`.
Additive — no previously valid icon name is rejected.

**`@endora-commerce/mod-i18n`:** ten `appShell.*` keys are **removed** from the shared
bundle — `appShell.nav.{cache,credentials,dictionary,dictionaryAudit,settingGroups,settings}`
and `appShell.palette.sub.{credentials,dictionary,dictionaryAudit,platformConfiguration}`.
Their replacements are `nav.*.label` keys in the three modules' own bundles, resolved in each
module's own namespace. **A consumer rendering one of those ten keys by hand will render the
raw key**; there is no compatibility alias, because a key with one consumer in two bundles is
the duplication this feature removes.

**Both shipped languages, everywhere.** Every new key — the six `nav.*.label`s,
`mod-settings`' `editor.credentialRef.preview` and `mod-dictionaries`' four
`actions.openDictionary*` strings — ships in `en` and `pl`.

**`mod-dictionaries` declares two command-palette actions**, `open-dictionary` and
`open-dictionary-audit`, both on `dictionary.write`. They replace hand-written rows in the
admin's own palette table, so what an operator sees is unchanged; what changes is that the
server now filters them against the effective enabled-set, which the hand-written rows were
never asked about.

**Build.** `./admin` resolves at `dist/admin/index.js` and `./admin-ui` at
`dist/admin-ui/index.js`, both emitted by each package's `tsconfig.ui.json`. A checkout that
has not run `pnpm run build:packages` cannot resolve either. All four packages' `build` and
`typecheck` scripts now run two `tsc` invocations, and `@endora-commerce/admin-kit`, `react`,
`react-router-dom` and `lucide-react` become peer dependencies where a screen names them.
