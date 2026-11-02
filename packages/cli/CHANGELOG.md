# @endora-commerce/cli

## 0.109.0

### Minor Changes

- 8082616: A storefront that is alive but no longer answering is now restarted (issue #152). `endora new storefront` writes a `Dockerfile` whose command is a supervising parent, `scripts/supervise.mjs` (part of the scaffolded tree): `CMD ["node", "storefront/scripts/supervise.mjs", "storefront/server.js"]` replaces `CMD ["node", "storefront/server.js"]`. The supervisor runs the standalone server as its child, forwards `SIGTERM`/`SIGINT`/`SIGHUP` and the child's exit code, probes `http://127.0.0.1:$PORT/robots.txt`, and after three consecutive unanswered probes sends `SIGTERM`, then `SIGKILL`, and exits `1` so the restart policy starts a fresh container. Any HTTP status counts as an answer. It is tuned or switched off with the optional `STOREFRONT_SUPERVISOR_PROBE`, `_PROBE_URL`, `_INTERVAL_SECONDS`, `_TIMEOUT_SECONDS`, `_FAILURES`, `_START_GRACE_SECONDS` and `_KILL_GRACE_SECONDS` variables; an unreadable value stops the container at start. The `storefront` service in the instance's compose examples (`deploy/compose.prod.yml` and `deploy/three-host/compose.storefront.yml`) now sets `init: true`. An existing storefront picks this up by copying `scripts/supervise.mjs` and the Dockerfile's last stage; nothing else changes.
- 0d6983a: `@endora-commerce/cli/lib/sql-tables.js` can read DDL that targets an existing table (issue #108). `sqlTableAccesses(source, file, options?)` takes a new optional third argument, `SqlTableAccessOptions`: with `{ ddl: true }` it also reports the table named by `create [unique] index … on`, `alter table`, `drop table`, `comment on table` / `comment on column`, `create trigger … on` and `drop trigger … on`. Quoted and unquoted names, schema-qualified names, `if [not] exists`, `only` and `concurrently` are all read. Each of these is a `write` access with the new `syntax: 'ddl'`. A table that the same source creates with `create table` is not reported. `drop index` names an index, not a table, so it resolves through `indexTables` (index name to table); build that map with the new `declaredIndexes(source, file)`. Calls without the option behave exactly as before. `SqlAccessSyntax` now includes `'ddl'`, so a `switch` over it that checks it covers every case needs one more branch.

### Patch Changes

- 5d192d3: A storefront added after an `endora install --no-storefront` run is no longer a silent mismatch of `REVALIDATE_SECRET` (#112).

  - `endora install --no-storefront`: the closing text says whether `REVALIDATE_SECRET` in the instance's `.env` holds a value (a plain run generates none, so it is empty), what to set before a storefront is added, and prints the command that adds it — `pnpm exec endora install <dir>-storefront --only storefront --api-url … --storefront-url … --revalidate-secret <the same value>`. The refusal for a storefront that cannot be written from here, and the wizard's parts question, point at the same command instead of `endora new storefront <dir>`.
  - `StorefrontRevalidator`: a warning identical to one logged in the last minute — same storefront, same status, or a transport failure again — is held and counted, and the next one logged carries `suppressed`, the number held. A 2xx answer clears the record for that storefront. A revalidator constructed without `logger` now reports through the platform logger instead of discarding the warning, so a refusal during a module activation or from the settings cache screen is logged too. The secret is never logged.

- bbf7182: `endora new module` no longer tells you to declare the new package in `backend/package.json` by hand: the platform's manifest generator now writes that dependency itself, beside the module's own `package.json`, `LICENSE` and `README.md`. The next steps also say that the package must be built before the generator or its check runs again.
- f261ed3: The sales channel's `isPublic` flag is retired in favour of the pricing display-mode chain
  (issue #492; closes #467). The flag was documented as anonymous-price visibility, but every read of
  it withheld prices from **everyone** on the channel, signed-in buyers included, beside a chain that
  already says "prices after sign-in" per channel: `pricing.unauthenticated_display_mode = none`.

  **Behaviour change.** Signed-in buyers on a channel that had `isPublic = false` now see prices
  according to the display-mode chain (their organization's override, else the channel's
  `pricing.default_display_mode`), where they used to see none — on the catalogue listing, the product
  page, product links, search, comparisons, and the price sort and range, which are no longer refused
  to them. Anonymous visitors on such a channel still see no prices: the migration below carries that
  half of the flag over. A channel that had `isPublic = false` **and** its own value for
  `pricing.unauthenticated_display_mode` keeps that value, so its anonymous visitors now see prices if
  that value is a priced mode. A new channel, the boot-time default channel included, no longer starts
  with prices hidden from everyone; it follows the chain like any other.

  The display-mode chain itself is unchanged (owner ruling of 2026-10-28): a product or category
  override takes precedence over the channel's `pricing.unauthenticated_display_mode`, also for
  anonymous visitors, so a product overridden to `gross_only` shows its price to guests on a channel
  whose guest mode is `none`. An organization override still applies to signed-in buyers only.

  - **`@endora-commerce/platform`.** New migration `Migration20261028T173317CoreSalesChannelsRetireIsPublic`
    (core): every channel with `is_public = false` and no value of its own for
    `pricing.unauthenticated_display_mode` gets `"none"` as its per-channel value, then
    `sales_channels.is_public` is dropped. It refuses — rather than migrating into showing prices — a
    database that has a non-public channel but no registered `pricing.unauthenticated_display_mode`
    setting; start the platform once on the previous release, so the settings reconciler registers
    it, and migrate again. Because the column is dropped, stop processes running the previous release
    before migrating. `SalesChannel.isPublic` and `CachedChannel.isPublic` are removed;
    `SALES_CHANNELS_CACHE_KEY_PREFIX` moves from `sales-channels:v3:` to `sales-channels:v4:`, so no
    process reads an entry cached in the other shape. The default-channel reconciler no longer sets
    the flag.
  - **`@endora-commerce/contracts`.** `ResolvedSearchChannel.isPublic` is removed — drop it from the
    context you hand `SearchQueryPort`. No public HTTP shape carried the flag, so no response changes
    shape. The `SALES_CHANNEL_AUDIT_ACTIONS` documentation now says who writes each row: the identity
    Commands (with `stateBefore` / `stateAfter` snapshots) since #484.
  - **`@endora-commerce/mod-catalog`.** `CatalogResolvedChannel.isPublic` and the `isPublic` field of
    `ProductLinkService`'s storefront context are removed. The catalogue no longer skips pricing on
    a channel: prices follow the viewer's display mode (a viewer whose mode is `none` gets the
    withheld answer, `resolvedPrice.displayMode: 'none'`, where the channel used to answer
    `resolvedPrice: null`). The price controls are refused only where the page's display mode is
    `none`; the reason "This sales channel does not publish prices…" is gone.
  - **`@endora-commerce/mod-search`.** The service's `ResolvedSearchChannel.isPublic` is removed, and
    hits are always resolved for the viewer.
  - **`@endora-commerce/mod-comparisons`.** A comparison is priced for the viewer on every channel.
  - **`@endora-commerce/mod-sales-channels`.** The channel form's _Open to anonymous visitors_ hint
    gains a second line pointing to the guest display mode, with a link to _Pricing settings_
    (`identity.anonymousAccess.pricesHint`, `identity.anonymousAccess.pricesLink`, English and
    Polish). New channels are no longer written with the flag.
  - **`@endora-commerce/mod-price-lists`, `@endora-commerce/mod-i18n`.** _Pricing settings_ states,
    under the two default modes, that a channel's own value wins over them and that a product or
    category override takes precedence over both, for anonymous visitors too
    (`priceLists.displayModes.settings.precedenceHint`).
  - **`@endora-commerce/demo-composition`.** The `pl_b2b_vip` channel is created without the flag and
    a new step, _the VIP channel hides prices until sign-in_, sets its
    `pricing.unauthenticated_display_mode` to `none`; its signed-in buyers see prices. `pl_retail`
    publishes prices to everyone, as before.
  - **`@endora-commerce/mod-settings`, `@endora-commerce/cli`.** Comments only: the cache-clear
    namespace names the new key prefix, and the channel-resolution rule no longer cites the flag.

- eeed924: `endora new module` scaffolds a package whose co-located tests are type-checked: the test patterns are excluded in `tsconfig.build.json` (the emit) rather than in `tsconfig.json` (the type-check), and a package with an admin layer gets a `tsconfig.ui.build.json` that extends `tsconfig.ui.json` and adds only the test exclusion. A package scaffolded earlier keeps working; to have its `src/**/*.test.ts` files type-checked, make the same move by hand and point the `build` script's UI compile at `tsconfig.ui.build.json`.

  `contextAdmits` is also exported from `@endora-commerce/page-builder-core/context-admits`, a module that imports nothing but a type, so a Node program can use the rule without compiling the editor. The export from the package root is unchanged.

- 9cb3c8d: `check:platform-surface` gains a signal for issue #84: a name the platform's published barrels export and a workspace package the platform depends on (`@endora-commerce/contracts`) also exports must resolve to that package's own declaration, or it is a finding. `@endora-commerce/cli/rules/platform-surface.js` exports `scanSharedNames`, `checkSharedNames`, `sharedNameRefusal`, `sharedNameRemedyOf` and `dependencyDeclarations`, with the `SharedNameInput`, `SharedNameFinding`, `SharedNameFindingKind`, `SharedNameScan`, `SharedNameResult` and `LedgeredSharedName` types.

  `@endora-commerce/platform`: the lifecycle orchestrator's optional `log` dependency is typed as the contracts' `ModuleLifecycleLogger` instead of an inline copy of the same shape. Structurally identical, so no caller changes.

- b6c9cb9: The `port-catches` rule (`@endora-commerce/cli/rules/port-catches.js`) follows a holder built from
  a deps bag and attributes its gates per method (issue #576).

  `new C({ k: lazyPort(ctx, 'somePort') })` still carries nothing as a value. It is now tracked as a
  holder: a class instance, a closure or an object literal, bound to the declaration that holds it
  (destructurings included) and passed on through parameters, `this.<field>` and container
  registrations. A call on a holder reaches what **escapes** the method or closure it resolves to:

  - `read.list()` reaches what `C#list` reaches, and `read.getOrFail()`, a row read, makes no site;
  - `this.deps.audience(id)` reaches what the closure under `audience` in _this class's own_ bag
    reaches. Keys are looked up in the literal the receiver holds, not by their spelling across the
    module;
  - a presence answer the callee's own `catch` consumes (e.g. `if (!(err instanceof
ModuleDisabledError)) throw err; return record(err)`) does not reach the caller's `catch`.

  The D-88 `this` hop pulls a holder call's escaping gates into the calling method. A call the value
  tables already judge keeps exactly its gates. A pin over a name the holder tables follow now reads
  stale ("the analysis already follows the name without it"). `PORT_CATCH_UNIT=<regex>` prints what
  escapes each matching unit. A tree's site population grows: holder method reaches the analysis
  could not see before join it.

- cce12dd: The `port-catches` rule (`@endora-commerce/cli/rules/port-catches.js`) no longer treats an
  object-literal property name as a binding (issue #100).

  `{ value: lazyPort(ctx, 'somePort') }` used to make every bare identifier `value` in the module
  read as that port, so an unrelated `const value = makeEngine()` around a `try`/`catch` became a
  reported site. Deps-object keys are now a table of their own, reached only through an expression
  that reads a property, and the analysis follows the value through the shapes that do:

  - a property read, `x.key` / `x.key.method()`;
  - a call through a key whose value is an accessor closure —
    `{ sender: () => cradle().transactionalEmailSenderAccessor() }` read back as
    `const s = deps.sender(); s.send(…)`, whatever the local is called;
  - a destructuring, `const { key } = x`, `const { key: local } = x`, `({ key }: Deps) => …`;
  - a class's own method returning a carrying value, `const p = this.#port()`.

  The mirror holds too: a property read no longer answers to a local `const` of the same spelling.

  `PortCatchInput` gains an optional `pins` (`Record<'<file>:<name>', PortCatchPin>`): a host can
  declare an alias the analysis provably cannot derive, so the `catch` around it stays judged.
  `CheckResult.stalePins` lists every pin that no longer describes the tree — its file is gone, it
  names a gate no module provides, no site reaches a port through the name, or the analysis already
  follows the name without it — and a host should fail on any of them.
  `findPortCatches` and `checkPortCatches` keep their signatures. A tree's site population moves:
  sites that existed only through a shared spelling leave it, and port reaches the old spelling match
  missed (an accessor's result bound under another name, a renamed destructuring) join it.

- f8effbf: Two static-check rules under `@endora-commerce/cli/rules/*` read their subject more precisely.

  - **`subscribe-seam`** (issue #90). A worker returned from an arrow function through a conditional,
    parentheses, an `as` assertion or a non-null assertion — `() => cond ? createXWorker() : null` —
    now counts as handed to the caller, both when the arrow is a worker factory and when it returns a
    factory's call. Before, only an arrow whose body was the call itself counted, so such a factory
    was reported as dropping its worker. A call that is only the condition of the conditional still
    does not count.
  - **`port-shape`** (issue #91). Signal 2 now treats a documented `Container name:` that is in
    `PortShapeInput.platformOwnedNames` as registered, as signal 3 already did. A port doc that names
    a container the platform registers no longer gets a `container-name-unregistered` finding that no
    edit to the doc could clear.

- 453b25b: A new instance's root `package.json` declares `worker`, so the separate worker tier is started
  with `pnpm run worker` from the instance root, beside `pnpm run start` for the API, and the
  instance README's command block names it. The backend
  member has always declared `worker`, and the queue-consumer documentation tells an operator to
  split the consumers into their own process with it, but the root forwarded `start` and not
  `worker`. An instance scaffolded before this release has no root `worker`: run
  `pnpm -C backend run worker`, which is the same command, or add
  `"worker": "pnpm -C backend run worker"` to the root `scripts`.
- 46de85c: `endora new module` writes its tests beside their subjects instead of under `test/unit/`: `src/backend/manifest.test.ts` (was `test/unit/manifest.test.ts`; not `src/manifest.test.ts`, which the manifest generator refuses as a sibling of the root manifest) and, with `--admin`, `src/admin/index.test.ts` (was `test/unit/admin-contributions.test.ts`), which is type-checked by a new `tsconfig.ui.test.json` (the Node types it reads bundles with, in a program of its own) while `tsconfig.ui.json` keeps `types: []` and now excludes the tests — the layout issue #566 gave the existing modules. The emitted `vitest.config.ts` collects `src/**/*.test.ts` only. A module package has no `test/` directory, and a test there is in no type-check program — `tsconfig.json` includes `src/**/*` alone. A package scaffolded earlier is unaffected; to have its `test/unit/` files type-checked, move each under `src/` beside its subject (never as a sibling of `src/manifest.ts`), re-point its relative imports, and drop `test/**/*.test.ts` from the `include` list in its `vitest.config.ts`.
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [e64ed74]
- Updated dependencies [50338a6]
- Updated dependencies [0e33ca9]
- Updated dependencies [22604fa]
- Updated dependencies [0e33ca9]
- Updated dependencies [9ff8307]
- Updated dependencies [0e33ca9]
- Updated dependencies [07f3764]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [22604fa]
- Updated dependencies [9a38360]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [bdef54c]
- Updated dependencies [1b4f2b7]
- Updated dependencies [d560d58]
- Updated dependencies [dd6deb2]
- Updated dependencies [3f697a3]
- Updated dependencies [df0a90e]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [c73366c]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
  - @endora-commerce/contracts@0.109.0

## 0.108.0

### Patch Changes

- Updated dependencies [0bd5a2b]
- Updated dependencies [20af5d5]
- Updated dependencies [cf7a9c0]
- Updated dependencies [c8aa175]
- Updated dependencies [1284428]
- Updated dependencies [1df7a5e]
- Updated dependencies [14bcf1d]
- Updated dependencies [789f917]
- Updated dependencies [d231c48]
- Updated dependencies [e47b84b]
- Updated dependencies [9434cbc]
- Updated dependencies [87ac085]
- Updated dependencies [87f673d]
- Updated dependencies [ad341ed]
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [6f1e0ec]
- Updated dependencies [0d0a1c6]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
- Updated dependencies [eda7da8]
- Updated dependencies [359ee2b]
- Updated dependencies [8f0fd0e]
- Updated dependencies [cc98507]
- Updated dependencies [ced7b20]
- Updated dependencies [f3598cd]
- Updated dependencies [6177c81]
- Updated dependencies [2effab9]
- Updated dependencies [c8b20f6]
- Updated dependencies [29180cd]
- Updated dependencies [0f09369]
- Updated dependencies [52884d6]
- Updated dependencies [0071cd7]
- Updated dependencies [3e949eb]
- Updated dependencies [403ccc1]
- Updated dependencies [2b8bd26]
- Updated dependencies [8a2fc1b]
- Updated dependencies [ec14b96]
- Updated dependencies [a4cd906]
- Updated dependencies [5bddd11]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0

## 0.107.0

### Patch Changes

- 34a9d8f: `endora generate` — and so `pnpm run setup` and `pnpm run upgrade`, which run it — now declares
  and installs a module of this release that an installed module requires and the instance does
  not declare yet. Before, an instance upgraded to a release in which an installed module gained a
  dependency on a newly published module package kept only the packages it already declared, and
  the backend refused to start with `ReducedDeploymentError` naming the missing module.

  The step reads the `dependencies` and `acknowledgedDependencies` of every installed module's
  manifest. A module that is not installed, not carried by the platform package and not declared
  in `omittedModules` by every deployment's `apps/<deployment>/divergence.ts` is looked up in the
  CLI's release index; when a package of the release carries it, that package is added to the
  root `package.json` `dependencies` — in place, at the range the platform is declared at, with
  the operator kept (exact stays exact, `^` stays `^`) — and `pnpm install` runs before the
  artefacts are rendered. This repeats until nothing is missing. A run with nothing missing writes
  nothing and runs nothing; `--dry-run` reports what it would declare; a failed install exits 2
  with the manifest already declaring the package, so running `pnpm run setup` again continues. A
  required module that no package of the release carries is named and left alone.

  The release index the CLI writes at build (`dist/release-index.json`) now carries a `moduleId`
  for every module package; an index written by an older build still reads. `GenerateResult` gains
  `declared`, `unlisted` and `releaseIndexError`, and `GenerateOptions` gains `releaseIndexFile`,
  `run` and `echo`.

- Updated dependencies [fcf4d09]
- Updated dependencies [70bb5e5]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [4f9daef]
- Updated dependencies [5865c59]
- Updated dependencies [7d2d00f]
- Updated dependencies [e9a92b9]
- Updated dependencies [d76291d]
- Updated dependencies [1525d86]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/contracts@0.107.0

## 0.106.0

### Minor Changes

- fc23f9e: An operator can add rules to a sales channel's `robots.txt`: **Settings → SEO → Custom robots.txt instructions**.

  The text is appended to the rules the storefront generates itself — after them, separated by one
  blank line — for all sales channels or per channel. The generated rules (the closed address
  families and the `Sitemap:` line) are unchanged and cannot be edited or removed from the Settings
  screen. With no text, `robots.txt` is byte for byte what it was. Resetting the setting removes the
  text. A saved change is served within about two minutes.

  The text is served as written: every character is kept, in order. Two things about line breaks
  are made uniform — every line break is served as a line feed (`LF`), whether it was saved as `LF`,
  `CRLF` or `CR`, and the file ends with exactly one — and one byte order mark (`U+FEFF`) at the
  very start of the text is not served, because a crawler does not recognise the line it is
  attached to. Nothing in the text is validated.

  The generated lines cannot be changed, but their effect on one crawler can: a group written for a
  crawler by name replaces the `*` group for that crawler. Repeat the generated rules in such a
  group if they should still apply to it. Indexing does not depend on it — the pages those rules
  close declare `noindex` themselves.

  **`robots.txt` does not take pages out of search results.** It controls what a crawler may fetch.
  To keep a storefront out of search use _Default robots_ = `NOINDEX`, and do not add `Disallow: /`
  on top of it: a crawler that may not fetch a page never reads its `noindex`. The setting's
  description says so, in English and in Polish.

  A text may be at most **64 KiB** (65 536 bytes of UTF-8). A larger one is refused when saved, with
  `400` `SEO_CRAWLER_TEXT_TOO_LARGE` and a message naming the limit, and the stored text is kept.

  **`/robots.txt` on the reference storefront is no longer a build-time file.** It is rendered per
  request, for the request's sales channel:

  - `200` with the generated rules and the channel's text; `Content-Type: text/plain; charset=utf-8`,
    `Cache-Control: public, max-age=60`, `Vary: X-Sales-Channel`, `X-Endora-Crawler-Files: 1`. Before,
    the file was prerendered and sent with `Cache-Control: public, max-age=0, must-revalidate` and
    `Content-Type: text/plain`;
  - the generated rules alone while the `seo` module is switched off, and against a backend that
    does not have this feature;
  - **`503` with `Retry-After: 120`** when the channel's text cannot be read and the storefront
    process has never read it — rather than a file that silently omits the operator's rules. A
    process that has read the text once goes on serving that version for as long as the backend
    cannot be reached. A storefront started while its backend is down therefore answers
    `robots.txt` with `503` until the backend is back; pages are unaffected;
  - `GET /robots.txt?part=system` answers the generated rules alone, without the route asking the
    backend, and is sent with `Cache-Control: no-store`.

  **If a reverse proxy or a CDN stands in front of a storefront that serves more than one sales
  channel**, check two things, because the file now differs per channel and the channel is named by
  the `X-Sales-Channel` request header: the proxy must set that header itself, per host, and not
  pass through a value a visitor sent; and a shared cache that ignores `Vary` on such a header must
  include it in its cache key or not cache `/robots.txt`. In nginx that is one line in the
  storefront's `location` block — `proxy_set_header X-Sales-Channel "<this host's channel code>";`
  for a multi-channel deployment, or `proxy_set_header X-Sales-Channel "";` to drop the header on a
  single-channel one, which is otherwise unaffected. The `nginx.example.conf` an instance was
  scaffolded with does not carry the line; this repository's `deploy/nginx.example.conf` now shows
  both, commented.

  The origin in the `Sitemap:` line is still `NEXT_PUBLIC_SITE_URL` as inlined at build time.

  What is new, by package:

  - `@endora-commerce/mod-seo` declares the multi-line setting `seo.robots_txt_custom` (default
    empty) with its name and description in `en` and `pl`; serves the public, channel-resolved
    `GET /api/v1/storefront/seo/crawler-files`
    (`{ "data": { "index", "follow", "robotsTxtCustom", "llmsTxtAdditional", "shop": { "name" } } }`,
    `Cache-Control: no-store`, `503` `MODULE_DISABLED` while the module is off, and `500` — never
    an empty text — when a stored value cannot be served); and declares the error code
    `SEO_CRAWLER_TEXT_TOO_LARGE`. `llmsTxtAdditional` is always `""` in this release.
  - `@endora-commerce/contracts` exports `storefrontCrawlerFilesSchema`,
    `storefrontCrawlerFilesResponseSchema`, the types `StorefrontCrawlerFiles` and
    `StorefrontCrawlerFilesResponse`, `composeCrawlerFile(base, extra)` (the join described above),
    `CRAWLER_TEXT_MAX_BYTES` and `ERROR_CODES.SEO_CRAWLER_TEXT_TOO_LARGE`. The schemas drop members
    they do not know.
  - `@endora-commerce/contracts` and `@endora-commerce/mod-settings`: `SettingWriteValidationInput`
    gains **`proposedValue`** — the value a settings write proposes, beside the per-channel
    projection it already carried. An all-channels write reaches no channel that has a value of its
    own, so on an instance where every channel has one the proposed value was in no channel's
    projection, and a validator whose rule is about the value itself could not see it. A module that
    contributes a `SettingWriteValidator` needs no change; code that _constructs_ a
    `SettingWriteValidationInput` (a test calling a validator directly) must now supply the member.
  - `@endora-commerce/cli`: the storefront that `endora new storefront` writes serves `robots.txt`
    as described above.

  **An existing storefront is not changed by upgrading, and until it is updated it ignores the
  setting**: its `robots.txt` stays the file it was built with, and the Settings screen shows a text
  nothing serves. To take the feature, apply these changes from the reference storefront to the
  storefront project, keeping any edits of your own:

  - **delete** `app/robots.ts`. It must go, and nothing will tell you if it has not: with both it
    and `app/robots.txt/route.ts` present, Next builds without a warning, goes on serving the old
    build-time file and never reaches the new route. The build's route list shows which one won —
    `○ /robots.txt` is the old file, `ƒ /robots.txt` is the new route;
  - **add** `app/robots.txt/route.ts` — the route;
  - **add** `lib/seo/robots-txt.ts` — what the route answers, and when it answers `503`;
  - **add** `lib/seo/robots-system-rules.ts` — the generated rules, moved out of `app/robots.ts`
    unchanged. **If you edited the `disallow` list in your `app/robots.ts`, carry your edits into
    `ROBOTS_SYSTEM_RULES` here**;
  - **replace** `lib/seo/crawler-policy.ts` with the new version. It now reads the crawler files as
    well as the default robots policy, and gives up a backend read that a frozen process left
    hanging instead of waiting on it for ever. If the project does not have this file yet, it has
    not taken the _Default robots_ feature either — add the file, and see that release's notes for
    `middleware.ts` and `app/layout.tsx`;
  - **edit** `app/reserved-segments.ts`: add `'robots.txt'` to `RESERVED_TOP_LEVEL_SEGMENTS`, and add
    the same entry to the deployment's `cms.reserved_slug_segments` setting if you maintain one;
  - in `test/seo/route-declarations.test.ts`, if you copied it, replace the import of
    `'../../app/robots'` with `ROBOTS_SYSTEM_RULES` and `robotsSitemapUrl` from
    `'../../lib/seo/robots-system-rules'`, as the reference's version does.

  `lib/seo/robots-txt.ts` imports `composeCrawlerFile` from `@endora-commerce/contracts/seo`, so
  **the storefront project needs `@endora-commerce/contracts` at this release or later** — unlike
  the _Default robots_ files, which needed no upgrade. `middleware.ts` and `app/layout.tsx` do not
  change in this release. Then rebuild the storefront;
  `curl -sI https://<your shop>/robots.txt | grep -i x-endora-crawler-files` shows the header once
  the new route is serving.

  The reference storefront's tests for these files (`test/seo/robots-system-rules.test.ts` with its
  fixture `test/seo/__fixtures__/robots-before.txt`, `test/seo/robots-txt-route.test.ts` and the
  additions to `test/seo/crawler-policy.test.ts`) are optional to copy. The fixture is the
  reference's own generated rules with `http://localhost:3000` as the origin; a project that edited
  its list edits the fixture to match.

- 4be4642: The storefront serves an `llms.txt` per sales channel, and an operator can add to it: **Settings → SEO → Additional llms.txt content**.

  **For an operator.** `/llms.txt` is a plain-text file that tells AI assistants what a shop is and
  where its public pages are. The storefront now serves one for each sales channel: a part it
  generates — the shop's name, links to the home page, the catalog, search, the blog and the contact
  page, and the sitemap — followed by the text you save in the new setting. The setting is empty by
  default, takes a value for all sales channels and a value per channel like any other, and holds at
  most 64 KiB, the limit of the `robots.txt` instructions. A saved change is served within about two
  minutes. The addresses in the generated part use the storefront's one public origin
  (`NEXT_PUBLIC_SITE_URL`, fixed when the storefront is built), as the sitemap does: a storefront
  that serves several sales channels names that origin in every channel's file, with each
  channel's own shop name.

  Two things to know before relying on it:

  - **A sales channel whose _Default robots_ is `NOINDEX` has no `llms.txt`.** The storefront answers
    `/llms.txt` with "not found" there, whatever the setting holds: a shop that asks search engines
    to stay away does not invite AI assistants in. The text is kept and is served again when the
    channel allows indexing. `robots.txt` is unaffected — it stays open on such a channel, as before.
  - **Switching the `seo` module off withdraws the file**, with the _Default robots_ policy and the
    custom `robots.txt` instructions. The module's description and its activation setting now say so.

  Below the field there is a preview, the same as the one beside _Custom robots.txt instructions_:
  one block that is the file, your lines marked inside it, under a heading that reads _llms.txt as
  served now_ or _llms.txt after saving_. On a `NOINDEX` channel it says _llms.txt is not served_,
  with the reason, in place of the block. The messages for a storefront that cannot be reached, has
  no address configured or did not confirm that it serves the file are the ones the `robots.txt`
  preview shows, and the request the backend makes for it is bound the same way — one `GET
<origin>/llms.txt?part=base`, no redirect followed, three seconds, 512 KiB, `text/plain` only,
  nothing of the administrator's request in it. As before, private and loopback addresses are not
  refused, and this preview tells a holder of `settings:read` slightly more about a configured
  address than the `robots.txt` one does: a `404` without the storefront's header is reported as
  "did not confirm that it serves llms.txt" rather than as "could not be reached", so an address
  where some HTTP server answers can be told from one where nothing does.

  No migration, no new environment variable, no new permission.

  The `seo` bundles also gain the name of the settings group and the name and description of the
  _SEO enabled_ setting, in English and Polish (`settingGroups.seo.name`,
  `settingLabels.seo.enabled.*`).

  **`robots.txt` no longer depends on _Default robots_ being readable.** A _Default robots_ value
  that is not one of the four choices — which takes a row written around the settings API — made
  `GET /api/v1/storefront/seo/crawler-files` answer `500`, so a storefront that had just started
  answered that channel's `robots.txt` with `503`, although the file has never depended on that
  setting. The endpoint now answers, and names what it could not read (below). Such a channel keeps
  its `robots.txt`; its `llms.txt`, which does depend on the setting, answers `503` until the value
  is repaired by saving _Default robots_ again. A storefront that has not been updated benefits
  too: its `robots.txt` is served as well.

  **In `@endora-commerce/contracts`.**

  - `storefrontCrawlerFilesSchema` gains an optional member, **`unreadable`**: the names of the
    members the backend could not read from what is stored — `CRAWLER_FILES_UNREADABLE_POLICY`
    (`'policy'`: `index` and `follow` are then both `false` and mean "not known") and
    `CRAWLER_FILES_UNREADABLE_LLMS_TXT` (`'llmsTxtAdditional'`: that member is then `''` and means
    "not known"). It is absent when everything was read. **Additive**: a consumer that does not read
    it is unaffected unless it reads `index`, `follow` or `llmsTxtAdditional` from this endpoint, in
    which case it should treat a named member as unknown rather than as its value. Unreadable
    `robots.txt` instructions still fail the whole answer with `500`.
  - `llmsTxtAdditional` now carries the channel's saved text; it was always `''`.
  - `GET /api/v1/admin/seo/crawler-files/preview?file=llms` now answers; it answered `400`. The
    `not-served` state means the storefront answered `404` **with** the `X-Endora-Crawler-Files`
    header — no file for that channel; a `404` without the header is `storefront-outdated`, with no
    `base`.

  **For a custom storefront.** To be previewed, `/llms.txt?part=base` answers the generated part
  alone, as `text/plain`, with `X-Endora-Crawler-Files: 1`; a channel with no file answers `404` with
  the same header. Answer `503` rather than a file while `unreadable` names `policy` or
  `llmsTxtAdditional`.

  **In `@endora-commerce/cli`.** The storefront that `endora new storefront` writes serves
  `/llms.txt` as described above.

  **An existing storefront is not changed by upgrading, and until it is updated it has no
  `llms.txt`**: the Settings screen shows the text, the preview says that the storefront did not
  confirm that it serves the file, and nothing serves it. To take the feature, apply these changes
  from the reference storefront to the storefront project, keeping any edits of your own. They
  assume the project has already taken the _Default robots_ and _Custom robots.txt instructions_
  changes that the other entries of this release describe — `lib/seo/crawler-policy.ts`, `lib/seo/robots-txt.ts`,
  `lib/seo/robots-system-rules.ts`, `lib/seo/robots-directive.ts` and `app/robots.txt/route.ts`
  exist, and `app/robots.ts` is deleted. If not, apply those entries first.

  - **add** `app/llms.txt/route.ts` — the route;
  - **add** `lib/seo/llms-txt.ts` — what the route answers, and when it answers `404` and `503`;
  - **add** `lib/seo/llms-txt-base.ts` — the generated part. It lists `SITEMAP_STATIC_ROUTES` from
    your `app/sitemap.ts`; **if you changed that list, give each of your routes a title in
    `LLMS_TXT_PAGE_TITLES`**, and name in `LLMS_TXT_CONDITIONAL_PAGES` any of them that can answer
    "not found";
  - **add** `lib/seo/llms-txt-pages.ts` — whether a conditional page is served right now (today:
    the blog), remembered per channel by the cache `lib/seo/crawler-policy.ts` exports;
  - **add** `lib/seo/crawler-file-response.ts` — the headers and the temporary failure the two files
    share;
  - **replace** `lib/seo/robots-txt.ts` and `lib/seo/crawler-policy.ts` with the new versions. The
    first now takes its headers from `crawler-file-response.ts`; the second reads `unreadable` and exports the channel cache the page question uses;
  - **edit** `lib/seo/robots-directive.ts`: `isDocumentPath` must answer `false` for `/llms.txt`, as
    the reference's version does. **Do not skip this one**: without it the storefront still serves
    the file, but while the backend is unreachable it answers `/llms.txt` with the outage page
    instead of the last version it knew;
  - **edit** `app/reserved-segments.ts`: add `'llms.txt'` to `RESERVED_TOP_LEVEL_SEGMENTS`, and add
    the same entry to the deployment's `cms.reserved_slug_segments` setting if you maintain one;
  - **make sure there is no `public/llms.txt`.** A file there is served instead of the route — for
    every channel, with no operator text, and on a channel set to `NOINDEX` — and neither the build
    nor the server says so. `curl -sI https://<your shop>/llms.txt | grep -i x-endora-crawler-files`
    shows the header when the route is the one answering.

  `middleware.ts` and `app/layout.tsx` do not change in this release. The new files import
  `composeCrawlerFile` from `@endora-commerce/contracts/seo`, so the storefront project needs
  `@endora-commerce/contracts` at this release — as the custom `robots.txt` instructions, another
  entry of this release, already require. Then
  rebuild the storefront — the build's route list shows `ƒ /llms.txt`.

  The reference storefront's tests for these files (`test/seo/llms-txt-base.test.ts`,
  `test/seo/llms-txt-route.test.ts`, and the additions to `test/seo/crawler-policy.test.ts`,
  `test/seo/robots-txt-route.test.ts`, `test/seo/middleware-robots.test.ts` and
  `test/seo/middleware-effect.test.ts`) are optional to copy.

- be99bb5: The Settings screen previews the `robots.txt` a sales channel's storefront serves, and a module can now contribute beside a setting it declared.

  **For an operator.** Below **Settings → SEO → Custom robots.txt instructions** there is now a
  preview of the file the selected sales channel's storefront serves, as **one block that is the
  file**: the lines the storefront generates, labelled read-only, then a blank line, then your own
  lines, marked with a bar and a label. With nothing unsaved the heading reads _robots.txt as served
  now_. As you type, the block follows the field and the heading becomes _robots.txt after saving_ —
  the file the storefront will serve once you save; until then it keeps serving the previous version.
  Under **All channels** you pick the channel to preview, and the preview names the channels that
  have a value of their own and are therefore not affected. On a channel whose _Default robots_ is
  `NOINDEX` it says that `robots.txt` stays open on purpose, and warns when your text forbids every
  crawler to fetch anything. An administrator who may read settings but not change them sees it too,
  and one who may not list sales channels is shown the system default channel. Nothing the storefront
  serves changes when you preview.

  The setting's description above the field is shorter: the preview now shows what the description
  used to explain.

  The generated rules are not copied into the backend or the Admin UI: each time, the backend asks
  the channel's storefront for them. So **the storefront must be reachable from the backend at the
  address the channel is configured with** — the channel's **Storefront URL** setting, else
  `STOREFRONT_BASE_URL`. When it is not, the preview says so and shows your text on its own; saving is
  never blocked. The three messages and what to do about each:

  - _The storefront could not be reached_ — no answer within three seconds, a refused connection,
    an error, a redirect, or an answer that is not a plain-text file. Check that the storefront runs
    and that the configured address is the one it answers at itself. The server log line
    `seo: the crawler-file preview could not show the storefront’s part` carries the reason.
  - _This sales channel has no storefront address configured_ — set **Storefront URL** for the
    channel, or `STOREFRONT_BASE_URL`.
  - _This storefront did not confirm that it supports custom instructions_ — it answered without the
    `X-Endora-Crawler-Files` header. Usually the storefront was scaffolded from a release before these
    settings existed: it serves only its generated rules and ignores both the custom instructions and
    _Default robots_. A proxy that strips the header, or a storefront updated only in part, looks the
    same. A matching notice now appears on the _Default robots_ row, so a shop is not believed to be
    out of search while its storefront may be ignoring the setting. Update the storefront's files as
    the notes of the release that introduced those settings list, and check that the header arrives.

  What the backend sends is one request per preview: `GET <origin>/robots.txt?part=system`, to the
  origin of the configured address only, with the channel's code in `X-Sales-Channel`. It follows no
  redirect, waits at most three seconds, reads at most 512 KiB, accepts only `text/plain`, sends no
  cookie or credentials, and stores nothing. A path or query in the configured address is not used.
  Private and loopback addresses are **not** refused, because an instance's own storefront is
  routinely reached at one; who may point a channel at an address is whoever holds `settings:write`,
  as before.

  No migration, no new setting, no new environment variable, no new permission.

  **For a module author: `settings.setting.after`.** `AdminZoneNameSchema` has a new member, mounted
  by the Settings screen once per setting row, below the field. Contribute to it to show what a
  setting you declared amounts to — a preview, a consequence, a warning:

  ```ts
  import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

  export const contributions: AdminContributions = {
    zones: [
      zoneComponent('settings.setting.after', () => import('./zones/FooterNotePreview.js'), {
        match: { settingCode: 'your_module.footer_note' },
        requiredPermission: 'settings:read',
      }),
    ],
  };
  ```

  The component receives `SettingsSettingAfterZoneProps`: `settingCode`, `ownerModule`,
  `channelCode` (the sales channel being edited, or `null` for the all-channels value), `draftText`
  (the text in the field **now**, saved or not, for a `string` setting; `null` for every other value
  type) and `dirty`. Narrow with `match` on `settingCode` or `ownerModule` — an unmatched
  contribution's chunk is never fetched. The props go one way: a contribution cannot change the
  value or hold up the row's save, and it should say in words when what it shows is not saved yet.
  The zone is not mounted for a `secret` setting, so a contribution never receives a secret's draft.
  A contribution vanishes with its module, and a failing one does not take the row with it.

  **If you render `SettingRowEditor` yourself.** `@endora-commerce/mod-settings`' row editor now
  mounts a zone, so it must be rendered under `AdminContributionsProvider` and the session
  providers, as every host screen that mounts a zone is. The Admin UI already does; a test that
  renders the row or `SettingsPage` on its own needs the providers around it.

  **In `@endora-commerce/contracts`.** New: `adminCrawlerFilePreviewQuerySchema`,
  `adminCrawlerFilePreviewResponseSchema`, `adminCrawlerFilePreviewSchema`,
  `adminCrawlerFilePreviewStateSchema`, `adminCrawlerFileSchema`, their inferred types, and
  `CRAWLER_FILES_CAPABILITY_HEADER` (`X-Endora-Crawler-Files`) — the response header by which a
  storefront says it serves crawler files the current way. A custom storefront that implements
  `?part=system` should send it; without it the preview treats the storefront as outdated. The
  endpoint is `GET /api/v1/admin/seo/crawler-files/preview?file=robots&salesChannelCode=<code>`,
  gated by `settings:read`. `salesChannelCode` is optional and means the system default channel; the
  answer names the channel it is about. `file=llms` is declared in the schema and answers `400` until
  `llms.txt` is served.

  `@endora-commerce/mod-seo` now declares `lucide-react` as an optional peer dependency, as the other
  module packages with an admin surface do; an application that has the Admin UI already has it.

  **In `@endora-commerce/cli`: `check:channel-resolution` no longer reports a header that is sent.**
  The rule's first signal flags every `x-sales-channel` string literal, because a module must not
  read that header from a request — the resolver does. A module that makes a request of its own to
  another server and names the sales channel in it was reported as well. The key of an object literal
  under a `headers:` property — `fetch(url, { headers: { 'X-Sales-Channel': channel.code } })` — is
  now exempt, as a CORS policy's `allowedHeaders` array already was. What stays reported: an
  element access on a headers object, a `.get(...)` argument, the name held in a constant, a
  computed key, a destructuring declaration, and a destructuring _assignment_
  (`({ headers: { 'x-sales-channel': code } } = request)`, also as the variable of a `for…of` or
  `for…in`), which has the exempted shape and is refused by its position.

- ddc9382: A sales channel's storefront can be taken out of search engines with one setting: **Settings → SEO → Default robots**.

  The setting offers `INDEX, FOLLOW` (the default), `NOINDEX, FOLLOW`, `INDEX, NOFOLLOW` and
  `NOINDEX, NOFOLLOW`, for all sales channels or per channel. For a channel whose value restricts
  something, the storefront adds the directive to what it serves for that channel: an
  `X-Robots-Tag` header on pages (not-found pages and the offline page included), on
  `/sitemap.xml`, on `/_next/image` and on the files under `public/`, and one extra
  `<meta name="robots">` in the `<head>` of the pages it renders for a request. Not-found pages
  and the statically built `/offline` page carry the header without the extra element — both
  already declare `noindex, nofollow` themselves — and redirects declared in `next.config.js`
  and the files under `/_next/static` carry neither. It only adds restrictions — a page that
  declares `noindex` for itself keeps its own tag — and `robots.txt` is not changed. With the
  default nothing is added. A saved change is in force on the storefront within a minute or two.

  **Switching the `seo` module off withdraws the directive**, so a channel set to `NOINDEX` becomes
  indexable again until the module is switched back on. The stored value is kept.

  What is new, by package:

  - `@endora-commerce/mod-seo` declares the setting `seo.default_robots`, serves the public,
    channel-resolved `GET /api/v1/storefront/seo/robots-policy` (`{ "data": { "index", "follow" } }`,
    `Cache-Control: no-store`, `503` `MODULE_DISABLED` while the module is off, and `500` — never
    a permissive answer — when the stored value is not one of the four choices), and declares two
    command-palette actions: `open-seo` (`catalog:write`) and `open-search-engine-robots`, which
    opens the Settings screen for holders of `settings:read`.
  - `@endora-commerce/contracts` exports `storefrontRobotsPolicySchema`,
    `storefrontRobotsPolicyResponseSchema` and the types `StorefrontRobotsPolicy` and
    `StorefrontRobotsPolicyResponse`. The schema drops members it does not know, so a later
    release can add one without an older consumer refusing the answer.
  - `@endora-commerce/cli`: the storefront that `endora new storefront` writes reads the policy
    and applies it. Its middleware now runs for every path except `/_next/static` (it used to skip
    public files, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest` and `/_next/image`); for
    those paths it only adds the header. Measured on the reference storefront, that costs a public
    file about one millisecond. A storefront that already knows a channel's policy never waits
    more than a fraction of a second for a refresh; only the first read after a start is waited
    for, up to two seconds, once.

  **An existing storefront is not changed by upgrading, and until it is updated it ignores the
  setting.** `endora new storefront` copies the reference once and the project owns it afterwards.
  With an upgraded backend and an older storefront the Settings screen shows _Default robots_ and
  nothing acts on it — a channel set to `NOINDEX` stays indexable. To take the feature, copy these
  four files from the reference storefront into the storefront project, keeping any edits of your
  own. They import nothing from a package that an earlier storefront does not already have, so
  **no dependency has to be upgraded for them to build and run**:

  - `lib/seo/crawler-policy.ts` — new: reads the policy, caches it for a minute per channel, and
    keeps the last value it read while the backend cannot be reached;
  - `lib/seo/robots-directive.ts` — new: what the policy puts on a response;
  - `middleware.ts` — changed: the policy read, the response header, the request header for the
    layout, and the widened `config.matcher`;
  - `app/layout.tsx` — changed: renders the extra `<meta name="robots">` in both documents it
    returns. Do not move the directive into the layout's `metadata` export: a page's own `robots`
    replaces a layout's there, so it would be dropped on every page that declares one.

  Then rebuild the storefront. `curl -sI https://<your shop>/ | grep -i x-robots-tag` shows the
  header once a restricting value is saved.

  The reference storefront's tests for these files (`test/seo/crawler-policy.test.ts`,
  `robots-directive.test.ts`, `middleware-robots.test.ts`, `middleware-effect.test.ts`,
  `layout-robots.test.ts`, `layout-outage-render.test.tsx` and
  `test/conformance/robots-directive.spec.ts`) are optional to copy. One of them,
  `crawler-policy.test.ts`, compares the storefront's own check of the answer with the published
  schema and therefore needs `@endora-commerce/contracts` at this release or later in the
  storefront project; nothing else does.

  Two limits are stated in the module's documentation: files the backend serves (product images
  and other uploaded media) carry no `X-Robots-Tag`, and a storefront that starts while its backend
  is unreachable serves pages without the default directive until its first successful read.

### Patch Changes

- ca6fef6: The storefront that `endora new storefront` writes shows its "Built with ❤️ using Endora Commerce" credit as the last line of the footer.

  The credit used to sit inside the copyright row, between the company details and the legal links.
  It is now a row of its own under everything else the footer renders — the columns, the copyright
  row and whatever a module adds through the `footer.bottom` and `footer.copyright` hooks — centred,
  on one line while the width allows it, with the Endora Commerce mark beside the product name. The
  link and its UTM parameters are unchanged.

  **An existing storefront is not changed by upgrading.** `endora new storefront` copies the
  reference once and the project owns it afterwards; to take this layout, apply the same edit to
  `components/Footer.tsx` in the storefront project.

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0

## 0.105.0

### Patch Changes

- 1ba6b26: An instance can switch the account-wide administrator password limit off, by environment variable.

  The account-wide limit — twenty wrong passwords for one account from all addresses that are not a
  known device — assumes the password is a secret. On an instance that publishes an administrator
  password on purpose, a public demo, every visitor is a first-time device, so anybody could keep all
  of them out of the account with twenty wrong passwords and a few more each half hour.

  `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT=off` in the backend's environment switches off the account-wide
  count of wrong **passwords** and nothing else: the limit per address on one account, the limit per
  known device, both limits on second-factor codes and the delays are unchanged, and an attempt that
  arrives with no client address is still counted for the account. It is read once at start, it is
  not a Setting and cannot be changed from the Admin UI, and while it is off the backend logs
  `account-wide administrator attempt limit is OFF — intended for demo instances with published
credentials` on every start. Any value other than `off` leaves the limit on.

  Do not set it on an instance whose administrator passwords are not public. Without the variable
  nothing changes.

  A scaffolded instance can set it too: the compose file `endora new instance` writes forwards
  `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT` to the backend, and its `.env.example` lists it, empty.

- 964ada7: Catalogue blocks on a CMS page are part of the server-rendered HTML. `ProductGrid`,
  `ProductSlider`, `ProductCard`, `CategoryList` and `CategoryGrid` used to fetch their own data
  from an effect, so the document a crawler, a link preview or a browser without JavaScript received
  held a skeleton and no product or category at all.

  Each block now declares the data it needs, and the application rendering the page resolves it on
  the server:

  - `@endora-commerce/cms-components/utils/catalog-block-data` (new, importable from a Server
    Component) exports `collectCatalogBlockDataRequests(documents)`, `resolveCatalogBlockData(requests,
source)` and `catalogBlockDataKey(request)`. The resolver reads each distinct product, listing
    and the category tree once, in parallel with a bound of six, and leaves a failed read out so
    that only its block degrades.
  - `CatalogPreviewProvider` takes a new optional `data` prop — the resolved answers — and its
    `api` prop is now optional. With `data` present a block renders from it during the server
    render and during hydration: it does not fetch on mount and never shows its loading state. A
    request with no answer renders the block's existing empty state.
  - Without `data` nothing changes: the admin page builder still passes `api`, and a block with
    neither still fetches from an effect and shows its skeleton meanwhile.

  All of it is additive; no existing prop or export changed meaning.

  The storefront `endora new` writes does the resolving: `components/CatalogBlockData.tsx` is a
  Server Component that `CmsPageRenderer` and `Hook` mount around their Page Builder trees, and
  `lib/page-builder/catalog-block-data.ts` reads through `lib/api/catalog` with the request's
  context, so a block shows the sales channel's catalogue in the request's language and, for a
  signed-in buyer, that buyer's prices — fetched `no-store`, as the product listing's are.
  `CmsPageRenderer` now requires a `ctx` prop for that reason.

  A storefront that already exists keeps the source it was created with. Upgrading
  `@endora-commerce/cms-components` alone changes nothing there — its blocks keep fetching in the
  browser as before — until it mounts the provider with `data`: copy the two files above and wrap
  the `PageBuilderRender` call sites as the reference storefront does. Other render sites of the
  reference storefront (blog post bodies, category page content, the megamenu and the consent
  messages) are not wrapped yet and behave as before.

- 0e34c8c: The instructions for adding a module package to an instance give a command that works. The README
  `endora new` writes into an instance said "Adding a module later is `pnpm add`", and
  `endora new-module` refused a dependency nothing provides with "`pnpm add <package>`". In the root
  of an instance — a pnpm workspace root whose `dependencies` are the module list — that command
  exits 1 under pnpm 9 with `ERR_PNPM_ADDING_TO_ROOT`, and under pnpm 10 writes a range, `^<version>`,
  beside packages the scaffold pinned exactly. Both now say
  `pnpm add -w -E <package>@<version>`, with the version the release's other packages are pinned at.

  Messages only: no command, option or exit code changes. An instance that already exists keeps the
  README it was created with; the form to use there is the same, and
  `docs/docs/upgrading-an-instance.md` § _Adding a module that is new in a release_ describes it.

- bdb823b: `demo reset` withdraws a demo that has been used, in one transaction, and refuses to delete
  financial records unless it is told to.

  **What was wrong.** `demo reset` exited 1 as soon as the demo buyer had placed one order on credit
  (`credit_limit_reservations_credit_limit_fk`) or saved one address (`addresses_organization_fk`).
  The refusal came after the demo payment methods, the delivery methods and the buyer were already
  gone, so checkout was left broken. A reset that did go through left the demo organisation's
  orders, carts and quote requests naming an organisation that no longer existed.

  **A reset is now one transaction** (`@endora-commerce/platform`). The dispatcher opens it, builds
  the composition over it and hands it to every module's demo body as that body's own
  `EntityManager`. A refusal anywhere in the run — the composition's withdrawal, a module's, a
  foreign key from a table of your own — changes nothing. `demo seed` is unchanged.

  - **Breaking for a module's `demo.reset` body and for a composition's `withdraw`**: write through
    the `EntityManager` you are handed (`em.nativeDelete`, `em.execute`), not through
    `em.getConnection().execute(…)`. The bare connection carries no transaction: the statement runs
    on a second connection, cannot see what the reset has already deleted, and waits on rows the
    reset has locked. `@endora-commerce/mod-catalog`'s reset and every statement of
    `@endora-commerce/demo-composition` were moved accordingly.
  - **Breaking for a demo composition**: declare `withdrawsInsideTransaction: true` on the object
    `createDemoComposition` returns. A reset over a composition that does not is refused before it
    starts — which is what happens to `@endora-commerce/demo-composition` 0.104 under this platform;
    the two are released in lockstep and the composition's peer range is the exact platform version.
  - The transaction is `REPEATABLE READ`, so what the reset counts and what it deletes are one
    snapshot; `lock_timeout` (60 s) and `idle_in_transaction_session_timeout` (120 s) are set on it;
    and while it runs, anything in its async context that asks the pool for a second connection is
    refused immediately with "a reset body wrote outside the reset transaction". A body that brings a
    database client of its own is ended by the idle bound instead of hanging.
  - Every refusal — the composition's, a module's, the database's (an integrity constraint, a
    snapshot conflict, a lock wait) — is printed as a message saying what refused and that nothing
    has been changed, without a stack. An unanticipated failure keeps its stack and says the same.
  - `DemoRunFailedError` says "nothing was changed" for such a run instead of telling the operator
    to clear half-written rows away.

  **What using the demo left behind is withdrawn first** (`@endora-commerce/demo-composition`):
  orders with their shipments, stock allocations (the stock they held is released) and credit
  reservations, return cases, carts, quote requests, shopping lists, comparisons, addresses, API
  keys, webhooks, sessions, two-factor enrolments, newsletter and push subscriptions, analytics
  events, price-list assignments, promotion uses (the usage counters they spent are given back),
  promotions restricted to that organisation, Sales Opportunities opened for it, and the accounts
  that joined it. **These rows are deleted, not re-pointed.** Only rows of the demo organisation
  are matched — it is found by the tax id the demo gives it — so another organisation on the same
  instance loses nothing, and neither does a row with no organisation, such as a guest's cart. The
  audit trail, the e-mail delivery log and administrators' notification history are kept.

  A module that is **switched off** does not exempt its rows: they are withdrawn when the module's
  tables exist, whether or not it is active. A reset with CRM off used to stop at `organizations`;
  it now completes, and leaves only CRM's three demo tags, which a reset with CRM on removes.

  **Breaking: the reset refuses when the demo organisation holds financial records.** It exits 1
  before deleting anything and prints how many of each it found. What counts:

  - a payment whose status is `paid`, `refunded` or `partially_refunded`;
  - an invoice of kind `invoice` or `correction`, or of any kind that carries a KSeF reference
    number or an external document reference, or that has an accounting-system row;
  - any row of `invoice_ledger_deliveries`, `invoice_ledger_document_maps` or
    `invoice_ledger_client_maps`;
  - a refund, and a refund settled against the credit limit (`credit_limit_return_topups`).

  A payment still `awaiting_payment`, `deferred` or `failed`, and a pro-forma invoice or delivery
  note with no external reference, do not count: they are what an order placement opens and are
  withdrawn with the order, so a demo on which orders were placed and nothing was paid resets
  without the flag. To delete the financial records with the rest:

  ```
  pnpm run cli demo reset --force-delete-financial-records
  ```

  The flag is read from that command line only — no environment variable, no setting — and forces
  nothing else: the production guard and every foreign key apply as before. An automated job that
  resets a used demo needs the flag on its command line.

  The reset also stops before touching anything when another organisation has been filed under the
  demo one — detach or delete the sub-organisation and run it again.

  New exports of `@endora-commerce/platform/demo`: `DemoResetRefusedError` (thrown by a composition
  to decline a reset; printed as its message, without a stack) and
  `DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG`. `DemoCompositionInput` gains the optional
  `deleteFinancialRecords`.

  `organizations`' own demo withdrawal now removes the invitations sent from the demo organisation
  and the sales representatives assigned to it before removing the organisation, and reports both
  counts beside `Organization`.

  Promotion counters: a redemption made before its promotion had a global limit bumped no counter,
  and nothing records that, so it is subtracted like the others; a real promotion's counter can end
  up lower than the real uses made since, never below zero.

  `@endora-commerce/cli`: the install and `new instance` closing messages mention the refusal and
  the flag beside `demo reset`.

  The getting-started, upgrade and CRM documentation pages say what the reset now does.

- 77a76a7: The `.gitignore` that `endora new` writes into an instance ignores the build output of the
  instance's documentation site. Building the site writes `docs/build/` and `docs/.docusaurus/`, and
  neither was ignored, so an instance that had built its docs and then ran `pnpm run upgrade` saw a
  diff of well over a hundred regenerated files instead of the `package.json` per member and the
  lockfile that `docs/docs/upgrading-an-instance.md` promises.

  An instance that already exists keeps the `.gitignore` it was created with. Add these two lines to
  it by hand:

  ```
  docs/build/
  docs/.docusaurus/
  ```

  If either directory is already committed, also run `git rm -r --cached docs/build docs/.docusaurus`
  once: git never ignores a file it tracks.

- d09cc6d: The admin route reader behind `check:action-route-permissions` reads registrations whose path is
  not a literal at the call site. A route registered through a `const` (`app.get(base, …)`), through
  a local helper's parameter (`patchRoute(url, …)`), as a `+` concatenation, as a member of a table
  declared in the file, with `app.route({ method, url, … })`, or with `.all` / `.head` / `.options`
  was not read as a registration at all, while the summary's `unreadable-paths` said `0`. Four admin
  routes in this repository were in no route record for that reason.

  A registration whose path still cannot be resolved is now reported in `RouteScanResult.unreadable`
  (file, line and the path as written) instead of being skipped, unless the part that was read
  already shows the path is outside `/api/v1/admin`. `unreadablePaths` is that list's length.

  `RouteScanInput.pathBindings` lets a caller supply the values of a path identifier no declaration
  in the file provides — a registrar mounted under a prefix it is handed.

  `requireAdmin('')` is read as `requireAdmin()`: the guard returns before checking anything when
  the code is empty, so the route is open to any administrator session and is reported that way.

  For `check:action-route-permissions` itself the verdicts are unchanged in this repository: one
  action now resolves at the `exact` level instead of `subtree`, to the same code.

- fee2de0: The storefront `endora new` writes credits the platform in its footer: "Built with ❤️ using Endora
  Commerce", where the product name links to `https://commerce.endora.software`. The link carries
  `utm_source=storefront`, `utm_medium=referral`, `utm_campaign=built-with` and `utm_content=footer`,
  and the URL is exported from `components/Footer.tsx` as `BUILT_WITH_URL`.

  A storefront that already exists keeps the source it was created with and does not gain the line.
  To remove it from a new one, delete the `<span>` that renders it in `components/Footer.tsx`.

- 8ca54eb: The storefront `endora new` creates asks for the delivery and payment methods of the sales channel
  the buyer is shopping.

  `listDeliveryMethods` and `listPaymentMethods` in `lib/api/methods.ts` called the backend with no
  request context, so no `X-Sales-Channel` header was sent. They take the context as a required
  argument now, and the checkout and the buyer's preferences page pass `(await getServerContext()).ctx`.

  A storefront that already exists keeps its source and does not receive this. On an instance with
  more than one sales channel it is then answered with the default channel's methods on every
  channel; the steps are in _Upgrading an instance_.

- ad4aa50: The storefront `endora new` creates tells the backend which sales channel an order is placed on.

  The storefront's order calls went out with no `X-Sales-Channel` header: they are made server-side,
  to the backend's own host, and did not forward the request context. Whatever channel the buyer was
  shopping, the backend resolved the system default for them. The storefront now forwards the
  context — and with it the header — on order placement, the order-total preview, one-click buy and
  its eligibility check, and "order again as a quote request".

  In `lib/api/orders.ts`, `placeOrder`, `previewOrderTotal` and `cloneOrderToQuote`,
  and in `lib/api/quick-order.ts`, `placeOneClickOrder` and `getOneClickEligibility`, take the request
  context as a required last argument; the checkout, order and product pages pass
  `(await getServerContext()).ctx`.

  A storefront that already exists keeps its source and does not receive this. It matters only on an
  instance with more than one sales channel; the steps are in _Upgrading an instance_.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0

## 0.104.0

### Patch Changes

- 0dc258c: Two things about the questions `endora install` — and so `npx create-endora-commerce` — asks at a
  terminal.

  - **The administrator password is checked when it is given.** An instance refuses a password
    shorter than 12 characters, and the installer used to find that out at the step that creates the
    account — after the tree was written, the packages installed and the database migrated — so a
    short password cost the whole run. The wizard now says so and asks again at once, and a short
    `--admin-password` is refused with the other preconditions, before anything is written.
  - **The parts are checkboxes.** Where the terminal can redraw, the _Which parts should this machine
    run?_ list is moved through with the arrow keys, toggled with Space and accepted with Enter,
    instead of by typing row numbers. A terminal that cannot move its cursor (`TERM=dumb`) and input
    that is not a terminal keep the numbered list; every flag answers what it answered before.

- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
  - @endora-commerce/contracts@0.104.0

## 0.103.1

### Patch Changes

- 3198a66: The storefront this package scaffolds read the product list's pagination from a field the API does
  not send. The published shape is `{ cursor, hasMore, limit }`; the storefront declared and read
  `nextCursor`, which was therefore always `undefined`. Three things followed, and the third can
  take a shop offline:
  - `/catalog`, `/search` and `/c/<slug>` never offered a next page, so a shop with more products
    than one page showed only the first.
  - `/sitemap.xml` asked for the first page of products over and over until it had 5000 URLs, and
    listed those products many times each and none of the others.
  - **An unpatched storefront can stop answering every request when `/sitemap.xml` is requested.**
    When the first page of products comes back empty while reporting more — which the API does
    answer, when the first rows it pages over belong to another sales channel — the sitemap's loop
    had no exit and, served from the data cache, never yielded: one core at 100 % and no response
    to anything until the process is restarted. Any crawler can trigger it.

  A storefront created by `endora new` at this version or later carries the fix. **A storefront
  created earlier keeps its source through `endora upgrade`, which moves packages only, so it has
  to be patched by hand.** Five files; if yours has not been customised the edits are exactly:
  1. `lib/api/catalog.ts` — add `Pagination` to the `import type { … } from
'@endora-commerce/contracts'` list, and in `ListProductsResponse` replace the hand-written
     `pagination: { limit: number; nextCursor: string | null; hasMore: boolean; }` with
     `pagination: Pagination;`.
  2. `app/(catalog)/catalog/page.tsx` and `app/(catalog)/c/[slug]/page.tsx` — one line each:
     `nextCursor={products.pagination.nextCursor}` becomes
     `nextCursor={products.pagination.cursor}`. `components/Pagination.tsx` does not change.
  3. `app/page.tsx` — in the `listProducts(...).catch(...)` fallback, `nextCursor: null` becomes
     `cursor: null`.
  4. `app/sitemap.ts` — replace the whole `productUrls` function with:

     ```ts
     async function productUrls(ctx: Ctx): Promise<string[]> {
       const urls = new Set<string>();
       try {
         const asked = new Set<string>();
         let cursor: string | undefined;
         for (let pages = 0; pages < 100 && urls.size < PRODUCT_URL_LIMIT; pages += 1) {
           const page = await listProducts({ limit: 100, ...(cursor ? { cursor } : {}) }, ctx);
           for (const product of page.data) urls.add(absoluteUrl(`/p/${product.slug}`));
           const next = page.pagination.cursor;
           if (!page.pagination.hasMore || !next || asked.has(next)) break;
           asked.add(next);
           cursor = next;
         }
       } catch {
         // Short rather than a 500: the pages already walked are real URLs.
       }
       return [...urls].slice(0, PRODUCT_URL_LIMIT);
     }
     ```

     The loop is now bounded whatever the API answers: at most 100 requests, never the same cursor
     twice, and each product listed once.

  Then run `pnpm run typecheck` — after step 1 it reports any other place that still reads
  `nextCursor` — and rebuild and redeploy the storefront. If you cannot patch at once, restarting
  the storefront clears a hang, and it will recur on the next request for `/sitemap.xml` that meets
  an empty first page.

- @endora-commerce/contracts@0.103.1

## 0.103.0

### Minor Changes

- d0e76fd: Page Builder renderers a module package ships are generated, seeded and checked. `endora generate` adds one `@import` to the admin stylesheet for every installed module package that declares `./blocks.css`, and refuses a declared subpath whose file is missing. `endora new storefront` writes a storefront that discovers its installed modules' `./storefront` layers and block stylesheets at build time (`blocks:generate`, run by `dev` and `build`) and carries `lib/page-builder/local-blocks.tsx` for blocks the storefront renders itself. `endora install` adds, once, every module of the instance that publishes a storefront layer to the dependencies of the storefront it writes beside it. `endora check` gains `check:block-renderers`: a storefront layer imports only what it may and injects HTML only through `sanitizeRichHtml`, an e-mail layer stays React-free, `./blocks.css` is scoped to the module, and every renderer names a block the package's own manifest declares for that surface.

### Patch Changes

- 5afd004: The generated module reference pages give an operator command in the form an instance runs.
  The **Operator commands** table read `pnpm --filter backend run cli -- <module> <command>`, which
  is the form for a checkout of the Endora Commerce repository. In an instance the backend member
  is named `<instance>-backend`, so that command matches no project: pnpm prints `No projects
matched the filters` and exits `0` without running anything. The table now reads
  `pnpm run cli <module> <command>`, run in the root of the instance, and names the repository
  form once above it.
- bd70d67: A storefront written by `endora new storefront` or `endora install` runs its own `.tsx` tests again.
  The scaffold has no lockfile and declares `vitest ^4.1.11`, so a fresh install resolves Vite 8, which
  transforms with oxc and ignores the `esbuild` JSX option the storefront's `vitest.config.mts`
  carried: `pnpm test` failed on every test that renders JSX with _"Failed to parse source for import
  analysis … make sure to not set jsx to preserve"_. The packaged reference now declares the automatic
  JSX runtime for both transformers, so the tests run under Vite 7 and Vite 8 alike.

  An existing scaffolded storefront is repaired by adding
  `oxc: { jsx: { runtime: 'automatic', importSource: 'react' } }` beside the `esbuild` block in its
  `vitest.config.mts`.

- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
  - @endora-commerce/contracts@0.103.0

## 0.102.0

### Minor Changes

- 989d7a4: Add `endora upgrade [<version>]`, and declare it in every new instance as `pnpm run upgrade`.

  Run inside an instance, it moves every package of the release the CLI belongs to — the platform,
  every module, the admin shell, `@endora-commerce/contracts` — to one version (the registry's
  latest when none is named), in every member's `package.json` and in the storefront beside the
  instance, then runs `pnpm install`, the instance's `pnpm run setup` and `pnpm install` in the
  storefront. An exact pin stays exact and `^` stays `^`; a package the release does not carry (a
  module versioned outside the release, a third-party library) or a spec that is not a version
  range is left as written and named. Lockfile entries of release packages at another version are dropped so pnpm re-resolves the
  peers it installed by itself. Every precondition is checked before anything is written; a failing
  step exits with its own code and prints what is left; `--dry-run` reports and does nothing; an
  instance already at the version is told so and left untouched; a version older than the one
  installed is refused. `--storefront-dir <path>` and `--no-storefront` choose the storefront.

  Do not upgrade an instance with `pnpm update`: it leaves the exact `contracts` pin behind (two
  copies installed, one unmet-peer warning per module), cannot cross a minor release in `0.x`, and
  never moves an auto-installed peer. An instance created by `0.101.x` or earlier has no `upgrade`
  script; `pnpm add -D -w @endora-commerce/cli@<version>` and then `pnpm exec endora upgrade
<version>` upgrade it. The documentation page _Upgrading an instance_ has the details.

  `runUpgrade`, `rewriteRange`, `rewriteManifestText`, `pruneLockfile` and `compareVersions` are
  exported from the package root.

- 255b60b: The page builder's editor peer moves from `@measured/puck` to `@puckeditor/core`. Puck renamed
  its package at 0.21 (`npm install @measured/puck` now prints _"Puck has moved"_), and these
  packages now import `@puckeditor/core` 0.23 — the code, the types and the stylesheet
  (`@puckeditor/core/puck.css`).

  **What a consumer changes.** If your project declares the editor itself — an admin application
  that bundles `@endora-commerce/page-builder-admin`, `@endora-commerce/mod-cms` or any of the
  modules above, or a storefront rendering pages through `@endora-commerce/cms-components`:

  ```bash
  pnpm remove @measured/puck
  pnpm add @puckeditor/core@^0.23.0
  ```

  and rename the specifier in any import of your own (`'@measured/puck'` → `'@puckeditor/core'`,
  `'@measured/puck/puck.css'` → `'@puckeditor/core/puck.css'`). A project scaffolded with
  `create-endora-commerce` / `endora new instance` gets the new name at its root from this release
  on; an existing instance renames the one line in its root `package.json`. Leaving
  `@measured/puck` installed does not satisfy the peer — the two names are different packages —
  so a bundler resolves `@puckeditor/core` to nothing and the editor fails to build.

  **Stored content is unchanged.** Puck 0.21–0.23 changed no part of the page data shape: CMS
  pages, blocks, templates, blog bodies, e-mail templates, newsletter blocks and invoice templates
  persisted under 0.20 render and edit as they did, with no migration and no read-time adapter.

  **The editor looks and behaves as it did.** Three 0.21–0.23 defaults that reshape the editor are
  pinned back for every builder host through new exports of `@endora-commerce/page-builder-core/editor`:
  `withPuckLegacySideBar(plugins)` keeps the stacked Components + Outline side bar instead of the
  0.21 Plugin Rail, `PUCK_LEGACY_VIEWPORTS` keeps the 0.20 Small / Medium / Large viewports without
  the 0.21 full-width one (the CMS host keeps passing its own breakpoints), and `PUCK_LEGACY_DND`
  keeps the 0.20 fluid drag-and-drop instead of the 0.23 insertion line. A host of your own built on
  these packages can pass the same three to its `<Puck>`.

  `@puckeditor/core` 0.23 requires Node 20 or later, below this platform's own floor (22.17).

### Patch Changes

- 5faaa66: A scaffold of release X now names every package of release X at exactly X.

  `endora install`, `endora new instance` and `endora new storefront` — and so
  `npx create-endora-commerce@X` — used to write `^X` for the platform, every module, the admin
  shell, the design system, the page-builder and component packages and the CLI, and `X` exactly
  only for `@endora-commerce/contracts`. Run after a newer patch was published, the install
  resolved the carets to the newer patch and kept `contracts` at X: two copies of `contracts` and
  one unmet-peer warning per module, in a tree nobody had edited. Every package of the release is
  now written exactly, in the root, `admin/` and `docs/` manifests and in the storefront, so a
  scaffold of X installs X on any day and moves forward only through `pnpm run upgrade`, which
  keeps an exact pin exact. A package of the scope at another version than the release keeps its
  caret, and third-party ranges are unchanged.

  An instance already scaffolded with carets needs nothing: `pnpm run upgrade` (or, on `0.101.x`
  or earlier, `pnpm add -D -w @endora-commerce/cli@<version>` then `pnpm exec endora upgrade
<version>`) puts it on one version.

- @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- @endora-commerce/contracts@0.101.1

## 0.101.0

### Minor Changes

- 5749604: Endora Commerce can be served from **one host with paths** — the storefront at `/`, the admin under `/admin`, the API under `/api` — as well as from one address per component.

  `@endora-commerce/cli`
  - **`endora install --public-url <origin>`** selects that layout. It stands for `--api-url <origin>`, `--storefront-url <origin>` and `--admin-url <origin>/admin`, each applied where the run has a use for it (so it works with `--only` on each machine in turn), and is refused beside any of the three. The API's address in this layout is the host itself — its routes already begin with `/api/v1` — so `--api-url` and `--storefront-url` still refuse a path, and now say why.
  - **`--admin-url` accepts a base path** after its origin (`https://example.com/admin`, or any other plain path; no trailing slash, query or fragment) and is accepted by a run that stands the admin up without the API, where it used to be refused. The path is written as `ADMIN_BASE_PATH=<path>/` into `admin/.env`.
  - **The scaffolded `admin/vite.config.ts` reads `ADMIN_BASE_PATH` as Vite's `base`** (default `/`). An instance scaffolded before this release gets the same by adding `base: env['ADMIN_BASE_PATH'] || '/'` to its own configuration.
  - With the API in the run, `ADMIN_BASE_URL` is the admin's whole address, path included, and `CORS_ALLOWED_ORIGINS` holds origins, each once. A port in an origin two components share is the proxy's, and is no longer written as either component's `PORT`.
  - The wizard, for a run that stands up only some components, asks how the three are reached before it asks any address: _one address each_, or _one address, with paths_ — which is then one question.
  - The closing block of such a run lists the routing the host owes: `/api/` and `/assets/file/` to the API unchanged, `/api/revalidate` exactly to the storefront, `/admin/` to the admin with its `index.html` as the fallback, everything else to the storefront.
  - **`deploy/nginx.paths.example.conf`** (single-host topology) is that routing for nginx, and `deploy/README.md` gains a section on it. `Dockerfile.admin` says how the image is built for a base path: a committed `admin/.env.production` holding `ADMIN_BASE_PATH=/admin/`.
  - **Both nginx examples forward `$http_host`** — the host with its port — as `Host` and `X-Forwarded-Host`, where they forwarded `$host`. Behind a proxy on any port but 80 or 443 the storefront refused every form submission (`x-forwarded-host … does not match origin`), because Next compares the two.
  - The storefront this CLI carries: its service worker leaves requests under `/admin` to the network, as it leaves `/api/`.

  `@endora-commerce/admin-shell`
  - **`AdminRoot` mounts its router under the bundle's base path.** New optional prop `basename`; by default it is derived from Vite's `import.meta.env.BASE_URL`, so a project built with `base: '/admin/'` gets a router under `/admin` with nothing else to set. With the default base nothing changes. New export `routerBasename(base)`.

  `@endora-commerce/mod-blog`, `@endora-commerce/mod-catalog`
  - Two admin screens linked with a raw absolute `href` (the _new category_ button of the blog category tree; the product links in the bulk-edit result list). Under a base path a raw `href` leaves the admin, and at the root it reloaded the application; both are the router's `Link` now.

- 0ad1d67: `endora install` — and so `npx create-endora-commerce` — can stand the API, the Admin UI and the storefront up **each on a machine of its own**.
  - **`--only <api|admin|storefront>[,...]`** (repeatable) names the components this run stands up on this machine. Absent, all three, and the run plans the steps it planned before. It is a third axis and replaces neither `--without <member>` (what the tree holds) nor `--topology` (which example deployment files are written): a selection without `admin` behaves as `--without admin`, one without `storefront` as `--no-storefront`, and naming the two spellings in contradiction (`--only admin --without admin`) is refused.
  - **`--only api`** writes the instance without its admin member and runs today's pipeline. **`--only admin`** writes the same instance tree — backend member included, because the admin's screens are derived from the module packages that tree installs — and runs `pnpm install` and `pnpm run build:admin`: no database, no service, no migration, no administrator. **`--only storefront`** writes no instance; `<dir>` is the storefront's own directory and the one step is its `pnpm install`.
  - **`--api-url`, `--admin-url`, `--storefront-url`** are public origins (scheme, host, optional port — a path or a trailing slash is refused) and **`--sales-channel <code>`** a Sales Channel code. Without `api`, `--api-url` is required and is written as `VITE_API_BASE_URL` in `admin/.env` and as `NEXT_PUBLIC_API_BASE_URL` / `BACKEND_BASE_URL` in the storefront's `.env`; a storefront without `api` also requires `--storefront-url` and `--revalidate-secret`. With `api`, each origin given is written into the instance's `.env` — `PUBLIC_API_BASE_URL`, `ADMIN_BASE_URL` (where the instance declares it), `STOREFRONT_BASE_URL` and `CORS_ALLOWED_ORIGINS`. A line you already answered in `.env` is never written over.
  - **`REVALIDATE_SECRET`**: a run with `api` and no storefront generates it once (or writes `--revalidate-secret` verbatim) into the instance's `.env`, names the file and never prints the value. A run without `api` never generates it.
  - **A flag that answers a question the selection removed is refused**, in the same single refusal as everything else: `--demo`, `--no-demo`, the four `--admin-*` administrator flags, `--no-services` and `--admin-url` without `api`; `--without`, `--module`, `--deployment`, `--topology` and `--storefront-dir` when no instance is written; `--sales-channel` with `api`.
  - **The wizard's** parts question now reads _"Which parts should this machine run?"_ and lists `api`, `admin`, `storefront`, then `docs`. Enter on the untouched list is unchanged. A strict subset is asked where the other machines are; a required origin re-asks on an empty line or a value that is not an origin, and the secret is read without echo. The `[answers]` line's `total` is the number of questions the selection has — still `7` for all three.
  - **The closing block** lists start commands for the selected components only and, for a strict subset, the four facts no single machine can check: the API's `CORS_ALLOWED_ORIGINS`, the API origin being bound at build time, the same-site requirement of the `SameSite=Lax` session cookies, and the module set an admin's tree must share with the API. `deploy/README.md` states the same four under `--topology three-host`. `--without backend` is still refused; its sentence now names `endora install <dir> --only admin --api-url <origin>`.

  Fixed along the way, in every selection:
  - **The admin's and the storefront's ports are no longer constants.** A taken `3002` or `3000` is replaced by a free port, written as `PORT` into `admin/.env` or the storefront's `.env`, said out loud, and — with the API in the run — added to the instance's `CORS_ALLOWED_ORIGINS`, `ADMIN_BASE_URL` and `STOREFRONT_BASE_URL`; `NEXT_PUBLIC_SITE_URL` names the same port. A loopback `--admin-url` / `--storefront-url` with a port (`http://localhost:4000`) is the port that component is served on. The closing block prints the addresses.
  - **An API on a port of its own is what the admin bundle is built against**: `PORT` in the target's `.env` is written as `VITE_API_BASE_URL=http://localhost:<port>` into `admin/.env`. The bundle used to be built for `localhost:3001` regardless.
  - **`--registry` reaches the storefront.** It was passed to the instance only, so the storefront beside it was written with no `.npmrc`.
  - **`--revalidate-secret` is written into the instance as well as the storefront**, and the shared secret now reaches an instance whose `.env` you placed before the run. It was written only over a commented placeholder, and a placed `.env` has none — so pinning `PORT` first left the pair with one half.
  - **The printed `dev:all` command for a storefront in a non-default directory runs.** It was printed as `pnpm run dev:all -- --storefront-dir <path>`; pnpm passes the `--` on and `endora dev` refused it. It is now `pnpm run dev:all --storefront-dir <path>`.
  - **The storefront this CLI carries starts under pnpm.** Its `dev` script handed `node` the path of a pnpm shell shim and exited at once, which stopped every `pnpm run dev:all` that had a storefront beside the instance. `dev` and `start` now run Next's own entry through `node --env-file-if-exists=.env`, so `PORT` in the storefront's `.env` is the port both listen on.

- d919418: `npx create-endora-commerce <dir>` (`endora install`) and `endora new storefront <dir>` now write the storefront **outside a checkout of the platform repository**. The CLI's build runs the same `planStorefront` over the reference storefront and ships the finished plan in `dist/storefront-reference/`; where no checkout is above the working directory the commands write that. Inside a checkout nothing changes: the storefront is still copied from the checkout.

  What a consumer sees:
  - `--no-storefront` is no longer needed anywhere. `endora install <dir>` writes `<dir>-storefront` beside the instance and installs it; the wizard's parts checklist shows the storefront as a toggleable, pre-checked row.
  - The packaged reference leaves out the reference storefront's Playwright screenshot baselines (8.4 MB of the 10.8 MB tree) and reports that as an omission, with `pnpm exec playwright test --update-snapshots` as the way to record your own. A checkout's scaffold still copies them.
  - `--registry <url>` is applied at run time to the packaged plan, through the same code a checkout's plan goes through.
  - `pnpm pack` / `pnpm publish` of this package refuses a `dist` with no packaged reference (`prepack`). A build made without git or without the storefront tree — a container image — still succeeds and writes none.

  `endora install` also changed in four ways:
  - **Ports.** Before anything is written, it probes the host ports the development stack publishes. A default that is taken is moved to a free one (`POSTGRES_PORT=15432`, …), written into the instance's `.env`, and the derived `DATABASE_URL` / `REDIS_URL` / `MEILISEARCH_URL` / `SMTP_URL` follow it — they used to be composed from the defaults regardless, so the run died at `dev:services` or, worse, pointed at another project's Redis. A `*_PORT` you set in the target's `.env` is never moved: taken, it is a refusal with nothing written. Addresses are now derived when the target already held a `.env`, too.
  - **The administrator's password is not printed.** The `[n/N]` echo, `--dry-run` and the resumable list show `--password=<password>`, and the step no longer passes the password as an argument at all: it runs `admin:create -- … --password-stdin` and writes the password to the command's standard input (`InstallStep.stdin`). As an argument it was echoed twice by pnpm and once by the operator CLI's own log.
  - **The resumable list starts at the step that failed** (it started after it), and each line names its directory.
  - **The closing block** names the API on the instance's own `PORT` rather than `3001`, says when that port is in use, and under `--no-services` no longer promises a mail catcher. The storefront's `NEXT_PUBLIC_API_BASE_URL` and `BACKEND_BASE_URL` use the same `PORT`.

  API: `NewStorefrontResult.reference` is `StorefrontReference | null` (null when the packaged reference was written) and gains `source`; `NewStorefrontOptions` / `InstallOptions` gain `packagedReferenceDir`; `InstallOptions` gains `portInUse`; `runNewStorefront` and `storefrontDeclaredInputs` no longer throw outside a checkout when the CLI carries a reference. New exports: `resolveStorefrontSource`, `StorefrontSource`, `NoReferenceStorefrontError`, `readPackagedReference`, `ownPackagedReferenceDir`, `PackagedReference`.

  `@endora-commerce/mod-admin-users`: `admin_users create` accepts `--password-stdin` in place of `--password=<p>` and reads the password from standard input. Both at once is refused; `--password=` works as before.

  `@endora-commerce/platform`: the operator CLI no longer logs a credential. The reason it opens a command's system scope with (`tenant.escape_hatch`, `cli: <argv>`) was the raw argv, so `admin_users create --password=…` wrote the password into the log; the value of any `--flag=value` whose name contains `password`, `passphrase`, `secret`, `token`, `credential` or `api-key` is now `<redacted>`.

### Patch Changes

- 40ce6f4: `ASSETS_LIBRARY_HMAC_KEY` no longer accepts a placeholder as a signing key. A value beginning `change-me` — what the env examples carried — is not hex, so `HmacSigner.fromEnv` read it as raw bytes and signed private asset links with a string every copy of the example shares. It now throws, naming the key and `openssl rand -hex 32`, exactly where an unset key already did. The `deploy/` examples `endora new instance` writes leave the key empty, with the sentence saying what empty costs. A deployment still running on a copied placeholder will have its private asset links refused until a real key is set.
- The `deploy/Dockerfile.backend` that `endora new instance` writes now defaults its `DEPLOYMENT` build argument to the instance's own deployment (`ARG DEPLOYMENT=<the directory under apps/>`). A blank `DEPLOYMENT` is bare core, so an image built without `--build-arg DEPLOYMENT=…` composed none of the overlay modules its own tree carries, and nothing said so. Passing the argument still overrides it, and an empty value still builds bare core. An instance written earlier keeps its old Dockerfile: add the default to its `ARG DEPLOYMENT` line by hand.
- 40ce6f4: `endora generate` in an instance now exits 1 in two cases where it exited 0. A `migrations/` or `entities/` directory, or a source declaring an `@Entity()` class, under `apps/<deployment>/modules/` is refused before anything is written, naming each file: an overlay module contributes no schema, and nothing in an instance would have run it. And a finding in the divergence report — a divergence with no sentence in `divergence.ts`, a sentence for one that is gone, a declaration field not written as a literal — now fails the command after the report is written, with what each kind asks for; it used to print the finding and succeed, so `pnpm run setup` passed over an unexplained divergence. A script that runs `pnpm run generate` over a deployment with open findings will now stop there.
- 40ce6f4: An instance written by `endora new instance` (and so by `npx create-endora-commerce`) now composes its own overlay directory with no hand edit. It wrote `apps/<deployment>/` and no `DEPLOYMENT`, so an overlay module placed there was silently not composed; and it did not declare `@endora-commerce/contracts`, so any overlay `manifest.ts` stopped every command with `ERR_MODULE_NOT_FOUND`. The run now writes `DEPLOYMENT=<deployment>` into `.env` and `.env.example`, and declares `@endora-commerce/contracts` in the root `dependencies` at the exact version the resolved platform pins. With no `--deployment`, a `DEPLOYMENT` in a `.env` you placed in the target directory first names the directory. An instance created by an earlier release needs both lines added by hand: `echo "DEPLOYMENT=<dir under apps/>" >> .env` and `pnpm add -w @endora-commerce/contracts@<the platform's version>`.
- 40ce6f4: `endora new module <id> --name … --description …` now works inside an instance. It used to stop there, naming `backend/scripts/generate-module-manifests.ts` as missing. Inside an instance it writes an overlay module — `apps/<deployment>/modules/<id>/` with `manifest.ts`, `backend.ts` and both `i18n/` bundles — which the instance composes with no build; `--depends`, `--permission`, `--activation-setting`, `--non-deactivatable` and `--dry-run` apply. The flags that ask for what an overlay module cannot be (`--entities`, `--tenant-scope`, `--admin`, `--action`, `--ports`, `--worker`, `--subscriber`, `--dir`, `--scope`) are refused with exit 1 and the reason, before anything is written. Inside a checkout of the platform repository the command writes a module package exactly as before. `runNewModule`'s result gains `overlay: { deployment } | null`.
- 25b99b2: The two READMEs a reader meets on npmjs now say what the packages do. `create-endora-commerce`'s still said _Not yet published_ and that its command did not resolve; it now shows the two commands, what they write, and links the getting-started page. `@endora-commerce/cli`'s was the generated stub that described "scaffolding and conformance tooling" and nothing else; it now lists `endora install`, `new instance`, `new storefront`, `new module`, `generate`, `dev` and `check` with one line each, and is hand-written from here on — the manifest generator no longer rewrites it.
- be758bb: `endora install` now moves the API to a free port when 3001 is taken, as it already did for the development services, the admin and the storefront. It used to report the busy port in the closing block and leave everything pointed at it, so on a machine that already runs something on 3001 the printed `dev:all` could not start the API. The chosen port is written as `PORT` into the instance's `.env`, and everything that names it follows: `VITE_API_BASE_URL` in `admin/.env`, the storefront's `NEXT_PUBLIC_API_BASE_URL` and `BACKEND_BASE_URL`, `PUBLIC_API_BASE_URL` where the instance declares it, and the closing block. A `PORT` you set in the target's `.env` before the run is used as written and never moved; if it is busy the run still says so. A loopback `--api-url` (`http://localhost:4000`) now also names the port the API listens on, as `--admin-url` and `--storefront-url` already did for their layers.
- be758bb: `endora install` no longer lets two instances share one development stack. Compose names a project after its directory, so a second instance called `shop` — under another parent, or written again after the first was deleted — adopted the first one's containers and mounted its volumes without a word. Before anything is written the run now asks Docker whether a project of the directory's name already has containers or volumes on this machine. If it does, the stack gets a name of its own (`<dir>-<six hex of the path>`), written as `COMPOSE_PROJECT_NAME` into the instance's `.env` and said in the output; `pnpm run dev:services` and `dev:services:down` follow it unchanged, because Compose reads that file. A `COMPOSE_PROJECT_NAME` you set yourself is never replaced: if it is taken the run refuses, naming what holds it.
- be758bb: The temporary host `endora install` provisions is now installed with `--ignore-scripts`. It is read and deleted, so nothing in it needs building, and under pnpm 10 the step used to end with an _Ignored build scripts … run pnpm approve-builds_ box about a directory the operator never sees again. The step's description now says what it counts: the `@endora-commerce/*` packages of the release, which is one fewer than the release publishes because the unscoped `create-endora-commerce` is not installed there.
- 5518597: Four things `endora install` and the trees it writes said that were not true. A `--dry-run` on a machine with a taken port named the mail catcher on the document's default port a few lines after saying it would be published on another; the closing block now uses the ports the run planned. The scaffolded instance README told every reader to run `endora new storefront` next, although `endora install` had already written one beside it, named `generate` as the only command that refuses overlay schema (`migrate`, every `module:*` command and the API at boot refuse it too), and called `module:enable` the operator's switch; it now says where the storefront is and when to write one, lists every refusal, describes the Modules screen, and says where a moved port is written down. `endora new module`'s `--entities` refusal carries the same correction. And a scaffolded storefront now has a `README.md`: what it is, which of its `.env` values are fixed at build time, how `dev`, `build` and `start` run, and where theming is documented.
- be758bb: Three things the install wizard said before it could know them. Its first line stated a total — `0 of 7 answers came from flags` — before the parts were chosen, above a run whose `[answers]` line then said `total=3`; the total is now printed only when the flags already fixed the selection. The directory question said _instance_ even when the next answer made the directory the storefront's own; with the parts still to be chosen it now asks `Which directory should it be written to?`. And the parts checklist kept `[x] docs` beside a storefront-only selection; a member row is now shown unchecked, with the reason, once neither the API nor the admin is selected. A script that matches the wizard's prompts by text needs the new wording.
- be758bb: An overlay module that ships schema is now refused by `migrate` as well, and every entry point prints the refusal as a sentence. `migrate` composes nothing, so over a tree with a `migrations/` directory under `apps/<deployment>/modules/` it applied every package's schema, none of that directory's, and exited 0; the API and the worker refused it, as an uncaught exception with a stack trace. `@endora-commerce/platform/composition` now exports `refuseOverlaySchema(deploymentRoot)`, which prints the refusal and exits 1, and `exitOnRefusal`, for `.catch()` on `composeApp`: it prints an `OverlaySchemaError`'s message and exits 1, and rethrows anything else untouched. `endora new instance` writes both into `backend/src/migrate.ts`, `index.ts` and `worker.ts`, and the operator CLI (`runCli`) prints the same refusal without a stack. An instance written by an earlier release gets the clean message and the `migrate` check by adding those three lines by hand; without them it behaves as before.
- be758bb: A storefront written by `endora new storefront` or `endora install` no longer reports an unmet `eslint` peer on its first install. `eslint-plugin-jsx-a11y`'s newest release still declares a peer that stops at eslint 9, while the storefront — like the platform repository it is copied from — lints with eslint 10. The repository now states that combination at its root (`pnpm.peerDependencyRules.allowedVersions`), and the scaffold carries the root's rules into the storefront's own manifest, because pnpm reads them from a root manifest and the scaffolded storefront is one.
- be758bb: `endora new storefront`'s plan no longer reports a rewrite inside a file it omits. `test/tailwind-module-package-sources.test.ts` had one reference retargeted and was then left out for another, so the same report listed it under both `rewrites` and `omitted`. `plan.rewrites` now names only files that are written.
- be758bb: A scaffolded storefront's `pnpm run start` now serves the build `pnpm run build` produced, without the warning. The storefront builds with `output: 'standalone'`, and its `start` script ran `next start`, which prints `"next start" does not work with "output: standalone" configuration`. `start` is now `node --env-file-if-exists=.env scripts/start-standalone.mjs`: it finds the standalone server under the directory's own name, puts `.next/static` and `public/` beside it on every start, and listens on every interface on the `PORT` in `.env`. If the tree was not built it says to run `pnpm run build`. `dev` and `dev:all` are unchanged — they run `next dev`. A storefront written by an earlier release keeps its old script; copy `scripts/start-standalone.mjs` and the `start` line from a new one to get this.
- @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- fac27a4: `endora generate` now imports the Tailwind sources of every installed package that ships admin UI, not only the ones declared at the instance root. In a scaffolded instance the admin member declares `@endora-commerce/admin-shell` and `@endora-commerce/admin-kit`, and pnpm links them into `admin/node_modules`; the generator looked only in the root `node_modules`, skipped the shell without a word, and its utility classes were never compiled — the sign-in card rendered at the top-left of the page instead of centred. Each declared dependency is now resolved from the directory of the manifest that declares it, and the population is closed over the dependencies and peers of every package that itself declares `./tailwind.css`, so a UI package another one renders (`@endora-commerce/page-builder-core`, `@endora-commerce/email-components`, installed by pnpm as peers and declared by nobody) is scanned too. A package the admin project cannot resolve by name is imported by a path relative to `admin/src/tailwind.generated.css`, which `endora generate` rewrites on every `dev` and `build`. Run `pnpm run generate` (or rebuild the admin) after upgrading.
- 99cbbcc: `endora install` on a machine without `pnpm` on `PATH` now prints commands that run as printed. It used to tell you to install pnpm globally first and then print `pnpm run dev:all`, which fails with "command not found" when that line is skipped — as the public acceptance run against `0.100.1` showed. Every command it hands over (`dev:all`, `start`, `preview:admin`, the storefront's build and start, the demo seed/reset hint, `dev:services:down`, and the remaining steps after a failure) now runs this release's pinned pnpm through `npx --yes pnpm@<version>`, which needs only Node and npm and puts that pnpm on `PATH` for the instance's own nested scripts. With `pnpm` on `PATH` the commands stay `pnpm …`.
- 54c7417: `demo seed` on an instance scaffolded by the CLI now builds a working demo shop. Before, it created every module's own demo rows and nothing that joins them: `admin@demo.local` and both sales representatives had no admin role (`/admin/me` answered `permissions: []`, so the admin sidebar was empty), and the 203 demo products were sold on no sales channel, so the storefront listed none. The wiring — roles, channel and category bindings, the menu, prices, stock, the demo buyer, attributes, images, attachments and the credit limit — was a file in the platform repository's own host, which no instance had.

  It is now the new package `@endora-commerce/demo-composition`. The platform's operator CLI finds an installed package declaring `"endora": { "type": "demo-composition" }` when the instance's `cli.ts` passes no `demoComposition` loader, and runs it; with none installed, `demo seed` behaves as before and its notice now names the package to add. `endora install --demo` and the new `endora new instance --demo` add the package to the instance's module list and write no file into the tree.

  The demo adopts the instance's system-default sales channel as its retail channel and keeps that channel's code when the operator chose one (`DEFAULT_SALES_CHANNEL_CODE`); only the platform's fallback code, `default`, is renamed `pl_retail`, as before. It used to rename any code, which would have moved the demo off the channel a storefront is built against.

  `@endora-commerce/platform/demo` — the host-internal subpath no module may name — no longer exports `NO_DEMO_COMPOSITION_NOTICE` or the `DemoCompositionLookup` type; their only consumer outside the platform was the loader this change removes. `DemoCompositionInput` stays, as the argument `createDemoComposition` takes.

  To fix an existing instance: `pnpm add -w @endora-commerce/demo-composition` at the instance root (it is a pnpm workspace, so plain `pnpm add` refuses), then `pnpm run cli demo seed` again. The seed is idempotent, so the rows already there are joined rather than duplicated.

- @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- f988e26: `endora install` on a machine without `pnpm` on `PATH` now runs the pnpm this release pins, instead of `corepack pnpm@latest`. The `latest` tag had moved to a pnpm (12.8.1) whose `bin/pnpm.mjs` the corepack bundled with Node 22.18 cannot start, so the install died with `Cannot find module '…/pnpm/12.8.1/bin/pnpm.cjs'` before installing anything. The CLI's build now records the repository's own `packageManager` (`pnpm@9.15.0`) in its release index, `endora install` runs exactly that through corepack, and the instance it scaffolds declares the same `packageManager`, so the CLI and the instance agree on one pnpm.

  With that pnpm reached through corepack, the instance's own scripts — `setup` chains `pnpm run generate && pnpm run build && …` — still found no `pnpm` and failed with `sh: 1: pnpm: not found`. The pipeline's steps now run with a `pnpm` shim for the pinned version first on their `PATH`, in a temporary directory the run removes on exit (never `corepack enable`), and the closing block tells you to put that pnpm on your own `PATH` before the commands it prints.

- @endora-commerce/contracts@0.100.1

## 0.15.0

### Minor Changes

- c9faba1: Add `endora dev`, and a `dev:all` root script in every instance `endora new instance` and `endora install` write. From the instance root, `pnpm run dev:all` starts the API (`pnpm run start`), the admin preview (`pnpm run preview:admin`, when the instance has an admin) and the storefront beside the instance (its `pnpm run dev`, when there is one at `<dir>-storefront` or at `--storefront-dir <path>`), in one terminal with each line prefixed by its layer. Ctrl-C stops all of them and exits 0; any one layer ending stops the others, names which, and exits with that layer's code. `--no-storefront` starts the API and the admin preview only.

  No per-layer script changes: `build`, `build:backend`, `build:admin`, `start` and `preview:admin` keep their values, and each layer is still built and deployed on its own. The instance README lists the new script, and the closing block `endora install` prints now names `pnpm run dev:all` first, followed by the per-layer commands it replaces for everyday use.

  An instance scaffolded by an earlier version gains the script by adding `"dev:all": "endora dev"` to its root `package.json`; the `@endora-commerce/cli` devDependency it already declares provides the binary.

- 797a579: `endora install` now works from an empty directory, including through `npx create-endora-commerce`. When `@endora-commerce/platform` is not installed beside the target or the working directory, it first installs every package of this CLI's release into a temporary directory under the OS temp directory, reads the module set from there, and removes it once the instance is written; if that install fails the directory is kept and its path printed, and the command exits with the install's own code. `--dry-run` provisions and removes it too. The release is read from `dist/release-index.json`, which the CLI's build now writes. When the platform already resolves, nothing changes.

  With no `--module`, `endora install` now installs every module package it resolved that is not separately licensed (`SEE LICENSE IN` / `UNLICENSED`), closed over dependencies as before, instead of only the modules the platform cannot run without; its closing block names the count and that any module can be switched off in the admin under Modules. If one of those modules depends on a separately licensed one, the run is refused (F2) rather than installing it. `--module` and `endora new instance`'s default are unchanged. `resolveModuleSet` gains an optional third argument, `{ seed: 'required' | 'available' }`, and `runNewInstance` a `moduleSeed` option; `ModuleCandidate` gains `license`.

- 224fe10: `endora install` asks, at a terminal, what its flags did not answer: the directory (recommending `./endora-commerce`), which parts to write (a checklist over the instance's members and the storefront), whether to start the development services, whether to seed demo data (no default: Enter asks again), and the administrator's e-mail, password (not echoed) and name. Every question has a flag, and with `--non-interactive`, `--dry-run`, a CI marker or no terminal on either descriptor it asks nothing — a missing answer, the directory now included, is one refusal naming every flag still owed. Each run prints an `[answers]` line (`flags=`, `prompted=`, `recommended=`, `defaulted=0`) and the closing block names every recommendation taken with what reverses it.

  `endora new instance` and `endora install` accept `--without <member>` (repeatable; `admin` or `docs`), which writes the instance without that member while keeping the same module list. `--without backend` and a name that is not a member (including `storefront`, which `--no-storefront` leaves out of `install`) are refused before anything is written. The vocabulary is exported as `MEMBER_VOCABULARY` beside `memberRefusal`.

### Patch Changes

- 82986ff: The example deployment files `endora new instance` writes now migrate and install. The `backend-migrate` one-shot ran `node dist/db/migrate.js up`, a file the scaffolded backend never emits, so it exited non-zero and the API waiting on it never started; it now runs `node dist/migrate.js`, the file `backend/src/migrate.ts` compiles to. A new `backend-install` one-shot runs `node dist/module-commands/install.js --all` (the compiled `module:install --all`, idempotent) after the migrations and before the API, in `deploy/compose.prod.yml` and in the three-host `deploy/three-host/compose.backend.yml`, so a fresh database runs every module's install hooks. An instance scaffolded by an earlier version can copy the two service blocks from a newly rendered example.
- fe176a6: `endora new storefront` now writes a `Dockerfile` that builds in the storefront it scaffolds. It used to copy the reference storefront's own `Dockerfile`, which builds from the platform repository's root and stops at `scripts/collect-workspace-manifests.sh`, a file a scaffolded storefront does not have. The rendered one installs from the storefront's `package.json` and committed `pnpm-lock.yaml`, runs `pnpm run build`, and serves the standalone output; its build arguments are the storefront's entries in the instance build-input declaration. With `--registry` it also copies `.npmrc` and reads the registry token from a BuildKit secret (`--secret id=endora_npm_token,env=ENDORA_NPM_TOKEN`), never from a build argument. A `.dockerignore` is written beside it, so `.env` and the installed trees stay out of the image. A storefront scaffolded by an earlier version can take both files from a new scaffold.
- 4b1844c: Reword two source comments that ship in `dist`: the `TOKEN_VARIABLE` note in
  `new-storefront/npmrc` now speaks of an operator, and the port-catches rule note
  in `check/estate` describes the packages it measures by what they are
  (integration-heavy, with ports owned elsewhere). No behaviour change.

## 0.14.0

### Minor Changes

- 4d8a3b6: The generated module reference page's licence row now states what the module's package is
  published under — its `package.json` `license` — instead of the manifest's `license` field, an
  edition-tier enum no module sets, which rendered `—` on every page. The row is renamed from
  `Licence tier` to `Licence`; an SPDX licence renders as declared (`` `MIT` ``), and a
  `SEE LICENSE IN <file>` licence renders as declared with a note that the terms ship in that file.
  A module no package ships (`core`) still renders `—`.

  New export: `publishedLicenseOf(manifestPath, shipsFrom)` from
  `@endora-commerce/cli/lib/docs-artefacts.js` reads the licence from the nearest `package.json`
  above a manifest, and answers `null` unless that file's `name` is the shipping package.
  `referenceOf(moduleId, loaded, shipsFrom, prosePage, publishedLicense?)` takes the licence as a
  new optional fifth argument; without it the row renders `—`.

  An instance running `endora generate` sees every reference page's licence row change once.

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0

## 0.13.1

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0

## 0.13.0

### Minor Changes

- 9b7a884: Generated documentation pages emit their YAML front matter before the do-not-edit banner.

  `emitModuleReference` and `emitModuleMap` (`lib/docs-artefacts.js`, and therefore
  `renderModuleReferencesFrom`, `renderModuleMapFrom` and `endora generate`'s documentation
  artefacts) used to write the `<!-- AUTO-GENERATED … -->` comment first and open the `---` fence
  underneath it. Front matter is front matter only at byte 0, so Docusaurus never parsed that
  block: `title`, `sidebar_label` and `description` were inert on every generated page, and
  because the banner was then also the page's first content node — an HTML comment rather than a
  `# ` heading — the `contentTitle` fallback was closed too. Every module reference page and the
  module map shipped titled with its own doc id (`catalog | Your Site`) instead of the title it
  declared, in the site navigation, the browser tab, the `<title>` element and the social preview.

  A front-matter value that YAML would misread is now double-quoted. The reference page's
  `description` is the sentence _"Everything the `<id>` module's manifest declares: permissions,
  …"_, and `: ` inside a plain scalar is an incomplete mapping pair — so the moment the block above
  became parseable, `docusaurus build` failed in `gray-matter` on the first generated page it read.
  Quoting is on demand: a value that needs none is still emitted plain, so `title` and
  `sidebar_label` are unchanged.

  The banner is unchanged and still emitted, one blank line below the closing fence, where it is
  still a plain "do not edit" instruction to anyone reading the source and is invisible in the
  rendered page. The `header` parameter of both functions keeps its meaning, so a host passing its
  own banner string needs no change.

  **Regenerate and commit the rewritten pages** — `pnpm --filter backend run composer:generate` in
  this repository, `endora generate` in an instance. The bytes of every generated page change, so a
  tree that does not regenerate will fail `overlay:check` (or its instance equivalent) on the
  drift. If you keep translated copies of these pages, their front matter has to move too, and any
  hash you have pinned against the English body changes with it: the body now begins with the
  banner.

### Patch Changes

- 86f6a5e: `endora new` declares `@docusaurus/core` and `@docusaurus/preset-classic` at `^3.10.2`, the version the documentation site now builds with, instead of `^3.10.0`.
- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- c45614b: The `port-catches` rule no longer reads one module's catches through another module's sources. A call's arguments bind a callee's parameters only when the call site's file declares the callee or imports it through a relative specifier (followed through relative re-exports), instead of whichever declaration of that name the walk read last; and the gates an alias carries are those of the alias scopes visible where the site reads it, instead of every alias of the same spelling. A module's classification therefore no longer changes when another module's sources are added to or removed from the population. Sites that existed only through a same-named declaration in another module disappear from `findPortCatches`.
- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0

## 0.12.1

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0

## 0.12.0

### Minor Changes

- 56ac8af: `endora generate` renders a host's test entity index, and `./lib` publishes the renderer

  A server-bound test needs the entity class **the ORM registered**, and a module package publishes
  one `entities` array and no entity class by name (D-168). _Which_ modules a host installed is the
  one fact `@endora-commerce/test-kit` may not know (feature 109 R2.2, FR-001), so the index is a
  generated per-host artefact: `backend/test/entities.generated.ts`, every installed module keyed by
  its own `endora.id`, with the `entities` array off its published `./backend`.

  `./lib/entity-index-artefact.js` is the renderer, one derivation over two populations
  (`instance-repository.md` R3.5) exactly as `./lib/admin-artefacts.js` is: `endora generate` runs it
  over an instance's installed packages and `composer:generate` runs it over this repository's
  workspace members. A module package publishing no `./backend` is refused rather than skipped — a
  skip reports an installed module as one nobody installed, which sends its operator to look at
  their install rather than at the artefact.

  It is the fifth artefact family and the first that belongs to **no member**, which narrows two
  things rather than weakening them. The `generate` script and the `@endora-commerce/cli`
  devDependency are now written for a headless instance that installed a module, because such an
  instance does have something to render. And `endora generate`'s exit-1 refusal — _a run that wrote
  nothing and said it succeeded_ — now fires on a workspace with no member, no deployment **and no
  installed module**, and its message names the third condition.

- ca34f24: `endora check` gains package-scope hosts for two rules that until now had none, and publishes
  their analyses on two new `./rules/*` subpaths.
  - **`check-entity-tenant-classification`** — every persisted entity class carries exactly one
    tenant-scope decorator (`@OrgScoped`, `@CustomerScoped`, `@GlobalEntity`,
    `@TransitivelyScoped`, `@RuleScoped`). It reads the **emitted** artefact, because that is what
    the platform loads: `@Entity(` does not survive compilation, and the class-level
    `__decorate([Entity({…}), OrgScoped()], C)` call does. A package that was never built, or whose
    source is newer than its `dist`, is reported `unreadable` with the build command — never
    answered from source. `@endora-commerce/cli/rules/entity-tenant-classification.js` exports
    `analyzeSource`, `analyzeEmitted`, `analyzeEmittedFiles`, `classifyFindings`,
    `declaredEntityClasses`, `packageEntityFindings`, `walk`, `walkEmitted` and `remedyFor`.
  - **`check:entry-presence`** — a timer, a process-lifecycle handler or a `ctx.onBoot` hook that
    nothing can catch a throw from must decide the module's presence before it works. The rule is
    unconditional; a `nonDeactivatable` manifest exempts the boot hooks and not the timers.
    `@endora-commerce/cli/rules/entry-presence.js` exports `checkEntryPresence`,
    `findUngatedEntries`, `collectPresenceFiles`, `keyOf`, `remedyFor`, `bootHookDoesWork`,
    `bootHookContributes`, `EXPLANATION` and the finding types.

  `checkEntryPresence(input, ledger)`'s second argument is **required**: a host states which
  exemptions it is judging against rather than inheriting whichever ledger the library carried.
  - **`check:port-catches`** — a `catch` around a gated-port call may not swallow
    `ModuleDisabledError`. `@endora-commerce/cli/rules/port-catches.js` exports
    `checkPortCatches`, `findPortCatches`, `collectPortCatchFiles`, `keyOf`,
    `resolvedPortNames`, `lockedOwners` and the site types.
    `checkPortCatches(input, ledger)`'s second argument is now **required**, and
    `PortCatchInput` gains `peerOwners` — the gated port names the subject's peers
    provide. Without it the analysis admits nothing a _consuming_ package wrote:
    measured over this repository, 31 of the 41 packages with sites saw every one
    of them disappear when analysed alone.

  `@endora-commerce/cli/checks` additionally exports `readPeerOwners`,
  `NO_PEER_OWNERS` and the `PeerOwners` / `UnreadablePeer` types — what a package's
  installed and workspace peers own, read synchronously out of their emitted
  artefacts. It is the input Phase 3's owner-map rules share.

### Patch Changes

- 0515a1b: A module package may publish its own test support, on a new `./test-support` subpath

  Eleven vendor test doubles — the scripted Ergonode, UnoPim, Comarch XL, Infakt and wFirma
  clients, the three scripted media fetchers, the two webhook signers and the XL installation
  fixture — moved out of `backend/test/helpers/` into the packages whose protocols they encode.
  Each is now published at `<package>/test-support`, which is the first consumer-visible change:
  a specifier that was a relative path into an application's test tree is a bare one.

  The tables a module's tests need emptied travel the same way. `pim_pimcore`, `pim_ergonode` and
  `ksef` declare their own `volatileTables`, and `@endora-commerce/test-kit/support` gains
  `collectVolatileTables` to merge them — refusing two modules that claim one table, and any name
  that is not an unquoted identifier, because the collected set is interpolated into a
  `truncate … cascade`.

  `@endora-commerce/cli`'s command-coverage rule prunes the new layer from its walk. A fixture
  writer is not a service write, for the same reason a migration is not.

- Updated dependencies [b413e2d]
  - @endora-commerce/contracts@0.13.0

## 0.11.0

### Minor Changes

- 919afc0: `check:queue-names` — a BullMQ queue name may not contain `:`.

  **`@endora-commerce/cli`** adds `rules/queue-names.js`: the analysis behind the new
  `check:queue-names`, plus its `endora check` package-scope host and its estate entry. A site is
  `new <Binding>(<arg0>, …)` where the binding is what the file imported from `bullmq` (alias
  followed) and the class is one whose first constructor parameter is the queue name. `arg0`
  resolves as a literal, as a `const` in the same file, or as a `const` imported one hop over a
  relative specifier; anything else is an unresolved site, counted in the read line and never
  judged. One finding, `colon-in-queue-name`, and no ledger — a ledgered colon is a queue that
  cannot be constructed. The rule is the colon alone; the repository's broader
  `<module_id>.<verb>` convention is deliberately not enforced.

  **`@endora-commerce/mod-comarch-xl`** renames its three queues from `comarch_xl:detect`,
  `comarch_xl:sync` and `comarch_xl:shop-export` to the dot spelling every other module already
  uses. BullMQ owns `:` as its Redis key-namespace separator and refuses such a name in
  `new QueueBase` before it reaches Redis, so the module's worker start threw, its plugin never
  finished loading and the backend never listened — and the same throw landed in the activation
  control's gate-off phase, so an operator could not switch the module off either. No queue had
  ever been constructed under the old names, so no data migration is needed.

### Patch Changes

- aa12ebf: `endora check`'s estate manifest gains a row for `check:root-dispositions`, the
  rule that refuses a top-level repository entry carrying no recorded disposition.

  It is `repository-only`, and here that claim about the rule's _subject_ is
  unusually literal: a module package holds no root entry of its own — it
  contributes paths under `packages/` — and the question the rule asks has already
  been answered for anything a consumer installed from a registry. The row exists
  anyway because the manifest is not a curated subset: a rule that can never run
  for a package is printed with its reason rather than left absent, which is what
  stops `endora check` becoming a list somebody updates or does not.

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0

## 0.10.0

### Minor Changes

- c7b3512: A scaffolded instance now carries a **runnable** development environment, and the operator CLI
  stops printing a command line that resolves to a different program.

  **`@endora-commerce/cli`** — `endora new instance` writes `compose.dev.yml` at the instance
  root: PostgreSQL, Redis, Meilisearch and Mailpit, started with
  `docker compose -f compose.dev.yml up -d --wait` in a tree whose `.env` has never been opened.
  Everything under `deploy/` pulls images the client has not built yet, so those three services
  were theirs to provision by hand. The new file is rendered from the **same** service catalogue
  the production examples are rendered from, so no second statement of what Endora needs to run
  enters a client's tree. Two new exports on `new-instance/deploy.js`: `developmentComposeFile`
  and `undefaultedExpansions`, plus `DEV_COMPOSE_PATH`.

  **`@endora-commerce/platform`** — `./cli` replaces the `CLI_USAGE` constant with
  `cliUsage(program?)` and `DEFAULT_CLI_PROGRAM`, and `dispatchCli`/`runCli` take a `program`
  option. The constant opened `usage: endora <module id> <command>`, and in a scaffolded instance
  `endora` on the path is the scaffolder — a different program, with no `demo` verb and no
  `<module id>` positional. The default is now `pnpm run cli`, which is what an instance's own
  next-steps block prints. `demoHelpFor(verb, program?)` takes the same parameter.

- 040617b: `endora install <dir>` — one command from nothing to an installed Endora Commerce.

  It composes `endora new instance` and `endora new storefront` and reimplements neither: it
  writes the instance, writes the storefront beside it as a sibling, derives the instance's
  `.env` from the `compose.dev.yml` the same run rendered, and then runs the sequence that block
  prints — `pnpm install`, `dev:services`, `setup`, `admin:create` and, when asked, `cli demo
seed`. Every step is echoed before it runs, a failing step exits with **its own** code and
  prints the remaining steps as a resumable list, and the seeding is the one step whose failure
  does not fail the install.

  **It never prompts**, and that is the whole reason this half could ship now: a command that
  asks nothing is under `cli-product.md` R2.5c's ceiling by construction, so the pipeline needed
  no amendment. The wizard is a later phase.

  Preconditions are decided completely before anything is written and reported in one refusal:
  the target directory, Node's version, a package-manager runner (`pnpm` on `PATH`, then
  `corepack pnpm@latest` — never `corepack enable`), a reachable Docker daemon unless
  `--no-services`, a reference storefront unless `--no-storefront`, all four administrator
  answers and the demo answer, which has deliberately no default.

  `REVALIDATE_SECRET` is generated **once** and written into both trees — the one value no
  sequence of the two existing commands can agree on.

- e647ea4: The root scripts that drive the development environment, and a next-steps block that is four
  lines shorter than the sequence it replaces.

  `endora new instance` now declares `dev:services` and `dev:services:down` (the `compose.dev.yml`
  this command writes, with `--wait` so `migrate` cannot race an initialising Postgres), the
  composite `setup` — `generate && build && migrate && module:install --all`, derived from those
  named root scripts rather than spelled out, so a change to one of them reaches it with nothing
  edited — and `preview:admin` with the admin member, which serves the bundle `build:admin`
  produced and which no root script and no printed step had ever named.

  `nextSteps()` takes a fifth argument, an options object carrying whether the admin member was
  written, the addresses read off the rendered `compose.dev.yml` and the mail catcher's URL. The
  block prints the services step first, names what `setup` runs so any step can still be taken by
  hand, and prints the development addresses rather than writing them — writing them into `.env`
  is FR-105 and waits on a ruling. `endora new storefront`'s block gains `pnpm run start`, which
  that manifest has declared all along and which was printed nowhere.

- d18aaaa: `endora new instance` closes its module set over `acknowledgedDependencies` as well as
  `dependencies`.

  The two spellings differ in one thing only — `acknowledgedDependencies` withdraws the install
  **ordering** a `dependencies` entry claims, for an edge whose ordering would close a cycle.
  `assertLockedModulesPresent` makes no such distinction: a module named in either array that the
  deployment does not ship raises `ReducedDeploymentError` out of `loadModulePresence`, before
  anything listens. So a scaffolded instance could be written with a set the platform then refused
  to boot, and was: `carts` names `promotions` through two ports, `promotions` was not in the
  derived set, and neither `pnpm run start` nor `pnpm run admin:create` got as far as a database.

  If you scaffolded an instance before this and it refuses to boot with `ReducedDeploymentError`,
  `pnpm add` the module the message names and run `pnpm run migrate && pnpm run module:install
--all`. A new instance needs nothing: the set it writes now contains it.

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [0eeb9b5]
  - @endora-commerce/contracts@0.11.0

## 0.9.1

### Patch Changes

- 08dcbd9: An instance's five `module:*` entry points share a fourteen-line `runtime.ts`
  instead of a ninety-line one. `instanceOperatorRuntime` and
  `runInstanceOperatorCommand` are new on `@endora-commerce/platform/lifecycle`
  and hold the manifest resolution, the lazily opened `MikroORM` + `Redis` and
  the system scope that `endora new instance` used to render into a client's
  tree; the instance supplies the directory holding `apps/` and its own
  `mikro-orm.config.js`, and nothing else. `instanceManifestEntries` is exported
  with them and `cli/dispatch.ts` now reads it instead of carrying a second copy
  of the same three suppliers.

  R1.4's wiring budget goes from 248 lines over thirteen files to 176, which is
  what takes A14 of the instance acceptance criterion under the 250-line bound in
  `registry` mode, where the `.npmrc` puts eleven more lines in the count.

- Updated dependencies [5bfefe0]
  - @endora-commerce/contracts@0.10.0

## 0.9.0

### Minor Changes

- 471defd: A scaffolded instance's `.env.example` declares everything that instance reads,
  and the `.env` beside it is the file a client actually edits.

  `endora new instance` wrote a `.env.example` carrying the **five build inputs**
  and nothing else, while the platform declared 23 runtime inputs and nine module
  packages declared nineteen more. The instance acceptance criterion had been
  reporting the gap in its own output for weeks — _"supplied `DATABASE_URL`,
  `REDIS_URL`, `SESSION_COOKIE_SECRET`, `PUBLIC_API_BASE_URL`, `NODE_ENV` to the
  instance's own processes; its `.env.example` declares none of them, so a client
  who fills in the file the command wrote has nothing to put them in"_.

  The file is now derived, never listed: the **resolved platform's**
  `PLATFORM_ENVIRONMENT_INPUTS`, unioned with the `env` of every module manifest
  the run installed, scoped to the members it wrote, each entry carrying that
  declaration's own `describes` and its `requirement` sentence rather than a
  rewrite. A different `--module` set is a different file with nothing edited.

  Three further changes make the file reach the process that needs it.
  - **A `.env` is written**, holding the secrets the run generated
    (`cli-product.md` R2.5d — the `generable && secret` class, four of them over
    the default module set) and a **commented-out** placeholder for every other
    declared input. Commented, because Node's `--env-file` reads `NAME=` as the
    empty string and the platform's `??` fallbacks treat that as a value: a file
    of blanks turned twenty *unset*s into twenty empty strings and the acceptance
    run's health route answered 503 over a search engine that was running. A
    `.env` the operator placed there first is merged into, never rewritten.
  - **Every `node` script the backend member declares carries
    `--env-file-if-exists=../.env`.** Without it the file was inert: the root
    scripts are `pnpm -C backend run …`, so a `.env` at the root of the tree was
    read by nothing and a client who filled it in still could not start.
  - The next-steps block no longer says `cp .env.example .env`, which would now
    overwrite the generated secrets with empty strings.

  New in `@endora-commerce/contracts`: `unionEnvironmentInputs`, the join over
  several authors' declarations, first author wins. New in
  `@endora-commerce/cli`: `instanceEnvironmentInputs`, `declaredEnvironmentInputs`,
  `generableEnvironmentInputs`, `backendScripts`, and `parseEnvFile` /
  `renderEnvValue` / `writeEnvFile` re-exported from the package root.
  `ModuleCandidate` gains `env`, `PlanInput` gains `declared`, `existingEnv` and
  `generated`, `DeployInput` gains `declared`, and `loadModuleCandidates` returns
  `{ candidates, platformEnv }` instead of the map alone — all four are breaking
  for a caller that constructs one of those shapes, and `major` is refused in a
  `0.x` series (D-225).

- e6f053a: An overlay module is a whole lifecycle participant, a wrapped `asValue` no longer kills the boot,
  and the divergence report attributes the deployment's own registrations.

  **`@endora-commerce/platform`**
  - `composeApp`'s default composition — the one an instance takes, having no generated manifest
    index — resolves overlay module **manifests** from the same root it composes overlay module
    **entries** from. It passed `overlay: async () => []` to `resolveManifestEntries`, so a
    deployment's overlay module reached the container, the permission gate and the presence
    projection and never `lifecycleManifestRegistry`: no `module_registrations` row from the boot
    reconcile, no activation Setting, and nothing for an operator to switch it off against. Both
    seams now come off one `overlayModulesUnder(root, claims)` reader, so the id-collision claim set
    is asserted once over one array.
  - `ctx.di.decorate` over a registration awilix marks leak-safe and gives no lifetime — which is
    exactly `asValue`, and exactly what a composition root's `registerValues` produces for
    `commandBus`, `auditLogService`, `eventBus` and `emFactory` — registers the wrapper
    `.singleton()` instead of asserting TRANSIENT. Wrapping any of those names used to boot until
    the first singleton resolved it and then throw `AwilixResolutionError: … has a shorter lifetime
than its ancestor`, which made D-156.4 a ruling sanctioning an operation that could not be
    performed. Every other inner resolver keeps the lifetime it had, and a wrap reaching for a
    genuinely scoped registration still throws.

  **`@endora-commerce/cli`**
  - `endora generate`'s owner map now includes the container names the deployment's own overlay
    modules register, merged per deployment and keyed from each source's own module id. A client
    decorating a name their own overlay module registered was attributed to nobody and drew an
    `unowned-subject` finding whose remedy text — "Composition throws for it at boot" — was untrue
    of a tree that had booted.
  - `endora generate` evaluates the report's refusals and exits 2 on one, instead of rendering a
    report over inputs it could not read.
  - A seam call in an overlay module written in JavaScript, or in TypeScript with no `ModuleContext`
    annotation, is read: the first parameter of an exported `registerModule` is a context receiver,
    which is the loader's own contract rather than a naming convention. Such a client used to get a
    clean report over a tree full of decorations.
  - A new refusal: a rendering that both lists `registration:<module>:<name>` and reports
    `unowned-subject` for `<name>` is refused rather than printed.

- 9f9b1b3: `check:env-inputs` judges the module tree. Its population was the three trees a
  running Endora is made of — the backend's sources plus the platform's, the
  storefront's, the admin's — and every run printed the bound it could not reach:
  `not judged: 74 module packages`. That line is gone, because the walk now answers
  for them.

  A read resolves against the platform's declaration, the application tree's, and
  **the reading module's own** — never another module's. Two findings for the two
  ways that goes wrong: `undeclared-module-input`, a module read nothing declares,
  and `module-declares-a-platform-input`, a module restating a fact the platform
  already owns.

  Two more for the Settings-debt ledger (FR-004):
  `module-input-without-a-settings-verdict` and `stale-settings-verdict`, over
  `backend/scripts/ledgers/module-environment-inputs/`.

  `evaluateManifestEnvDeclaration` and `loadModuleVerdictShards` are new exports of
  `@endora-commerce/cli/rules/env-inputs.js`; `EnvironmentRead` and `EnvSourceFile`
  gain an optional `module`, and `EnvInputsInput` an optional `settingsVerdicts`.
  Every addition is optional, so an existing caller compiles unchanged.

- bf58f33: `endora new instance` writes example deployment files, and takes `--topology`.

  A scaffolded instance was handed **no deployment file at all** — no compose file, no nginx
  configuration, no `.env` for a running stack and no Dockerfile — while
  `instance-repository.md` R2.1 listed three of them as always present. A client asked for the
  owner's three-host topology wrote three deployment files from scratch.

  It now writes a `deploy/` directory derived from two axes and nothing else: the resolved
  member set, and `--topology single-host|three-host` (default `single-host`, an unrecognised
  value exits 1 naming the vocabulary).
  - `single-host` — `compose.prod.yml`, `.env.example`, `nginx.example.conf`.
  - `three-host` — `three-host/compose.{backend,storefront,admin}.yml` with one
    `.env.<host>.example` each. Every stateful service is on the backend host; the one
    `depends_on` edge that crosses a layer boundary is dropped rather than translated, and
    nothing replaces it.
  - Both — `deploy/README.md` and an example `Dockerfile` per image, whose every `--build-arg`
    and `ARG` is emitted from `instance-build-inputs.ts` rather than written.

  The admin files are written only when the admin member is. The topology is recorded in no
  file and read back by nothing: it selects which examples are written and the machine layout
  stays the client's.

  `nextSteps` now takes an optional third argument, the topology, and prints one additional line
  under `three-host`. `PlanInput` gains a required `topology`; `NewInstanceOptions` gains an
  optional `topology` string.

  Normative: `specs/122-layer-deployment-independence/contracts/layer-independence.md` §3, under
  owner ruling D-230.

- 6bd9ae9: A scaffolded instance runs the operator commands its modules declare, and can create the
  administrator that logs in to it (`specs/123-oss-install-experience/` G2).

  **The defect.** `endora new instance` reported `backend/src/cli.ts` as an omission, on the written
  reason _"the demo layer around it is exported under no subpath"_. A client's instance therefore had
  **no module-declared CLI command at all** — no `admin_users create`, no `search reindex`, no
  `_i18n reload` — so the admin bundle acceptance assertions A5 and A13 prove is built and styled had
  nobody to log in as. Half of that reason had already been discharged: `./demo` has been a declared
  subpath since `specs/110-instance-repository/` T119b. What was still unpublished was
  `backend/src/cli/demo-command.ts`, which `test/unit/kernel/host-residue-partition.test.ts` had
  ledgered as platform-shaped residue with a `retiredBy` naming exactly this move.

  **`@endora-commerce/platform`** gains the dispatch on the subpath that already carried half of it.
  `./cli` adds `runCli`, `dispatchCli`, `cliFailureExitCode` and `CLI_USAGE`; `./demo` adds
  `DEMO_HOST_COMMANDS`, `demoEntriesFrom`, `isDemoInvocation`, `parseDemoVerb`, `demoHelpFor`,
  `formatHostCommandList`, `ShadowedHostCommandError`, `NO_DEMO_COMPOSITION_NOTICE` and the
  `DemoCompositionLoader` shape. **No subpath is added and `PUBLISHED_SUBPATHS` stays at five** — both
  are host-internal under D-160.14, a module naming either is still `host-internal-subpath`, and
  `check:platform-surface` is green with no ledger key moved.

  What did **not** move is what names a path in the tree that installs the platform, which is
  `operator-half.md` §1.1's whole partition: a build's generated core index, its own `composeApp`, its
  demo-composition probe and the one directory holding `apps/`. All four are parameters of `runCli`
  with defaults an instance can take, so this repository's `backend/src/cli.ts` supplies four of them
  and a scaffolded instance's supplies one and is five lines.

  **`@endora-commerce/cli`** writes `backend/src/cli.ts` — six lines, `kind: 'wiring'` — and the
  `omitted.push` block is deleted rather than reworded, because an omission whose reason has been
  discharged must not survive as prose. The instance's manifests gain `cli` (the generic pass-through:
  any installed module's declared command is addressable with no file in the tree edited) and, derived
  from the resolved module set rather than written, `admin:create` when `admin_users` is installed.
  `nextSteps()` gains the administrator step after `module:install --all` and the demo step its own
  docstring has claimed was there since D-216.

  **No `demo:seed` or `demo:reset` script is written**, and G2's T2-D asked for both. D-216 is the
  owner's and is more specific than the task: _"a client scaffolding an instance for their own trading
  receives no demo artefact in a tree they own: no composition, **no script**, no example and no
  placeholder"_ — and it names where the capability does belong, which is the next-steps block.
  `pnpm run cli demo seed` reaches both verbs, so nothing is unavailable.

  Proved end to end rather than at plan level. On a scaffolded instance installed from tarballs into
  `os.tmpdir()`, with no checkout of this repository anywhere and no symlink back:
  `pnpm run cli --list` enumerates the six commands its installed modules declare plus the two host
  demo verbs, `pnpm run admin:create` exits 0, and the row lands in `admin_users` with an argon2id
  hash, `status=active` and a `platform_admin` role holding `["*"]`. **A15 is added to the instance
  acceptance criterion and is green** — `POST /api/v1/auth/admin/login` answers 200 with the admin
  session cookie set. It needed this change _and_ `fix/instance-500-pipeline`, which landed the same
  day, and it is the only assertion that measures their conjunction. Re-measured once more after
  feature 121 merged, the criterion reads `pass=11 fail=0 unmeasured=4 of 15` — no red at all. A15
  also corrects a premise
  three documents carry: the route is `/api/v1/auth/admin/login`, and `/api/v1/admin/auth/login`,
  which `research.md` §4.3/§4.4 and A4's own reason all name, is registered by nothing.

  Wiring cost, re-measured rather than computed from a delta: **237** lines over 12 files on the
  plan without the admin member, and **248 over 13 files on the created tree** with it, against
  R1.4's bound of 250 — two lines of headroom left.

- 5b808ea: `endora new instance` names the per-layer builds in the tree it writes. The root manifest gains
  `build:backend`, plus `build:admin` and `build:docs` for the members that were written, and the
  composite `build` is now the conjunction of exactly those entries — same value as before, in the
  same `backend, admin, docs` order, derived from one list rather than spelled a second time.

  Under D-230 the backend, the admin and the storefront are deployed to hosts of their own, on
  schedules of their own; a CI job on the admin host could not cite a command it had never been
  told, because the per-member commands existed only inside the composite's value.

  The emitted `README.md`'s command block is now rendered from the root manifest's own `scripts`,
  so it names every command the tree declares and no command it does not — `dev`, `module:status`
  and the three per-layer builds were all absent from it before.

  Normative: `specs/122-layer-deployment-independence/contracts/layer-independence.md` §2 R2.1.

- c63d640: `endora new instance` writes a documentation member, and `endora generate` renders its
  artefacts.

  **New exports.** `@endora-commerce/cli/lib/docs-artefacts.js` carries the documentation
  renderers — `docsRegistryOf`, `renderDocsSidebarFrom`, `renderModuleMapFrom`,
  `renderModuleReferencesFrom`, `collectDocsIntoSiteFrom`, `installedDocsModules` and the
  emitters underneath them. They were `backend/scripts/generate-composer.ts`', which no client
  can reach; the population is now a parameter and one program serves both hosts, exactly as
  `lib/admin-artefacts.js` does for the admin pair. `lib/module-packages.js` gains
  `publishedManifestEntryOf`, and `new-instance/docs-toolchain.js` exports `DOCS_TOOLCHAIN`.

  **Changed signature.** `runGenerate` is now `async` and returns
  `Promise<GenerateResult>`; the result gains `omitted`, `collected` and `swept`. A caller
  awaiting it needs no other change. An instance with an admin project but no documentation site
  — or the other way round — is now an **omission** the command names rather than a refusal; only
  a tree with neither member exits 1.

  **New behaviour.** A scaffolded instance gains a `docs/` member (four files: the manifest, a
  Docusaurus configuration, a sidebar and an intro page), the root `generate` script becomes
  `endora generate` rather than a forward to the admin member, and `build` reaches every member.
  `GENERATED_TREES` names the directories a client's `.gitignore` has to cover.

- ee80d6b: The divergence report can be rendered for an instance.

  `@endora-commerce/cli/lib/divergence.js` and `@endora-commerce/cli/lib/divergence-artefacts.js`
  are new subpaths carrying the derivation, the two renders and the assembly between them; they
  were `backend/scripts/lib/divergence.ts` and `backend/src/overlay/divergence-report.ts`, which
  no consumer outside this repository could reach.
  `@endora-commerce/cli/lib/registration-owners.js` moved with them.

  `endora generate` now renders `apps/<deployment>/divergence.generated.md` and `.json` beside
  the three artefacts it already wrote — one per deployment the instance holds. **Unlike the
  other three it is committed**: it is derived from the deployment's own overlay tree and its
  `divergence.ts`, so it is a fact about the client's repository rather than about their install,
  and the diff is where an upgrade that changes behaviour they depended on shows up.

  New exports on `lib/divergence-artefacts.js`: `renderDivergenceArtefacts`, `instanceComposition`,
  `readDivergenceDeclaration`, `seamsFromKernel`, `overlaySourcesUnder`, `walkAnalysableSources`,
  `overlayTreeSpellsASeamCall`, `INSTANCE_BOUNDARY_NOTES`, `unreadableCompositionReason`, and the
  two default artefact headers. `lib/port-registrations.js` gains `rootRegisteredNames`, the
  composition root's own registration spelling — `registerValues(container, { … })`,
  `container.register({ … })`, `composedModules.contribute({ … })` — which is a different
  predicate from `registeredNames` and is what tells _a root registers it_ from _nobody
  registers it_. `DivergenceInput` gains two optional fields, `hostNotRecorded` and
  `declarationPath`, both defaulting to what the derivation did before. `serializeDivergenceModule` and `renderDivergenceMarkdown` each
  take an optional trailing `header` argument; both default to what they emitted before, so no
  existing call changes what it produces. `lib/module-packages.js` gains
  `scanInstalledPlatformPackage`.

  An instance's report records all nine kinds exactly as this repository's does. What it cannot
  derive — the module behind a container name a composition root registers on that module's
  behalf — is written into the report's own `boundary.notRecorded` rather than left silent.

- a71344d: `endora new instance` writes the admin member, and `endora generate` renders what it is built from.

  **`@endora-commerce/cli`** — two new surfaces and one moved one.
  - `endora generate` is a new command. Run anywhere inside a scaffolded instance, it renders the
    admin contribution registry and the admin stylesheet enumeration over the module packages that
    instance installed, and reports every candidate the discovery excluded. Programmatically:
    `runGenerate({ cwd, dryRun })`, with `generateReport`, `findInstanceRoot`, `artefactIsCurrent`,
    `GenerateInputError` (exit 1) and `GenerateHostError` (exit 2).
  - `endora new instance` now writes `admin/` — `package.json`, `tsconfig.json`, `index.html`,
    `vite.config.ts`, `src/main.tsx` and `src/index.css` — and the workspace, the root scripts and
    the `.gitignore` follow. The member is still omitted, in the same grammar, when
    `@endora-commerce/admin-shell` or `@endora-commerce/admin-kit` does not resolve, or when a range
    one of them should have declared is not there; the omission now names which.
  - `@endora-commerce/cli/lib/admin-artefacts.js` and `@endora-commerce/cli/lib/tailwind-sources.js`
    are new module specifiers. They hold the two artefacts' renderer, which this repository's
    `composer:generate` and a client's `endora generate` now share; the emitted bytes are unchanged.

  **`@endora-commerce/admin-shell`** — `AdminRoot` is a new export: the four wrappers `App` has to be
  mounted inside, which a project used to have to reproduce. Three of the four are this package's
  requirements rather than the project's, `unstable_useTransitions={false}` most of all — without it
  every module screen's URL changes and the outlet does not, with no error anywhere. `App`,
  `AuthProvider` and `registerAdminServiceWorker` are unchanged and still exported.

  The package now declares `vite`, `@vitejs/plugin-react`, `tailwindcss` and `@tailwindcss/vite` as
  **optional** peer dependencies. Nothing is required of an existing consumer that already has them;
  what they add is a statement, readable by a tool, of what kind of application a host that mounts
  this shell is.

  **`@endora-commerce/mod-settings`** — `ConfigurationReferenceInput` loads
  `@endora-commerce/mod-credentials`' preview modal lazily. `credentials` is an optional peer, so an
  admin bundle built in a tree that did not install it previously failed at build time on a named
  import of an unresolved stub, taking every module's screens with it over one button. The render was
  already gated on the module's presence and is unchanged.

- 3411727: `relativeLinksIn` now reports whether a link left the modules category.

  `RelativeLink` gains `leavesCategory: boolean`. `docId === null` alone did not
  say this: a link that climbs above the category (`../architecture/x.md`) and a
  link that resolves to the category root both came back with no doc id, and a
  consumer could not tell them apart. The first names a page only the host
  repository's own site tree has and is broken in every instance; the second names
  a page the generator writes into every instance.

  Consumers reading the field: none is required to. Existing code that reads
  `target` and `docId` is unaffected; code that constructs a `RelativeLink`
  literal must add the field.

### Patch Changes

- 670851a: `endora new instance` declares each `@endora-commerce/*` package at **that package's own**
  version, not at the platform's.

  Every module entry in the scaffolded root `package.json` was written as `^<platform version>`.
  That is correct only while a release moves every package together, and a release does not: of the
  packages published on 2026-09-11, 68 moved to `0.8.0` and 15 to `0.7.1`. A tree scaffolded from
  such a release asked a registry for a version that does not exist, and the first `pnpm install`
  in it failed:

  ```
  ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @endora-commerce/mod-addresses@^0.8.0
  The latest release of @endora-commerce/mod-addresses is "0.7.1".
  ```

  The version now comes from the manifest of the package the command **resolved beside the target
  directory** — the same manifest, on the same install, that the platform will read when it composes
  that instance — so the tree a client gets back is pinned to what they already have. Nothing about
  the platform entry changes: it was, and remains, `^` over the platform's own version.

  **Regenerate a scaffolded instance, or edit its root `package.json`.** A tree written by an earlier
  build carries one range per module that may name a version its package never published; the ranges
  are the only affected file, and every other entry in the manifest is unchanged.

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [c1d281f]
- Updated dependencies [52c2bfd]
  - @endora-commerce/contracts@0.9.0

## 0.8.0

### Minor Changes

- 77772dc: New shared library `@endora-commerce/cli/lib/delegated-composer.js`: _"this
  composition root does not compose, it hands its composition to somebody — where is
  that somebody's source?"_

  A composition root used to be one file. Since feature 109's Phase 1c
  `backend/test/helpers/test-server.ts` supplies a `PlatformComposition` and
  `@endora-commerce/test-kit/server` performs the composition — `registerValues`,
  `composeModules`, the two Redis clients, the contribution window, the boot phase,
  `buildServer`. Every instrument whose subject is _what a root supplies_ therefore has
  to follow the delegation or start measuring half a composition, and the failure is
  silent in the worst direction: it reports the delegating root as registering nothing.

  Measured on the merge request that made the harness the kit's first caller,
  `check:port-dependencies` reported **16 root issues** — `redis`, `eventBus`,
  `commandBus`, `apiInterceptors`, `resolvedModuleRegistry` and eleven more "registered
  by production only" — every one of them a name the harness composition does register.
  Both remedies it printed were wrong: a `ROOT_DIVERGENCE_ALLOWED` entry states that the
  two compositions genuinely differ on that name, and _"register it in both roots"_ asks
  for something already done.

  `delegatedComposerOf(rootSource, rootPath, repoRoot, binding)` follows the specifier a
  root imports `binding` from back to that composer's **source** directory — through the
  workspace member's own `exports` map and its `tsconfig.build.json` emit layout, so no
  package name, no `dist` and no `src` is written down (D-100), and reading the artefact
  cannot hold a run to the previous build (D-164). `delegatedSupplyFields` reads which
  option field that composer spreads into its own `registerValues`, and
  `delegatedSuppliedNames` collects the names a root hands over through it — because a
  delegating root supplies its host values as _data_, which no call-shape reader sees.

  Five refusals, each an exit-2 for its caller rather than an empty answer, with
  `delegationRefusalMessage` writing the sentence: the binding is imported by nobody, no
  workspace member owns the specifier, the package declares no such subpath, no source
  under its `rootDir` emits the target, and the composer's directory holds no source.

- 211060c: `platform-surface` gains a second consumer population: the application's own
  relative reaches into the host package.

  The rule was already _a reach into the host names a published subpath or a
  declared host-internal one, never a file inside the package by relative path_.
  It was asked of **modules** only, and the consumer that writes the most such
  reaches — the application — was outside the population by construction:
  `moduleIdOf` answers `null` for every one of its files, so a `violations=0` was
  honest about a population that did not contain them. On this repository's tree
  that hid 84 reaches, every one of which resolves in the checkout and in no
  instance built from published packages.

  New exports on `@endora-commerce/cli/rules/platform-surface.js`, all additive:
  - `scanApplicationReaches(input)` and `checkApplicationReaches(input, ledger)` —
    the pure analysis, over source text, file keys, barrel-derived surface and the
    two platform roots, so a fixture enters where a run does;
  - `canonicalPlatformFile(joined, input)` — the canonicalisation. It drops the
    member-relative path's **first segment**, whatever it is, and re-roots the
    remainder at the platform's source root, so `dist/x.js` and `src/x.ts` are one
    key and the word `dist` appears nowhere in the analysis;
  - `applicationReachRefusal({ canonicalTargets, applicationFiles })` — the two
    exit-2 refusals this half owns, both of which fail in the direction that
    produces a clean result;
  - `hostReachCoverage(ledger, onDisk, opened)` — the `sources=host-reaches:<n>/<n>`
    floor, derived from the ledger rather than from a count, and `null` rather than
    `expected: 0` once that ledger empties;
  - `LedgeredHostReach` — `{ reason, retiredBy }`, with no `permanent` member: this
    ledger is expected to empty, and an entry saying "this reach is correct" would
    mean the predicate has outgrown its population.

  **Two changes to existing shapes, and both can break a consumer that writes the
  type rather than reading it.** `PlatformSurfaceFindingKind` gains
  `'relative-host-reach'`, so an exhaustive `switch` over it no longer covers every
  member; and `PlatformSurface` gains a required `publishedBy` field —
  `<target file>` to the barrels that publish it, the provenance the merge in
  `publishedSurface` was dropping. It is what turns a target into an address, so a
  remedy can name `@endora-commerce/platform/kernel` instead of saying only that
  the reach is wrong. A consumer that builds a `PlatformSurface` literal by hand
  adds the field; one that calls `publishedSurface` gets it for nothing.

  `PlatformSurfaceFinding` also gains an optional `publishedAs`, carried by the new
  finding and by nothing else.

  The estate entry for `check:platform-surface` gains a second `partial`,
  `application-host-reach`: an installed module package has no application tree, so
  this half has no subject there and is declared vacuous rather than counted zero.

  Normative: `specs/115-lifecycle-container-move/contracts/host-reach-check.md`.

- a6a9d30: `composeApp` is the platform's, and it takes a deployment's contributions as a callback.

  `@endora-commerce/platform/composition` gains `composeApp`, `ComposeAppOptions`,
  `ComposeAppHandle` and `ComposedAppContext`. It performs the whole assembly a deployment used
  to write out — refuse a boot with no `PUBLIC_API_BASE_URL`, open the ORM, build the container,
  register the host values, load module presence, compose the settings and sales-channel kernels,
  run `composeModules` once, open the contribution window once, install the request-scope hook,
  reconcile the settings manifests, run the boot phase once, assemble the error envelope — and
  returns a handle you pass straight to `buildServer`.

  Everything a deployment cannot share reaches it through options, and every one of them is
  optional:

  ```ts
  const composition = await composeApp({ deploymentRoot });
  ```

  is a complete composition of whatever module packages are installed. Supply
  `composition.modules` / `composition.manifests` / `composition.orm` when your build has
  compiled-in modules and committed registries, `contribute` for values only your deployment can
  supply, `values` for host names no module defaults, `buildTenantContext` for the actor mapping,
  `plugins` / `scopedPlugins` for route plugins on either side of the request scope, and
  `decorationOrder` / `declaredOmissions` for what your deployment's `divergence.ts` declares.
  Omitting `composition` entirely means "no compiled-in half", which is what an instance is: its
  modules, entities and migrations are the packages it installed.

  `contribute` runs **after** the twenty contributions the platform makes itself, so a deployment
  can still overwrite one; it runs inside the single contribution window (D-45, issue #52), so a
  contribution made after the boot phase has started still throws `ContributionWindowClosedError`.

  `AppComposition` and `AppOrmLifecycle` are exported from the module but deliberately not from
  the barrel: a caller builds those object literals without naming either type.

  `endora new instance` renders `composeApp({ deploymentRoot })` in the backend member's
  `index.ts` and `worker.ts`, with `deploymentRoot` derived from the entry point's own location —
  and renders no contribute callback, because a client's tree holds no composition root.

- ca43192: `EnvironmentInput` gains a required `addressOf`, and the CLI stops guessing which of a
  storefront's variables names a backend from the shape of the value.

  **Why.** Two programs ask _"which of these variables names the backend"_ — `endora new
storefront`, whose next step tells an author to point them at theirs, and that command's
  acceptance criterion, which does the pointing. Both answered it by reading
  `storefront/.env.example` for a value that looked like an absolute `http(s)` URL. That is
  right only while such a file declares no address but the backend's, and the reference
  storefront now declares its **own** public origin (`NEXT_PUBLIC_SITE_URL`) there — so the
  old predicate would have told a client, in a file they own outright and nobody revisits,
  that the shop's canonical origin "names the backend this storefront talks to".

  `addressOf` is a declaration of what a value **is**: which member of the instance it is
  the address of, or `null` where it is the address of none.

  **If you ship a declaration** — an application's `environment-inputs.mjs`, or the
  platform's — every entry needs the field. It is required rather than optional on purpose:
  an optional one is forgotten exactly once, by whoever adds the next address, in silence.
  Zod refuses a declaration without it at `loadTreeDeclaration`, so the failure is a
  sentence naming the entry rather than a variable that quietly stops being configured.

  ```diff
   {
     name: 'NEXT_PUBLIC_API_BASE_URL',
     requirement: { kind: 'required' },
     secret: false,
     generable: false,
     owner: { kind: 'application', application: 'storefront' },
     consumers: ['storefront'],
  +  addressOf: 'backend',
   },
  ```

  `null` is an answer and not an absence. A third party's address is `null` —
  `DATABASE_URL` and `REDIS_URL` are addresses, of a database and a cache, and neither is a
  member of the instance — and so is a value naming _several_ origins, `CORS_ALLOWED_ORIGINS`
  being the worked example: "the address of" is singular.

  **`@endora-commerce/contracts`** adds `addressVariablesFor(inputs, member)`, the one
  derivation both consumers take.

  **`@endora-commerce/cli`** replaces `backendAddressVariables(envExampleText)` with
  `addressVariables(declared, member)`, over a loaded declaration rather than over
  `.env.example` text. `backendAddressVariablesOf(dir)` keeps its name and its meaning and
  is now **async**, because it loads that directory's own declaration; there is a
  `storefrontAddressVariablesOf(dir)` beside it. `envExampleDeclarations` and
  `envExampleDeclarationsOf` are unchanged — the file is still the storefront's worked
  example of its _values_.

  ```diff
  -const names = backendAddressVariables(readFileSync('.env.example', 'utf8'));
  -const names = backendAddressVariablesOf(storefrontDir);
  +const names = await backendAddressVariablesOf(storefrontDir);
  ```

  `STOREFRONT_DOMAIN` also becomes a per-instance build input in
  `@endora-commerce/cli/lib/instance-build-inputs.js`, supplying the storefront build's
  `NEXT_PUBLIC_SITE_URL`. A pipeline rendered from that declaration gains one
  `--build-arg`; one that does not pass it builds a storefront whose canonicals, sitemap and
  `robots.txt` name `http://localhost:3000`.

  **`@endora-commerce/platform`** only annotates its own twenty-one declared inputs; no
  exported behaviour changes.

- fd7db00: Added the environment-input declaration, and the four-tier input resolution every
  scaffolding command now shares.

  **`@endora-commerce/contracts`** publishes the shape:
  `EnvironmentInput`, `EnvironmentInputSchema`, `EnvironmentInputsSchema`,
  `EnvironmentConsumer` / `ENVIRONMENT_CONSUMERS`, `EnvironmentRequirement`,
  `EnvironmentInputOwner`, `LocalizedSentence`, and three predicates —
  `isReadByAnyOf`, `scopeToMembers` and `isRequiredGiven`. One entry per environment
  variable a running platform reads: what it configures, in both shipped languages;
  whether it is `required`, `requiredWhen` another input holds a value, or `optional`
  with a sentence saying **what is lost**; whether it is a secret; whether a command
  may generate it; who owns it; and which trees read it.

  There is deliberately **no `default` field**. A declaration that could carry one
  would become another home for an invented value, which is what the provenance line
  below exists to make impossible.

  **`@endora-commerce/platform`** declares the 21 inputs the host and the platform
  read, on a new `./env` subpath:

  ```ts
  import { PLATFORM_ENVIRONMENT_INPUTS } from '@endora-commerce/platform/env';
  ```

  The subpath is host-internal — declared, resolvable by a CLI and by the host, and
  nameable by no module. A module declares its **own** inputs in its manifest, and the
  shape it does so in is `@endora-commerce/contracts`'.

  **`@endora-commerce/cli`** resolves those inputs, in one fixed order that is not
  configurable: an explicit `--<input>` flag, then a `.env` already placed in the
  target directory, then an interactive prompt, then a refusal. `endora new
storefront` takes it first, and writes the answers into the copy's own `.env`.

  Three properties are contract rather than behaviour:
  - **the tool invents no value.** Every run prints one provenance line —
    `[inputs] resolved: total=5 flags=5 env-file=0 prompted=0 generated=0 defaulted=0`
    — whose `defaulted` count is the _residue_ of the four tiers rather than a counter
    nothing increments, so a value from outside them shows up in the arithmetic
    instead of disappearing;
  - **no command blocks on a question nobody can answer.** A prompt is issued only
    when stdin and stdout are both TTYs, `--non-interactive` and `--dry-run` are
    absent and no CI marker is set. Otherwise a missing required input is exit `1`
    naming **every** missing input and the flag that supplies each, in one refusal;
  - **the one class of value a command may generate is a cryptographic secret** whose
    declaration marks it `generable` — written into the target's `.env` where the
    operator can read it, named in the provenance line, and printed nowhere.

  **If you call `runNewStorefront` directly**, it now resolves inputs and will refuse
  a run that has none and cannot ask:

  ```diff
  -await runNewStorefront({ dir: target, cwd });
  +await runNewStorefront({
  +  dir: target,
  +  cwd,
  +  inputs: { NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com', /* … */ },
  +});
  ```

  `MissingInputsError` is the refusal; `DeclarationLoadError` is a tree whose
  declaration could not be read, which is exit `2` rather than `1`. A target
  directory holding nothing but a `.env` is now accepted, which is what makes the
  second tier reachable for that command.

- 51a5fae: Two derivations for an instance's build-time artefacts (`specs/110-instance-repository/`
  Phase 1).

  `installedModulePackages(instanceRoot)` and `scanInstalledModulePackages(instanceRoot)` answer
  "which module packages did this instance install" over a `node_modules` tree, alongside the
  existing `discoverModulePackages(repoRoot)`, which answers it over workspace members. Both
  produce the same `ModulePackage` shape and share one `exports`-map derivation of how an
  artefact names a file inside a package, so a generator can render the admin contribution
  registry and the documentation navigation over either population without a second
  implementation. A candidate whose real path leaves the `node_modules` it was reached through —
  a `pnpm link`, a `link:` dependency, a workspace member — is excluded and **reported**, which
  is the rule the running platform already applies.

  `INSTANCE_BUILD_INPUTS` (`@endora-commerce/cli/lib/instance-build-inputs.js`) declares the four
  per-instance build inputs — `DEPLOYMENT`, `API_DOMAIN`, `SALES_CHANNEL_CODE`, `DEFAULT_LOCALE` —
  with each input's meaning, example, default and the build argument each image reads.
  `buildArgFlags(target)` emits the `--build-arg` flags one image build takes.

- 6521134: Make a scaffolded instance able to migrate, compose and install its own module set.

  **`@endora-commerce/cli`.** `endora new instance` wrote every root script as
  `pnpm --filter backend run <x>` while the member it delegates to is named
  `<name>-backend`: pnpm matched no project, printed `No projects matched the
filters` and exited **0**, so `migrate`, `build`, `start`, `dev` and the five
  `module:*` scripts were silent no-ops. They are now `pnpm -C backend run <x>`,
  which names the directory `pnpm-workspace.yaml` declares and exits 1 when the
  directory or the script is missing. The five generated `module:*` entry points
  now close the ORM and Redis handles they open and exit — they previously printed
  their answer and hung forever — and run inside a system scope, as the host's own
  scripts do. The next-steps block and the generated README now name
  `pnpm run build` and `pnpm run module:install --all`, the two steps a client
  needs and was not told about.

  **`@endora-commerce/platform`.**
  - `configuredEntitiesFrom` and `discoverConfiguredMigrations` now merge the
    platform's **own** six entity classes and twelve migrations, published as
    `PLATFORM_ENTITIES` and `PLATFORM_MIGRATION_ENTRIES` on `./db`. A host that
    already names them — this repository's generated registries do — is unchanged:
    the merge is an identity de-duplication over the same objects. An instance
    supplies `coreEntities: []` and `coreEntries: []` and previously therefore ran
    none of the platform's own schema.
  - `resolveManifestEntries` and `composeApp`'s default composition now contribute
    `_lifecycle`, whose sources are this package's. An instance ships no generated
    manifest index, so it composed `_lifecycle` nowhere and its boot refused with
    `not-shipped: _lifecycle`.
  - `composeApp` now contributes a default `lifecycleManifestRegistry`. Both
    composition roots in the Endora repository override it; an instance supplies
    no contribute callback, so the name resolved to nothing and the boot died in
    `_i18n`'s bundle reconcile.
  - `module:install` accepts **`--all`**: every registered module that is not
    already installed, in the dependency order `ModuleDepGraph` computes. An
    instance's modules are installed packages, whose `module_registrations` rows no
    boot writes, and the single-module command refuses on unmet dependencies —
    so there was no performable way to install a scaffolded set.
  - `PackageSchemaContribution` gains a required `dependencies` field, read from
    the package's own manifest. `configuredMigrationsFrom` used to fall back to
    `[]` for any module id the host's committed index did not carry; in an
    instance that is every module, so the per-module migration order degenerated to
    the tie-break. Construct one and you must now supply the field.
  - `CORE_MODULE_ID` is declared in `./db`'s `platform-schema.ts` and re-exported
    from its previous home unchanged.

- 304f6d8: **`@endora-commerce/platform` gains a `./lifecycle` subpath, and it is not public API** (D115-4; `specs/115-lifecycle-container-move/contracts/operator-half.md` §5).

  It carries `_lifecycle`'s operator surface — the orchestrator and its `LifecycleError`, the lifecycle lock, the dependency and gating graphs, the deactivation ledger, the manifest loader, the static registry, the presence loader, the module origin helpers, the module's own `registerModule`, `manifest` and admin routes. The set is derived rather than curated: it is exactly the fourteen platform-lifecycle files the application reaches today by relative path into `packages/platform/dist/`, so every one of those reaches has an address to be written as instead.

  **Nothing became public API.** `./kernel`, `./http`, `./tenancy`, `./commands` and `./events` are unchanged, and `PUBLISHED_SUBPATHS` stays at five. `./lifecycle` joins `./composition` and `./migrations` as **host-internal**: declared by the `exports` map, so the host, its five `module:*` entry points and the test kit resolve it, and carried by no published barrel, so `check:platform-surface` reports a module naming it as `host-internal-subpath`. **No module may name it** — this surface drives the platform's presence axis, and a module that could name it could install, uninstall, enable or disable its siblings. A symbol graduates to a public barrel in the merge request that first gives it a module-package production consumer, and leaves this one in the same merge request.

  `@endora-commerce/cli` publishes `HOST_INTERNAL_SUBPATHS` from `lib/platform-surface.js`: the host-internal class as a record of subpath → the reason it is not public API. It was a literal inside one assertion, then a bare set duplicated across two test files with the reasons in the prose of one of them. **If you enumerate the host's subpaths**, read `HostPackage.declaredSubpaths` for what the manifest declares and this record for which of them are host-internal; the published five stay `PUBLISHED_SUBPATHS`. Nothing is removed and no signature changes.

- 39e17ce: `endora new instance <dir>` — the command that writes an instance repository.

  New export `runNewInstance(options)` from `@endora-commerce/cli`, with
  `InstanceHostError` / `InstanceInputError` (each carrying the refusal class its
  exit code is read off), `resolveInstanceHost`, `loadModuleCandidates`,
  `resolveModuleSet` and `planInstance`.

  It writes a workspace whose root `package.json` **is** the module list, a
  deployment directory and a backend member of entry points, and copies nothing —
  so unlike `endora new storefront` there is no rewriting step and no outward
  reference to repair. With no `--module` it writes the smallest set that composes
  (the modules whose manifest declares `activation.nonDeactivatable`, closed over
  the manifests' own `dependencies`); with `--module <id>` it writes that set
  unioned with its closure. `--deployment <name>` names the deployment directory,
  `--registry <url>` writes an `.npmrc` naming the scope with the token as an
  environment reference, and `--dry-run` reports every file, the resolved set with
  its closure and every omission while writing nothing.

  Everything it needs is derived from what a client's machine can see: the scope
  and `engines.node` from this package's own manifest, the ranges from the
  `@endora-commerce/platform` installed beside the target, the module manifests
  from the packages themselves. It refuses in eight classes — an occupied target,
  an uncomposable set, an unknown module id and a bad deployment name at exit `1`;
  an unreadable registry, an unresolvable platform version, an unreadable package
  manifest and an undeterminable CLI version at exit `2`.

  The admin member and the host CLI dispatcher are reported as omissions rather
  than written: the first is `contracts/instance-tree.md` §2.4's, the second has no
  published entry point until that feature's Phase 2 lands.

- dcface9: Complete the host-internal `./composition` barrel, and give the demo-data layer
  `./demo`.

  Both are **host-internal** subpaths (D-160.14): they are declared by the
  `exports` map, so `node` and `tsc` resolve them for a composition root, a host
  CLI and a test kit — and they are not public API, so `check:platform-surface`
  answers a _module_ that names either one with `host-internal-subpath`.
  `PUBLISHED_SUBPATHS` is unchanged at five and no published barrel gains a name.

  **`@endora-commerce/platform`**

  `./composition` gains twelve names, every one of them a symbol
  `kernel/index.ts`' own header already enumerated as excluded — _"the composition
  machinery … and the errors they raise"_:

  ```ts
  import {
    registerErrorEnvelope, // http/error-envelope.ts
    parseTrustedProxy, // http/trusted-proxy.ts
    type TrustedProxy,
    ModuleCompositionError, // kernel/compose.ts
    type ModuleEntry,
    createModuleContext, // kernel/module-context.ts
    createModuleRegistrationSink,
    type ModuleRegistrationSink,
    AmbiguousDecorationError,
    ForeignDecorationError,
    PackageDecorationNotOfferedError,
    type AdminActorPromotion, // kernel/ports/require-admin.ts
    absolutizePublicUrl, // kernel/public-api-base-url.ts
  } from '@endora-commerce/platform/composition';
  ```

  `./http` carries `HttpError`, which is what a module _raises_, and not the
  registration that attaches the envelope to an app — a module owns no app to
  attach one to. `./kernel` carries `RequireAdminFactory` and
  `PublicApiBaseUrlNotConfiguredError`, which are what a module reads; the
  promotion hook and the absolutiser are what a root _supplies_.

  `./demo` is new. It carries `runDemo`, `unwrapDemoFailure`, `formatDemoReport`,
  `mustBeNonProduction`, `TEST_DATABASE_NAME_PATTERN`, `DEMO_SEED_SCOPE_REASON`,
  `DEMO_RESET_SCOPE_REASON` and the four types those name. `packages/platform/src/demo/`
  was the one platform directory with a barrel and **no subpath at all**, so its
  consumers reached `packages/platform/dist/demo/index.js` by relative path — a
  specifier that resolves in the monorepo and in no installed instance, which for
  this directory means a demo an instance cannot run.

  **The demo barrel exports eighteen fewer names than the directory declares**, and
  under `exports` that is not a removal: none of them was reachable from outside
  the package before, because there was no subpath. `planDemoRun`,
  `classifySeedTarget`, `createDemoPackageResolver`, `DemoRunFailedError`,
  `demoBodyFromPackage`, `DemoPackageShapeError` and the plan and run-result shapes
  stay internal until something asks for one by name. Adding a name back is not a
  breaking change.

  **`@endora-commerce/cli`**

  `HOST_INTERNAL_SUBPATHS` gains a `demo` member with its reason. The record is
  what `check:platform-surface` and `test/unit/kernel/published-surface.test.ts`
  both read, so a subpath cannot join the class without a written statement of who
  may name it and why.

- aa0a556: `declaredVariablesOf(storefrontDir)` — every variable a storefront's own process reads,
  off its own declaration.

  **Why a third derivation over the same file.** `backendAddressVariablesOf` and
  `storefrontAddressVariablesOf` answer _which of these names a member_, a subset chosen by
  `addressOf`. This one is the whole population, scoped with `scopeToMembers` to the member
  that runs there, and it is for a caller that **spawns** a storefront's toolchain rather
  than one that configures it.

  That caller exists, and the reason it needed this is worth stating: Next loads a `.env`
  and does **not** override a variable the process already carries. So any of these names
  present in a parent's environment silently displaces the value written into the copy's own
  `.env` — and a harness that passed its environment on wholesale measures its own
  configuration while reporting on the command's.

  ```ts
  import { declaredVariablesOf } from '@endora-commerce/cli';

  const declared = await declaredVariablesOf('/tmp/instance');
  // -> the names this storefront's process reads, in declaration order
  ```

  The measured case was `NODE_ENV`. `endora new storefront`'s acceptance criterion inherited
  its own environment into the instance's install, build and boot; a CI job set
  `NODE_ENV=development` job-wide and correctly, for the **backend** it booted; and
  `next build` inlines `process.env.NODE_ENV` as `"production"` into the server bundle it
  emits while the render worker reads the real one — two copies of Next's vendored pages
  runtime, two `React.createContext()` calls, and an `<Html>` looking for a provider
  installed on the other one. The build failed with
  _"`<Html>` should not be imported outside of pages/\_document"_, which names nothing true,
  in every CI run that criterion has ever had. Nothing of this repository's is involved: a
  four-file `app/` fails identically. What the repository _can_ do is stop handing a client's
  build an environment that is not the client's, and this is the derivation that makes the
  population the storefront's own declaration rather than a list of variable names somebody
  maintains.

  Additive. No existing export changes shape.

- 9e00c89: Publish the two derivations a caller needs to supply `endora new storefront` with
  the inputs it requires.

  Since the storefront's invented defaults went, the command resolves five required
  inputs in four tiers and refuses a non-interactive run that supplies none. A
  caller that has to _supply_ them needs the same population the command will
  _demand_, and deriving it a second time is two answers waiting to disagree —
  which is how this repository's own acceptance criterion came to invoke the
  command with no inputs at all.

  Three additions, all additive:

  ```ts
  import {
    storefrontDeclaredInputs, // the reference storefront's declaration,
    // scoped to the one member the command writes
    envExampleDeclarationsOf, // every declaration that copy's `.env.example` makes
    flagFor, // SESSION_COOKIE_SECRET -> --session-cookie-secret
  } from '@endora-commerce/cli';

  const declared = await storefrontDeclaredInputs(repoRoot);
  const example = envExampleDeclarationsOf(referenceDir);
  const argv = [flagFor('BACKEND_BASE_URL'), example.get('BACKEND_BASE_URL')];
  ```

  `storefrontDeclaredInputs` deliberately does not filter by requirement:
  `isRequiredGiven` reads a conditional requirement against the values a run has in
  hand, so which inputs are required is a property of the invocation rather than of
  the declaration.

  `envExampleDeclarations` / `envExampleDeclarationsOf` are the parser
  `backendAddressVariables` already ran, now named and exported —
  `backendAddressVariables` is defined over it, so the two questions asked of that
  file cannot come to disagree about what it says. One behaviour changes at the
  edge: a key whose **last** assignment is blank is no longer a declaration, in
  either answer. That matches `inputs/env-file.ts`, where a blank value does not
  resolve an input.

- d79a89f: `endora new storefront` now tells its author which variables the copy reads to find a
  backend, and exports the derivation that answers it.

  The step used to read _"set `PUBLIC_API_BASE_URL` (and the rest of `.env.example`) to the
  backend this storefront talks to. Nothing in the copy points at a backend."_ Both
  sentences were wrong. `PUBLIC_API_BASE_URL` is the **backend's** own variable — the public
  origin its payment-gateway callbacks are built from — and no file in the storefront has
  ever read it; and the copy does point at a backend, because every fetcher falls back to a
  compiled-in `http://localhost:3001` when the environment names none. So an author who
  followed the step had a storefront quietly talking to that address, with no error
  anywhere to say so.

  The step now names the variables the copy declares in its own `.env.example`, says that
  the fetchers fall back rather than refuse, and says which of them Next inlines at build
  time so they are set before `pnpm run build` rather than after.

  **New exports**, for a consumer that needs the same answer — the acceptance criterion for
  this command is the first:
  - `backendAddressVariables(envExampleText: string): readonly string[]` — every
    declaration whose value is an absolute `http(s)` URL, in declaration order. Pure over
    text.
  - `backendAddressVariablesOf(storefrontDir: string): readonly string[]` — the same answer
    read off a directory; a storefront with no `.env.example` answers with nothing rather
    than refusing.
  - `ENV_EXAMPLE_FILE` — the file name both read.

  Nothing is removed and no existing signature changes.

### Patch Changes

- 03dec57: `HOST_INTERNAL_SUBPATHS` gains `packages` and `overlay`, each with the sentence saying why it
  is not public API (`specs/110-instance-repository/` T113 and T114). Every consumer of
  `@endora-commerce/cli/lib/platform-surface.js` derives the two classes from this record, so
  `check:platform-surface`, `published-surface.test.ts` and `host-package.test.ts` all follow
  without a second list. `PUBLISHED_SUBPATHS` is unchanged: nothing became public API.
- 9eb0cb6: The static-check estate manifest gains `check:demo-data-budget` —
  `specs/113-module-owned-demo-data/` FR-016, a per-module budget on shipped non-`.ts` demo
  assets.

  `scope: 'package'`, tier `A`: a module's demo layer is located from that module's own
  manifest artefact and measured in that module's own source tree, so nothing about the
  answer needs a sibling, an owner map or an application.

  Its `host` is `pending`, and the phase is named rather than numbered because what a
  package-scope host waits for is neither of tier B's two halves. It is a **relocation**:
  _"does this file ship"_ has exactly one owner since D-218 —
  `scripts/lib/runtime-assets.mjs`' `classifyAssetFile`, the same function
  `copy-package-assets.mjs` and the manifest generator ask — and that file sits at the
  repository root, outside every package. A host here cannot reach it without a second copy
  of the classification, which is precisely the defect D-218 closed.

  Two `partial` signals are declared: the accepted per-module floors are this repository's
  ledger, and `undeclared-demo-assets` probes layer paths derived from _other_ modules'
  declarations, neither of which a lone package supplies.

- f05592f: `endora new instance` writes a backend that compiles.

  The template named three platform symbols that no barrel exports, three times each, so every
  scaffolded tree failed `tsc` on two of its ten backend files — a tree a client is meant to own
  and never to have written:

  ```
  src/mikro-orm.config.ts: TS2305 '@endora-commerce/platform/composition'
      has no exported member 'configuredEntities'.
  src/mikro-orm.config.ts: TS2305 '@endora-commerce/platform/composition'
      has no exported member 'configuredMigrations'.
  src/module-commands/runtime.ts: TS2724 '@endora-commerce/platform/lifecycle'
      has no exported member named 'resolvedManifestEntries'.
  ```

  The ORM configuration is now `configuredEntitiesFrom`, `discoverConfiguredMigrations` and
  **`mikroOrmConfigFrom`** on `@endora-commerce/platform/db` — the third name matters as much as
  the two corrected ones, because the file it replaces built its own `defineConfig`, which
  compiles and then creates tables under MikroORM's default naming with no `Migrator` extension
  registered: a tree that would have type-checked and failed at the first `pnpm run migrate`.
  The operator runtime assembles the `ManifestSources` that `resolveManifestEntries` takes, with
  `core: []` — an instance ships no generated manifest index, so its modules are its deployment's
  overlay modules plus the packages it installed — reaching `activeOverlayModulesRoot`,
  `overlayModuleIdsUnder` and `overlayModuleManifestsUnder` on `./overlay` and
  `discoverPackageModuleManifests`, `installedPackageModuleIdClaims` and `nodeModulesRootsFor` on
  `./packages`. It is the same shape the platform's own `defaultComposition` assembles.

  **If you scaffolded an instance with an earlier build**, re-scaffold into an empty directory and
  copy across `apps/<deployment>/` and any edits of your own, or replace those two files with the
  ones a current `endora new instance --dry-run` prints. Nothing else in the tree changed.

  The guard is `packages/cli/test/new-instance/template-reconciliation.test.ts`, which reconciles
  every platform name the template writes against the barrel carrying the subpath it writes it on.
  It is at symbol granularity deliberately: `./composition` and `./lifecycle` are both declared
  subpaths, so a reconciliation of the specifier alone passes over all three of the errors above.

- ec09593: `./cli` — the host's side of a module-declared operator command.

  Everything a `<module id> <command name>` invocation decides with no process and no
  database is the platform's now (`specs/110-instance-repository/` T117, FR-013): the
  enumeration of every command the resolved manifest set declares, the two refusals a
  declaration can earn, the lookup, the `--list` and `--help` renderings, and the
  find-gate-invoke that decides presence from the module that **declared** the command,
  first and outside every `try`. A client's copy of that is a copy that diverges the first
  time we correct ours.

  **`./cli` is a new host-internal subpath.** Declared by the `exports` map and carried by
  no published barrel (D-160.14), so `node` and `tsc` resolve it for a host and a
  composition root while a module reaching it is answered `host-internal-subpath` by
  `check:platform-surface`. The reason is `./composition`'s own, one surface over: this is
  the code that decides which command runs and whether the module that declared it is
  present at all, so a module that could name it could enumerate its siblings' operator
  commands and invoke one. A module declares its commands in its own `manifest.ts` and
  receives a `ModuleContext`; that is the whole of the surface it is entitled to.

  ```ts
  import {
    collectModuleCommands,
    findModuleCommand,
    formatCommandList,
    helpFor,
    runModuleCommand,
    InvalidCommandDeclarationError,
    UnknownCommandError,
    type CommandDeclaringEntry,
    type DeclaredCommand,
    type RunModuleCommandOptions,
  } from '@endora-commerce/platform/cli';
  ```

  **Nothing is removed and no signature changes.** `runModuleCommand` still takes the
  resolved manifest entries and the composition's own `contextFor`, so a host that already
  holds a `ComposeAppHandle` passes exactly what it passed before. What a host still writes
  itself is the **process**: reading `process.argv`, composing, opening one system scope over
  the composed container, disposing it, and turning the answer into an exit code. That is
  this repository's `backend/src/cli.ts` and an instance's own, because every one of those
  is a fact about a deployment's entry point rather than about the platform.

  **It is not the `module:*` path and must not become one.** Those five operate _on_ the
  platform, compose nothing (D-157.2/.4), and keep their own entry points over
  `@endora-commerce/platform/lifecycle`'s `commands/<verb>.ts`.

  `@endora-commerce/cli` takes a patch: `HOST_INTERNAL_SUBPATHS` gains `cli` with the reason
  it is not public API, which is what makes the estate's checks and
  `published-surface.test.ts` answer for the new subpath in both directions.

- 40e6e96: `./db` — the ORM configuration, the migration ordering and the bootstrap, plus the
  platform's own twelve migrations on `./migrations`.

  Everything between a committed registry and an open `MikroORM` is the platform's now
  (`specs/110-instance-repository/` T116, FR-013): a client's schema is not a client's to
  edit, and the code that decides which entity classes the ORM registers and which
  migrations run at all was in the application it now composes.

  **`./db` is a new host-internal subpath.** Declared by the `exports` map and carried by no
  published barrel (D-160.14), so `node` and `tsc` resolve it for a host and
  `check:platform-surface` answers a module's reach into it with `host-internal-subpath`. It
  carries `PluralizingNamingStrategy` / `pluralize` / `toSnakeCase`; `orderMigrations`,
  `historicalBaselineOrder`, `findModuleCycles`, `BASELINE_THROUGH`, `MigrationOrderError`
  and the ordering types; `configuredEntitiesFrom`; `configuredMigrationsFrom`,
  `migrationOwnershipOf`, `committedMigrationOwnership`, `committedModuleDependencies`,
  `discoverConfiguredMigrations` and `CORE_MODULE_ID`; `mikroOrmConfigFrom`;
  `createOrmBootstrap`; and `runMigrationCommand`.

  **Nothing on it reads a generated artefact.** The committed migration registry, the
  committed entity registry and the generated manifest index are facts about one
  repository's tree, so they arrive as parameters. For a host that used to call the
  application's own functions, the calls are:

  ```ts
  // before — the application's src/db/, which imported the registries itself
  const migrations = await configuredMigrations();
  const ownership = coreMigrationOwnership();
  const graph = coreModuleDependencies();
  const entities = await configuredEntities();
  const config = await mikroOrmConfig();

  // after — the same computations, over registries the host supplies
  import {
    committedMigrationOwnership,
    committedModuleDependencies,
    configuredEntitiesFrom,
    createOrmBootstrap,
    discoverConfiguredMigrations,
    mikroOrmConfigFrom,
  } from '@endora-commerce/platform/db';

  const sources = { coreEntries: MIGRATION_REGISTRY, manifests: DISCOVERED_MANIFESTS };
  const migrations = await discoverConfiguredMigrations(sources);
  const ownership = committedMigrationOwnership(sources);
  const graph = committedModuleDependencies(DISCOVERED_MANIFESTS);
  const entities = await configuredEntitiesFrom({ coreEntities: ALL_ENTITIES });
  const config = mikroOrmConfigFrom({ entities, migrations });
  const { initOrm, getOrm, closeOrm } = createOrmBootstrap(async () => config);
  ```

  `configuredMigrationsFrom` and `migrationOwnershipOf` keep their names and signatures.

  **`./migrations` now publishes the twelve core migration classes** beside
  `BASELINE_MIGRATIONS`. They moved unchanged — no rename, no consolidation, no re-stamping
  (R7.5) — because `mikro_orm_migrations` persists the class name, so a rename would make
  every migrated database see the migration as pending. There is no `migrations` array on
  that subpath, unlike a module package's: nothing discovers the platform, and an array here
  would be a claim nothing reads.

  **Two removals from `./lifecycle`.** `moduleDependencyCycles`,
  `sortComponentsTopologically` and `stronglyConnectedComponents` left it, and so did the
  `MigrationOwnership` type: their one consumer outside the platform was the ordering code,
  which is inside it now. A consumer that named them there takes the graph walk from
  `ModuleDepGraph` and `MigrationOwnership` from `./db`.

  **`@mikro-orm/migrations` is a new peer dependency**, on the same reasoning as
  `@mikro-orm/core`: the configuration registers the `Migrator` extension and the twelve
  migrations extend `Migration`, and a second copy of the package is a second `Migration`
  base class.

  The `@endora-commerce/cli` bump is `lib/platform-surface`'s `HOST_INTERNAL_SUBPATHS`
  gaining its `db` entry, with the reason that entry is required to carry.

- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [4eeb5cd]
- Updated dependencies [9eb0cb6]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [5ba2e97]
- Updated dependencies [0ab2044]
  - @endora-commerce/contracts@0.8.0

## 0.7.0

### Major Changes

- 08d22de: The admin layout answers for an application that has no module surfaces left.

  `AdminSurfaceLayout.moduleRoot` is now `string | null`. It is `null` when no directory under
  the admin source root holds a child named after a registered module — the state
  `specs/091-module-owned-admin-surfaces/` reaches once every module's admin screens live in
  that module's own package. **Zero module roots is a measurement, not a failure**; two is still
  `AdminLayoutUnresolvableError`, because picking one narrows every walk to it without saying so.
  - `findAdminModuleRoot(sourceRoot, registered)` returns `string | null` instead of `string`,
    and no longer throws for zero. **A consumer that assumed a non-null return does not
    compile**; the answer at every call site is the same trivial one, because nothing is under a
    directory that does not exist. Old: `const root = findAdminModuleRoot(src, ids); walk(root)`.
    New: `const root = findAdminModuleRoot(src, ids); if (root !== null) walk(root);`
  - `AdminSurfaceLayout.directories` and `AdminSurfaceLayout.moduleOfDirectory` and
    `AdminSurfaceLayout.componentDirectories` are empty when `moduleRoot` is `null`. Each is a
    measurement on the same terms.
  - **New: `adminRegistryPathOf(members, readText?)`** — the generated admin contribution
    registry's absolute path, or `null` for a workspace with no admin application. It needs the
    alias member and its target and nothing else, so a caller gating a population floor on that
    artefact's presence cannot have the gate go true for an unrelated reason.
    `AdminSurfaceLayout.generatedRegistryFile` is built from it, so there is one derivation with
    two entry points.
  - **New: `ModuleTreeLayout.adminSurfacesRefusal()`** — the `AdminLayoutUnresolvableError`
    message that produced `adminSurfaces()`'s `null`, memoised on the same call and non-null
    exactly when the layout is `null`. `adminSurfaces()` collapsed four distinct causes into one
    bare `null` and every caller printed a sentence of its own choosing; measured, a tree that
    refused on the module root had both of its callers report the alias, which sends a reader to
    repair a file that is correct. A consumer printing an admin refusal should print this string.

### Minor Changes

- e3eb042: `lib/admin-surfaces` names the admin application as an owner, and names the three
  registries the layout is read from.

  Three additions, all of them so that a consumer can exclude or attribute without spelling a
  path twice:
  - **`ADMIN_HOST_OWNER`** — the owner id of the admin application itself, `'host'`. It was a
    literal in `backend/scripts/ledgers/admin-registrations.ts`, which is deleted when the
    last module's registrations move out of `App.tsx`; the boundary ledger that now uses the
    same id outlives it, so the spelling moved here and that ledger re-exports it under the
    name its own consumers already use.
  - **`ADMIN_REGISTRY_ARTEFACT`** — `'modules.generated.ts'`, the generated contribution
    registry's filename. `generate-composer.ts` renders it under the alias member's source
    root and now derives the path from this constant, so a reader that has to exempt the
    artefact and the writer that produces it cannot end up naming different files.
  - **`AdminSurfaceLayout.registryFiles` and `.generatedRegistryFile`** — `App.tsx`,
    `components/AppShell.tsx` and the artefact above, absolute. The first two are the paths
    `resolveAdminSurfaces` already opened to read the route table and the nav; returning them
    is what lets a caller exclude the pair without a second copy of it.

  ```diff
   const layout = resolveAdminSurfaces(members, registered);
  +// The two hand-written registries, as the layout itself names them.
  +for (const file of layout.registryFiles) skip(file);
  ```

  Both new fields are required on `AdminSurfaceLayout`, so a caller that **constructs** one
  by hand — a test fixture, not a consumer of `resolveAdminSurfaces` — has to add them.

- 7140eed: `adminUiPackages` / `declaresAdminUi`: a workspace member may now declare
  `endora: { type: 'admin-ui' }`, the third value of that block beside
  `'platform'` and `'module'`, and `@endora-commerce/cli/lib/workspace-packages.js`
  exports the two functions that read it.

  `@endora-commerce/admin-kit` declares it. Nothing about what the kit publishes
  changes; the declaration is what puts its sources into two static checks'
  populations — `i18n:hardcoded`'s walk, which found the kit by name until now,
  and `check:admin-zones`' third `foreign-module-id` population, which found it
  not at all. A second admin-ui package (feature 091 P5b's
  `@endora-commerce/page-builder-admin`) is judged from its first commit by
  declaring the same block, with no edit to either check.

  The declaration only ever _adds_ obligations, which is what distinguishes it
  from the self-certified exemption D-171 refused: forgetting it is a hard-coded
  string that goes unread and a `HARDCODED_STRINGS_BASELINE` entry that reports
  itself drained in the same run.

- 2a97fca: `ESTATE` gains `check:test-ownership`, feature 106's ownership instrument
  (`specs/106-module-owned-tests/contracts/module-test-ownership.md`).

  For a consumer of this package the change is one new member of the exported
  `ESTATE` array, so `ESTATE.length` moves and anything iterating it reports one
  more rule. Its verdict is `scope: 'package'` with `host: pending(…)`: the rule's
  subject is one module package's test tree, which is exactly the question a
  package asks about itself, and what a lone package cannot supply is the
  _application's_ own `backend/test/**` — `misplaced-test`'s whole population.
  That signal is declared in the entry's `partial` list rather than dropped, so
  `endora check` will report it as unevaluated with a reason instead of leaving it
  silently absent.

  No exported type changes and no existing entry moves.

- ce5be77: Add `@endora-commerce/cli/lib/emitted-freshness.js`: "is the artefact this run read still the one
  its source says it is?"

  A package resolves through its own `exports` map at its build output, so a conformance check that
  imports a module's manifest by bare specifier reads `dist/manifest.js` and never opens
  `src/manifest.ts` — an author who edits the source and runs the check is answered about the previous
  build, in green. The new module derives, from a package's own `pnpm-workspace.yaml` membership,
  `exports` map and `tsconfig.build.json`, which file a run actually read and whether its source has
  outrun it.

  New exports: `emittingPackages`, `checkEmittedFreshness`, `freshnessRefusal`,
  `refuseStaleEmittedArtefacts`, `readArtefactOf`, `rootExportOf`, `sourceOfEmitted`, `originOf`,
  `packageHolding`, `nodeFreshnessFs`, and the types `EmittingPackage`, `FreshnessFs`,
  `FreshnessInput`, `FreshnessResult`, `FreshnessFinding`, `FreshnessFindingKind`, `ArtefactOrigin`.

  A consumer that wants the refusal calls `refuseStaleEmittedArtefacts(prefix, result, displayOf)`,
  which prints and exits **2** — the input could not be read, which is neither "clean" nor "found
  something".

- 76c541d: `@endora-commerce/cli` is published, and its `endora` binary works when it is installed rather than only when it is developed.

  Under D-208 this is the first package a client installs: somebody installs the CLI and, by running commands, builds their own Endora Commerce. It carried `"private": true`, so `changeset publish` filtered it out before it did anything. It now declares `repository`, `publishConfig.access` and no `private`, which is what the three packages published before it declare. It carries no `license`: D-203 defers that decision to the merge request that makes a package public **on npmjs**, and every package published so far carries none.

  **The binary was silent from an install, and that is the substantive fix.** `endora --help` printed nothing and exited 0 for every consumer who installed this package — measured on a packed tarball in a scratch directory. A package manager links the `bin` rather than executing the file in place (pnpm's shim execs a path through the `node_modules/@endora-commerce/cli` symlink into its content-addressed store; npm links the entry itself), so `process.argv[1]` names the link, while Node's ESM loader resolves a module URL to its real location before evaluating it. Comparing the two as written is false for every install and true only in the checkout that developed it. The entry guard now compares realpaths, and the negative direction is asserted too, so `import { runNewModule }` still runs no program as a side effect.

  **What this build's three commands do outside a checkout of the platform repository**, because installability and checkout-independence are two different properties and only the first is delivered here:
  - `endora check` **works**. It reads the module package it is pointed at and nothing above it — the `endora` block, the `exports` map and the sources those subpaths reach — so a module author outside this repository can be held to the platform's static-check estate. This is the command the publication is for.
  - `endora new module` and `endora new storefront` **refuse, at exit 2, naming what is missing**. The first derives the package manifest by running the platform's own manifest generator, which reads the workspace file for the npm scope, an application's manifest for the peer ranges and the root manifest for `engines.node`; the second copies the reference storefront out of the checkout and asks `git ls-files` what that application is. Neither invents those inputs. Making them work outside a checkout is `specs/110-instance-repository/`'s subject, not this change's.

- 3521978: `@endora-commerce/cli` now owns the shared library the static-check estate is built on, and
  publishes it on a `./lib/*.js` subpath.

  Fifteen modules moved out of the application's `backend/scripts/lib/` into this package's
  `src/lib/`, unchanged: `admin-surfaces`, `emitted-exports`, `module-package-subpaths`,
  `module-packages`, `module-population`, `module-roots`, `nested-checkouts`, `platform-root`,
  `platform-surface`, `read-size`, `repeating-timers`, `source-text`, `specifiers`,
  `switchable-modules` and `workspace-packages`. Every exported symbol keeps its name and its
  signature; a consumer writes

  ```ts
  import { requireModuleLayout } from '@endora-commerce/cli/lib/module-roots.js';
  ```

  `typescript` moves from `devDependencies` to `dependencies`: the relocated analyses read
  literal AST nodes, the specifier survives into the emitted declarations, and a devDependency
  is not installed for a consumer (D-181).

  Four modules stay in the application, each because it reads something the application owns and
  this package cannot: `sql-tables` and `package-declarations` reach `backend/src`'s naming
  strategy, installed-package enumerator and tenant-scope registry; `runtime-assets` and
  `module-package-manifest` reach the repository root's `scripts/lib/runtime-assets.mjs`, which
  is plain JavaScript at the root because 66 module package builds run it under bare `node`.
  They move when the host facts descriptor lands.

- e1465e0: Added `isNextApplication` to `@endora-commerce/cli/lib/workspace-packages.js`.

  _"Which workspace member is the reference storefront?"_ had one answer and one caller —
  `new-storefront/reference.ts`, which resolves the application it copies. It now has two:
  `check-release-intent.ts` derives the publication set from that same application's dependency
  closure, so the packages this repository may publish are what a storefront actually resolves and
  are written down nowhere.

  The predicate is unchanged — a member declaring `next` as a dependency **and** a `build` script
  that runs it — and it moves rather than being copied, because two implementations of it are two
  answers waiting to disagree about which application they mean.

- 239d29a: `endora new module` emits a module's admin layer, behind a new `--admin <navSection>` flag.

  Feature 091 Phase 2 made a module's admin screens arrive by the module existing: the generated
  registry `admin/src/modules.generated.ts` imports every module package's `./admin` layer, and
  `App.tsx` and `AppShell.tsx` render `[...host, ...registry]`. The mechanism landed with one
  converted module and no way to author a second without hand-writing the layer. This is that way.

  With `--admin catalog` (or any member of `AdminNavSectionNameSchema`) the command additionally
  writes:
  - `src/admin/index.ts` — the `AdminContributions` object and **nothing else**, so a consumer
    reaching into another module's `./admin` stays a counted boundary reach. One route whose
    `component` is a `() => import('./pages/…')` factory, and one sidebar entry, both carrying the
    permission code the module's own admin route enforces.
  - `src/admin/pages/<Pascal>Page.tsx` — a screen that reads the module's own
    `GET /api/v1/admin/<route>` through `@endora-commerce/admin-kit/lib`'s `apiClient` and renders
    it with `@endora-commerce/admin-kit/ui`. Every specifier is bare: `@/…` resolves for nothing an
    installed package runs under, and the environment is never read — a screen that has to build a
    URL itself takes the published `apiBaseUrl` instead of acquiring `vite/client` types.
  - `tsconfig.ui.json` — the layer's own emit configuration, sharing `rootDir`/`outDir` with the
    backend build and **replacing** the inherited `exclude` rather than extending it, which is
    otherwise `TS18003` over the one directory it compiles.
  - `test/unit/admin-contributions.test.ts`, and the `nav.*` / `admin.*` keys in both bundles.

  The flag is opt-in and takes the sidebar section as its value: a module with no admin surface is
  a real case, and where a screen belongs in an operator's sidebar is the one judgement the tool
  cannot default. It refuses a section outside the published set, and refuses without a
  `--permission` — there would be no code to gate the emitted screen with.

  `package.json` is still written by the platform's manifest generator and by nothing else: the
  `"./admin"` subpath, the second `tsc` invocation and the React peer set are all derived from the
  sources the command wrote.

- 4db867c: **`@endora-commerce/platform` gains a sixth subpath, `./composition`, and it is not public API** (D-160.14; `specs/080-f4-real-scope/contracts/host-package.md` §2.7).

  It carries the 27 composition symbols a composition root needs and no published barrel carries — `buildServer`, `composeModules`, `createRootContainer`, `registerOrm`, `registerValues`, `createRegistrationOwnership`, `registerRequestScopeHook`, `platformLogger`, `registryCache`, `publishStateChanged`, `activationDeclarationsFrom`, `requiredModulesFrom`, `composeSettingsKernel`, `ManifestReconciler`, `composeSalesChannelsKernel`, `DefaultChannelReconciler`, `createRequestLanguageResolver`, `AuditLogService`, `forkScopedEm`, `resolveTenantContext`, `systemTenantContext`, and the types `ModulePlugin`, `ApiInterceptorRegistry`, `KernelContainer`, `DecorationRecord`, `SettingsKernel`, `SalesChannelsKernel`.

  **Nothing became public API.** `./kernel`, `./http`, `./tenancy`, `./commands` and `./events` are unchanged. **No module may name `./composition`** — production source or test alike; a module's server-bound test composes through the test kit's `composeTestServer`, never through `composeModules`. A symbol graduates to a public barrel in the merge request that first gives it a module-package production consumer.

  `@endora-commerce/cli` learns the rule: `resolveHostSpecifier` answers a third way — `host-internal-subpath`, a subpath the host's `exports` map declares and no barrel carries — and `check:platform-surface` reports a module's reach into one as a finding of its own kind. `HostPackage` gains a required `declaredSubpaths` field, read off the host manifest's own `exports` map; a consumer constructing a `HostPackage` by hand must supply it.

- 7e71642: Added the deployment divergence report's shape, and gave `decorationOrder` a supply.

  **`@endora-commerce/contracts`** exports `DivergenceReport`, `DivergenceEntry`,
  `DivergenceKind`, `DivergenceDetail`, `DivergenceBoundary` and `DivergenceKey` — the shape of
  the committed record of how one deployment's tree differs from core. Nine kinds, one per seam a
  deployment can use, each entry naming what was changed, the module that changed it, the module
  that owns what was changed, the rung of the customisation ladder it sits on, and the
  deployment's own sentence.

  Two fields are nullable on purpose and a consumer has to handle both. `entry.rung` is `null`
  for `registration`, `worker` and `omission`: the ladder ranks ways of changing what _core_ does,
  and those three are a module contributing its own surface or a declaration. `detail.depth` is
  `null` on every `decoration` in a committed report, because depth is a fact about a composition
  rather than about a tree — the runtime half of the report fills it in.

  **`@endora-commerce/platform`**: `ComposeModulesOptions.decorationOrder` is read by both of
  this repository's composition roots for the first time. Nothing about the field's type or its
  semantics changed — it is still _checked, never applied_ — but a composition that passes it now
  gets the assertion it always described, and `AmbiguousDecorationError`'s message changes with
  it: it names the deployment's own declaration file and the field, and suggests the order
  composition would apply, instead of telling its reader that there is no way to declare one.

  `ForeignDecorationError`, `PackageDecorationNotOfferedError` and `DuplicateRegistrationError`
  each gained the rung they refused and the nearest lower rung that works, by mechanism. **If you
  assert on any of these four messages, they have moved.** `error.name` and the constructor
  arguments are unchanged.

  **`@endora-commerce/cli`**: one estate row, `check:divergence`, classified `repository-only` —
  a rule's subject there is a deployment, and a module package is not one.

- fe10845: New package: `@endora-commerce/cli`, one binary named `endora`, with its first command — `endora new module`.

  `endora new module <id> --name <text> --description <text> [options]` writes a module package that the platform composes, that the operator can switch off, that is discoverable in the command palette, and that type-checks and passes the platform's static-check estate with no hand edits. The layers are opt-in — `--entities`, `--ports`, `--worker`, `--subscriber` — and each one decides which of the platform's required checklists the emitted module has to satisfy, so the compliant shape is the default rather than something an author reconstructs from four checklists and 66 examples.

  It does **not** author the package's `package.json`. That file is derived from the sources — `exports` from which layers exist, `peerDependencies` from the bare specifiers the sources actually import, the ranges from the application that composes the modules — and it has an author already: the platform's manifest generator. The command writes the sources and then invokes that generator, so the two cannot disagree.

  Programmatic surface, for a caller that wants the scaffold without the argv layer: `runNewModule`, `buildScaffoldSpec`, `emitModuleFiles`, and the derivations around them (`npmNameFor`, `migrationStampFor`, `pascalOf`, …).

  `endora check` is not in this build and the program says so by name rather than pretending to run.

- 32cc6e4: A module can declare where its documentation lives, and the tooling can find it.

  `@endora-commerce/contracts` gains `ModuleDocsManifestSchema`,
  `ModuleDocsDeclarationSchema` and an optional `docs` field on `ModuleManifestSchema`.
  Its shape is `i18n`'s and it is located the same way — a directory at the **package
  root**, in the package's `files` list, with **no `exports` subpath**, found by joining
  `docs.dir` to `dirname(manifestPath)`. The anchor is the platform's, so nothing in a
  module names a package, a repository root or a build directory in order to find its own
  pages.

  ```ts
  export const manifest = defineModuleManifest({
    id: 'inpost',
    i18n: { bundlesDir: 'i18n' },
    docs: { dir: 'docs' }, // ships pages
    // docs: false,          // ships none, deliberately
  });
  ```

  **`false` and absent are not the same state**, and consumers must not collapse them:
  absent is a module nobody has decided about, `false` is a decision. A universal
  obligation over a population where some members legitimately owe nothing is repaired by
  empty files whose only effect is to make a check pass, which is why the decision has a
  spelling of its own.

  `@endora-commerce/cli` gains `lib/module-docs.js`: `resolveDocsLayout` (the Docusaurus
  site, from the workspace member declaring a configuration), `collectDocPages`,
  `parseFrontMatter`, `attributeDocs` and `moduleOfSlug`. It is the one derivation behind
  both the generated documentation navigation and the check that refuses its population
  defects — a second derivation of one population is two answers waiting to disagree, which
  is the state it replaces: three hand-maintained lists described the modules this platform
  composes and all three disagreed with it and with each other.

  No existing symbol changed, and a manifest that declares no `docs` is unaffected.

- c17fb1f: `endora check` runs eight more of the estate's rules against one module package,
  and ten more analyses now have one implementation and two hosts.

  **New on `@endora-commerce/cli/rules/*`** — each is the same function
  `backend/scripts/check-<name>.ts` calls, relocated rather than copied:
  `action-route-permissions`, `channel-resolution`, `default-language-prose`,
  `diacritic-folds`, `entry-scope`, `kernel-boundary`, `platform-surface`,
  `port-shape`, `singleton-identity`, `transaction-context`. Three shared readers
  move with them: `lib/sql-tables.js`, `lib/ui-layer.js` and a new
  `lib/port-registrations.js` (the container-registration and port-resolution
  readers, extracted from `check-port-dependencies.ts`).

  **Eight of them reach a package verdict.** `endora check` now evaluates
  `channel:resolution`, `check:default-language-prose`, `check:diacritic-folds`,
  `check:entry-scope`, `check:kernel-boundary`, `check:platform-surface`,
  `check:port-shape` and `check:transaction-context` over a package's own declared
  layers, taking `pending` from twenty-two to fourteen.

  **Breaking, for a consumer that called these analyses directly.** A ledger is a
  statement about one tree's debt and does not travel, so it is an argument now
  rather than a value the analysis reads:
  - `checkTransactionContext(input, ledger)` — the second argument is required.
  - `checkDiacriticFolds(files, ledger, slugLedger, roots?)` — the two ledgers are
    required; `roots` defaults to this repository's population roots.
  - `checkSingletonIdentity(input, allowed)` — required.
  - `checkPlatformSurface(input, ledger)` — required.
  - `analyse(input, ledger)` and `checkActionRoutePermissions(input, ledger)` —
    required.
  - `violationsOf(sites, allowed)` and `staleAllowances(sites, allowed)` from
    `rules/entry-scope.js` — the second argument is required.
  - `declaredTableNames(source, file, tableNameOf)` from `lib/sql-tables.js` takes
    the entity-class → table-name convention as a **required** parameter. The
    convention is the platform's own naming strategy, which lives in the
    application's runtime sources and cannot be reached from this package; writing
    a copy of the pluralizer here would make two authors of one convention.
  - `isScannablePath(path, roots?)` from `rules/diacritic-folds.js` takes the
    population roots, so a package can supply its own.

  `checkPortShape` gains four optional inputs — `platformOwnedNames`,
  `hostRegisteredPorts` and the two ledgers — and reads none of them from a
  constant of its own.

- 9dfb028: Add `endora check` — the platform's static-check estate evaluated against one module package.

  New on the `./checks` subpath: `runCheck(options)`, `ESTATE`, `PACKAGE_HOSTS`, `pendingEntries()`,
  `resolvePackageLayout(dir)` and the `RunReport` / `RuleResult` / `EstateEntry` shapes. New on
  `./rules/*.js`: the five relocated analyses this build hosts — `nul-bytes`, `bundle-pairing`,
  `container-imports`, `subscribe-seam` and `command-coverage`. Each is the **same function**
  `backend/scripts/check-<name>.ts` calls; a rule has one implementation and two hosts, and a
  consumer that wants a rule's analysis should import it from `./rules/<name>.js` rather than
  re-deriving its population.

  ```
  cd path/to/my-module-package
  endora check                # every rule, one verdict each
  endora check --list-rules   # the estate's ids
  endora check --as-platform  # acknowledged findings read as findings
  ```

  `endora check` exits **0** only when the whole estate was evaluated and found nothing, **1** when
  it was completely evaluated and there are findings, and **2** when the picture is incomplete —
  which in this build is every package, because twenty-one rules have no package-scope host yet and
  each says so with the phase that lands it. `findings=<n>` is printed on the arithmetic line
  whatever the exit code is.

  Two behaviours a consumer should know about. A rule is `not-applicable` only when the package's
  own `package.json` or manifest declares no subject for it, and the report names the declaration it
  looked for; a **declared** layer with no source is a short walk and exits 2. And a package may
  declare `endora.checkLedger` — a keyed, reasoned, two-way file of acknowledged findings which
  suppresses the author's exit code and never `--as-platform`'s.

  One breaking change to an existing export: `isMigratedModulePath(relPath, migrated)`'s second
  argument is now required. It defaulted to this repository's rollout ledger, which is a fact about
  these modules and has moved to `backend/scripts/check-command-coverage.ts` with its host.

- d1c2016: `endora new storefront` learns about a registry, and declares which package
  manager the scaffold is installed with.

  **`--registry <url>`** writes an `.npmrc` into the scaffolded storefront naming
  that endpoint for the scopes the storefront actually installs, and declares the
  credential for the endpoint **and for its host**:

  ```
  @endora-commerce:registry=https://<host>/api/v4/packages/npm/
  //<host>/api/v4/packages/npm/:_authToken=${ENDORA_NPM_TOKEN}
  //<host>/:_authToken=${ENDORA_NPM_TOKEN}
  ```

  The second line is not belt and braces. A registry serves the **packument** on
  the endpoint and chooses for itself where the `dist.tarball` inside it lives:
  GitLab answers an instance- or group-level endpoint with a tarball on the
  **owning project's** path, whose project id varies per package and is unknown
  when the file is written. With the endpoint line alone the metadata fetch is
  authenticated, that one tarball fetch is not, and the registry answers an absent
  credential with `404` — so an install fails with _the package is not there_
  immediately after asking about that same package successfully. A narrower
  prefix works mechanically and was rejected as a derivation: obtaining one means
  assuming a particular server's URL layout, and `--registry` names a registry
  rather than a GitLab. The cost accepted is that the token — a deploy token
  scoped `read_package_registry` — is offered to every request to the host you
  named; a registry serving tarballs from a _different_ host still needs a line of
  its own. A registry at the root of its host gets one line, not two.

  The token is written as an **environment reference and never as a value** — pnpm
  expands `${VAR}` in both the registry and the auth position — so the file holds no
  secret and is committable. A registry URL carrying its own credentials is refused
  rather than copied through, because that is the one shape that would put a secret
  into a client's repository. The trailing slash GitLab's own troubleshooting
  requires is appended; a blank value, a relative URL, a scheme npm cannot fetch
  from and a URL with a query or a fragment are each refused with the reason.

  **Omitting the flag writes no `.npmrc` at all**, and that is the default on
  purpose: it is what a consumer of the public registry holds, so the path the
  command takes without being told anything is the destination rather than the
  rehearsal.

  The scopes are derived from the reference storefront's own `workspace:` ranges —
  the packages that stop resolving the moment the copy leaves the workspace — so a
  checkout that grows a second scope gets a second registry line in the same run,
  and a storefront declaring no scoped workspace dependency is refused rather than
  handed a file that configures nothing.

  **The scaffolded manifest now declares `packageManager`**, taken from the
  storefront's own manifest if it has one and otherwise from the checkout's root. A
  pnpm lockfile records integrity and no registry; an npm lockfile records a
  `resolved` URL per package. So which one a client wrote decides whether moving
  between registries is one edited line or a regenerated lockfile, and that was
  previously left to their habits. A checkout declaring neither is refused rather
  than given an invented version.

  New exports: `TOKEN_VARIABLE`, `normalizeRegistry`, `npmrcContent`, `authKeys`,
  `installedScopes`, `packageManagerFor`, and `PlanOptions`. `StorefrontPlan` gains
  `registry`, the endpoint the copy installs from or `null` for the public one.
  `planStorefront` takes an optional fourth argument; existing three-argument calls
  are unchanged.

  The command's closing "Next steps" text no longer tells its reader to pack
  tarballs and pin them through `pnpm.overrides`. That was honest while nothing
  under `packages/` was published and became wrong the moment something was — and
  it is printed into a copy the client owns outright, which nobody comes back to
  correct.

### Patch Changes

- 48ccbb1: The check estate gains `check:block-names`.

  `ESTATE` is reconciled against `check-inventory.test.ts` in both directions, so the entry
  is what stops the new rule arriving as a silent skip — the thing the manifest exists
  against. It is classified `scope: 'package'`, `tier: 'B'`, `host: pending('Phase 4')`, with
  three `partial` signals whose subjects are a **pair** of manifests or another package's
  renderer map and which a lone module package therefore cannot supply:
  `duplicate-block-name`, `category-presentation-disagreement` and
  `renderer-without-declaration`. Its subject declaration is `blocks` in the module manifest,
  so a package that declares none is reported `not-applicable` with that sentence rather than
  skipped.

- ee02c59: The per-deployment declaration is `divergence`, and it is an object (D-205).

  `ReducedDeploymentDeclarationSchema` and its `ReducedDeploymentDeclaration` type
  are gone. The entry survives as `OmittedModuleSchema` / `OmittedModule`,
  unchanged in substance — a `moduleId` and a 20–800 character `reason` — and it
  now sits inside `DeploymentDivergenceDeclarationSchema`, which is what a
  deployment's `backend/src/apps/<deployment>/divergence.ts` exports as
  `divergence`.

  Before:

  ```ts
  import type { ReducedDeploymentDeclaration } from '@endora-commerce/contracts';

  export const reducedDeployment: ReadonlyArray<ReducedDeploymentDeclaration> = [
    { moduleId: 'blog', reason: '…' },
  ];
  ```

  After:

  ```ts
  import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';

  export const divergence: DeploymentDivergenceDeclaration = {
    omittedModules: [{ moduleId: 'blog', reason: '…' }],
    decorationOrder: {},
    reasons: {},
  };
  ```

  The file is renamed with the export, because _reduced_ encodes a direction two
  of the three new contents do not have: `decorationOrder` declares the wrapping
  order for a registration more than one of a deployment's overlay modules
  decorates, and `reasons` carries one sentence per divergence the platform
  derives, keyed by the derived entry's own key. Both parse today and are read by
  nothing yet — they are supplied and checked by later phases of
  `specs/107-override-report-and-ladder/`.

  Three details a consumer will meet:
  - Every field defaults to empty, so a declaration that leaves one out means
    "none of these" — the reading an absent file already gets.
  - The object is **strict**: a fourth field, or a misspelled one, is refused
    rather than stripped, because a stripped field reads as "this deployment
    declares nothing" for a file whose author wrote a declaration.
  - `@endora-commerce/platform`'s D-101 boot refusal is unchanged in behaviour and
    changed in wording: it names `divergence.ts` and the `omittedModules` inside
    it. `ReducedDeploymentError` keeps its name — all three of its findings are
    about a module set that is genuinely reduced.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [b2552d5]
- Updated dependencies [cebad9c]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [3c8102e]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a47dcc8]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [bbf9258]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
