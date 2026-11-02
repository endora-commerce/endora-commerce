# @endora-commerce/admin-shell

## 0.109.0

### Minor Changes

- 476c5aa: The signed-in administrator's Admin UI preferences, kept on the server, and a Pinned section in the sidebar (feature 164).

  - **`useAdminPreference(key)` and `useAdminPreferencesStatus()`** (`@endora-commerce/admin-kit/lib`). `AuthProvider` now provides the signed-in administrator's preferences itself — no extra provider to mount. `useAdminPreference('sidebarPins' | 'sidebarCollapsedGroups' | 'sidebarRailMode')` returns the value and a setter that applies at once and saves in the background, newest value last, retried on reconnect and when the page returns to the foreground. `useAdminPreferencesStatus()` reports whether the preferences loaded and whether a save failed. A session seeded through `AuthProvider`'s `initial` without `preferences` reads the defaults; a fetched one without them opens with the defaults and saves nothing until a later load succeeds. `AdminMe` gains `preferences?: AdminPreferences | null`.
  - **Pinned sidebar section** (`@endora-commerce/admin-shell`). Every sidebar entry has a pin button after its link (a Tab stop of its own; always visible with a 44 px target on touch). Pinned entries appear first, in a section of their own, in the expanded sidebar, the mobile drawer and — as the first icon — the collapsed rail, where its fly-out lists the pins with an unpin button. A pin whose entry the administrator cannot see is not shown. Pinning and unpinning are announced.
  - **Reordering pins** in the expanded sidebar and the drawer, with the kit's `useReorderList`: drag a row, or focus its handle and use Space and the arrow keys (Escape cancels), or the up/down buttons on touch screens; every move is announced. A pin that is hidden at the moment keeps its place.
  - **Pinning from the command palette.** A result whose destination is a sidebar entry has a pin button beside it, and `Alt+Enter` (`⌥↵`) pins or unpins the highlighted result; `Enter` still opens it. No palette entry or group is added.
  - **`usePageSizePreference(scope)` is server-backed**, same signature: each list's page size is the signed-in administrator's, kept on the server per list (default 20); it is read when the list opens, so a change made on another device applies the next time the list opens. Folded sidebar groups (the Pinned section folds as `pinned`) and rail mode are server-held too, and present in the first render. Nothing is kept in `localStorage` any more.
  - **One-time carry-over on upgrade.** On first load the browser's remembered page sizes **for the signed-in administrator** are sent to the server — a value already there wins — and removed once it confirmed; another administrator's are left alone. The two old sidebar values (`b2b-admin.nav.collapsed-groups`, `b2b-admin.nav.rail-mode`) were not tied to an administrator, so they are removed without being imported: everyone opens in the default sidebar layout once.
  - **A failed save** keeps the change on screen and shows one dismissible notice below the top bar.
  - **New `core` strings** (`@endora-commerce/mod-i18n`, English and Polish): `appShell.pinned.*` (including `appShell.pinned.reorder.*`), `appShell.palette.pin.*`, `adminPreferences.saveFailed`, `adminPreferences.dismiss`.
  - **Theme** (`@endora-commerce/admin-kit/theme.css`): `.b2b-nav-row`, `.b2b-nav-pin`, `.b2b-nav-reorder-handle`, `.b2b-palette__pin` and the notice's classes.

- 11b0eb8: The contract surface of the new `tasks` and `projects` modules, one shared reference grammar,
  and a new sidebar section.

  **`@endora-commerce/contracts`** gains, exported from the package root:

  - `tasks.ts` — the Tasks admin API schemas (`TaskListQuerySchema`, `CreateTaskBodySchema`,
    `UpdateTaskBodySchema`, `TaskSummarySchema`, `TaskDetailSchema`, `TaskContextSchema` and their
    siblings, with inferred types), `TASKS_EVENTS` and the event payload types, `TASKS_ERROR_CODES`,
    and the interfaces another module uses: `TaskReadPort`, `TaskWritePort`,
    `TaskContextRegistryPort` with `TaskContextDescriptor`;
  - `projects.ts` — the Projects admin API schemas (`ProjectListQuerySchema`,
    `CreateProjectBodySchema`, `CloseProjectBodySchema`, `ProjectTemplateBodySchema`,
    `ProjectAnalyticsQuerySchema`, `ProjectDetailSchema` and their siblings), `PROJECTS_EVENTS` and
    the event payload types, `PROJECTS_ERROR_CODES`, and `ProjectReadPort`,
    `ProjectStageGuardRegistryPort` with `ProjectStageGuard`;
  - `record-references.ts` — the `[[<type>:<uuid>]]` reference grammar under neutral names
    (`recordReferenceTypeSchema`, `formatRecordReferenceToken`, `extractRecordReferenceTokens`,
    `splitRecordReferenceText`, `mentionedAdminUserIds`, `RecordReferenceSchema`), the `@@` lookup
    answer `RecordDocumentLookupResponseSchema`, and the shared `RecordHistoryPageSchema`;
  - `record-rich-text.ts` — the formatted-text grammar (`parseRecordRichText`,
    `formatRecordRichText`, `recordRichTextToPlain`, `isSafeRecordRichHref`).

  `ERROR_CODES` gains the codes the two modules raise — `TASK_NOT_FOUND`, `TASK_CONTEXT_INVALID`,
  `TASK_ASSIGNEE_INVALID` and the `PROJECT_*` codes of `PROJECTS_ERROR_CODES`.

  **`AdminZoneNameSchema` has a new member, `'task.detail.after'`**, with its props
  `TaskDetailZoneProps { taskId }` in `AdminZonePropsMap` — the zone a Task's screen mounts after its
  content. A consumer that switches exhaustively over `AdminZoneName` gets a compile error until it
  handles the new member.

  **The reference grammar reads five types where it read three**: `quote_request` and `task` join
  `product`, `order` and `admin_user`. Every CRM name — `opportunityReferenceTypeSchema`,
  `formatOpportunityReferenceToken`, `extractOpportunityReferenceTokens`,
  `splitOpportunityReferenceText`, `OpportunityReferenceSchema`, `parseOpportunityRichText` and the
  rest of `crm.ts` §9 and `crm-rich-text.ts` — is still exported, now as an alias of the shared
  one. A text stored before reads as it did. A consumer that switches exhaustively over
  `OpportunityReferenceType`, or indexes a `Record` by it, gets a compile error until it handles
  the two new members.

  **`assetReferenceKindSchema` has a new member, `'project_attachment'`** — a file a Project
  uses, which the media library then refuses to delete. A consumer that switches exhaustively over
  `AssetReferenceKind` gets a compile error until it handles the new member.

  **`AdminNavSectionNameSchema` has a new member, `'work'`**, and `@endora-commerce/admin-shell`
  declares the section after _CRM_, labelled "Projects & tasks" / "Projekty i zadania"
  (`appShell.section.work` in `@endora-commerce/mod-i18n`). It renders only while a module
  contributes a visible entry to it. A consumer that switches exhaustively over
  `AdminNavSectionName` gets a compile error until it handles the new member.

### Patch Changes

- 42b1038: `@endora-commerce/admin-shell` no longer carries its 67 re-export shims over `@endora-commerce/admin-kit` (`lib/api-client`, `lib/auth`, `components/ui/*`, `i18n/*` and the rest). The shell imports every one of those bindings from `@endora-commerce/admin-kit/lib`, `/ui`, `/components` or `/i18n` directly. None of the shims was reachable through the package's `exports` map, so nothing a consumer can import has changed: `AuthProvider` and the `AdminMe` / `AuthProviderProps` types are still exported from the package root, and are the kit's own bindings as before. A test that replaces one of these bindings with `vi.mock` must name the kit specifier (for example `vi.mock('@endora-commerce/admin-kit/lib', …)`, spreading the original module) — a mock on an old `admin-shell/src/...` path no longer has a file to resolve to.
- 1b1c43e: Both packages now declare `"sideEffects": ["*.css"]` in `package.json`. No JavaScript file in either package does anything when it is imported, so a bundler can drop every barrel member a consumer does not use. The CSS files the packages ship (`theme.css`, `tailwind.css`) are still treated as side-effectful, so a stylesheet imported from JavaScript is kept.

  The exported API does not change. In this repository's admin build, the entry chunk shrank from 2454.5 kB to 806.8 kB (gzip: 774.6 kB to 231.6 kB). A consumer that imported from the barrels gets a smaller bundle and does not need to change anything.

- ffb2aec: Every signed-in administrator can now read and acknowledge their own notifications on the Admin UI's bell, whatever their role. Before, the bell and its API needed `admin:read`, so a narrow role such as a sales representative had Task and CRM notifications recorded for them that they could never open.

  - `@endora-commerce/mod-admin-notifications`: `GET /api/v1/admin/notifications`, `POST /api/v1/admin/notifications/:id/read` and `POST /api/v1/admin/notifications/mark-all-read` are gated on an administrator session with no permission code. `admin:read` now decides only whether the `all_admins` broadcasts are listed, counted and acknowledgeable; for an administrator without it, a broadcast's id answers `404` like any notification that is not theirs. `AdminNotificationService.listForAdmin`, `markRead`, `markAllRead` and `countUnreadForAdmin` take a required `includeBroadcasts` flag. The module now depends on `admin_roles`, whose permission service answers that question. The permission's label is now _View notifications sent to all admins_.
  - `@endora-commerce/admin-shell`: the header shows the notification bell to every administrator while the Admin notifications module is on.
  - `@endora-commerce/mod-i18n`: the English and Polish labels of `admin:read` follow the new meaning.
  - `@endora-commerce/mod-tasks`: the module page says that every administrator reads their own notifications without a permission.

- 6e8d6d0: The ⌘K command palette now matches a query word by word: every word typed must occur somewhere in the row — its label, description or any keyword — instead of the whole query having to appear, contiguously, in one of them. A single-word query matches exactly what it matched before; matching stays case- and diacritic-insensitive.

  Before this, `kanał sprzedaży` did not find the `Kanały sprzedaży` screen, and `sales channels` did not find it in a Polish-language admin, because each word lived in a different field. The rule is the same for the Actions, Navigate and Assistant groups.

  `@endora-commerce/mod-sales-channels` adds the keyword `kanały` to its `open-sales-channels` palette action, so an English-language admin finds the screen by its Polish name too. The new keyword reaches the palette on the next boot, which reconciles `module_actions` from the manifest.

- Updated dependencies [42b1038]
- Updated dependencies [9b45768]
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [c3165da]
- Updated dependencies [0e33ca9]
- Updated dependencies [e64ed74]
- Updated dependencies [e03e6a9]
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
- Updated dependencies [476c5aa]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [1b1c43e]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [42189ce]
- Updated dependencies [d9053a7]
- Updated dependencies [23489bf]
- Updated dependencies [f40ce92]
- Updated dependencies [55864a1]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
- Updated dependencies [1846755]
  - @endora-commerce/admin-kit@0.109.0
  - @endora-commerce/contracts@0.109.0

## 0.108.0

### Minor Changes

- 53e88c7: _Send feedback_ beside the release in the Admin UI sidebar (an icon of its own when the sidebar is collapsed), shown while the `admin_feedback` module is present. It opens a dialog — the feedback (required), the sender's e-mail (the signed-in administrator's, editable) and an optional phone — that posts to `POST /api/v1/admin/feedback`, and says every outcome: thanks, sending switched off on the instance, too many messages, or not delivered, always with `support@endora.software` to write to by hand and with what was typed kept. New `appShell.feedback.*` keys in the core bundle (EN, PL); `theme.css` gains `.b2b-sidebar__feedback` and `.b2b-sidebar__feedback-rail-row`.

### Patch Changes

- b4a47be: The _Send feedback_ dialog is drawn over the whole page again on a phone. It is now rendered into the document body instead of inside the sidebar, which coloured its title and labels with the sidebar's light text and — being a drawer moved with `transform` on narrow screens — confined the dialog and its backdrop to the drawer.
- 3a9dc6e: Raise `vite` to `^7.3.7`. It includes a dev-server fix that keeps module ids, not URLs, in `safeModulePaths`. `@endora-commerce/admin-shell`'s generated README lists the new peer range.
- Updated dependencies [0bd5a2b]
- Updated dependencies [291ec86]
- Updated dependencies [20af5d5]
- Updated dependencies [cf7a9c0]
- Updated dependencies [cf7a9c0]
- Updated dependencies [c8aa175]
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
- Updated dependencies [e1b173f]
- Updated dependencies [ef1318e]
- Updated dependencies [f42bbaf]
- Updated dependencies [c781cd6]
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [172597c]
- Updated dependencies [6f1e0ec]
- Updated dependencies [0d0a1c6]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
- Updated dependencies [53e88c7]
- Updated dependencies [8e10ba1]
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
- Updated dependencies [3a9dc6e]
- Updated dependencies [5bddd11]
- Updated dependencies [4a05f32]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/admin-kit@0.108.0

## 0.107.0

### Minor Changes

- bf9881f: The command palette finds records as well as screens and actions.

  On every open the palette asks `GET /api/v1/admin/global-search/capability`; when the answer names
  at least one record type, typing at least the minimum search length searches records after a 250 ms
  pause (the previous request aborted, a stale answer ignored) and shows one group per record type
  after _Actions_, with server-resolved titles, a status badge, a "more results" hint and a note for a
  type that could not be searched. Records join the palette's one Arrow/Enter list; a final row opens
  `/global-search?q=…`. A refused or failed probe — global search switched off or not installed —
  leaves the palette exactly as it was. A live region announces the number of records found.

  The `core` bundle gains five keys in English and Polish: `appShell.palette.records.searching`,
  `.more`, `.unavailable`, `.seeAll` and `.announce`, so a host needs `@endora-commerce/mod-i18n` at
  this version.

- 5865c59: The API description is available to administrators with the `platform.api_description.read` permission and to API keys with the `platform.api_description.read` scope.

  **`@endora-commerce/platform`.**

  - New permission `platform.api_description.read` (_Read the API description_), declared by `_lifecycle`'s manifest with English and Polish labels. The platform administrator grants it through an admin role.
  - `GET /api/v1/_openapi.json` and `GET /api/v1/_docs` now answer only an administrator holding the code or an API key whose scopes include it. Anybody else is answered `401 UNAUTHORIZED` (no administrator session or key, a customer session included) or `403 FORBIDDEN` (an administrator or a key without the code). Both stay outside the sales-channel access rule (`salesChannelAccess: 'open'`). Responses carry `Cache-Control: private, no-store`.
  - New admin route `GET /api/v1/admin/api-description`, gated on the same code, serving the same document to the Admin UI.
  - `buildServer` no longer mounts the two routes. It decorates the root instance with `apiDescription(): OpenAPIV3_1.Document` (built on first call, as before), and `_lifecycle` mounts the routes where `auth`'s `requireAdmin` port is available. A composition that mounts no `_lifecycle` serves no API description; one that called `buildServer` and read `/api/v1/_openapi.json` in-process reads `app.apiDescription()` instead, or sends credentials. `registerOpenApiRoutes` is removed; it was reachable only through the host-internal `./http/openapi` subpath.
  - The reference page loads `swagger-ui-dist@5.33.3` from jsDelivr with Subresource Integrity on both files (`swagger-ui.css` `sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW`, `swagger-ui-bundle.js` `sha384-h00llMzD1afyNow1pDmnZKlHsUZgp9KE9HXLFXF2CvbwsBY0+WBO4f75SfGwvM4K`) and `crossorigin="anonymous"`; it used to load an unpinned version.
  - A command-palette action, _API description_, targets `/api-description` and requires the new code.

  **`@endora-commerce/contracts`.** `apiKeyScopeSchema` gains `'platform.api_description.read'`, so an administrator who holds the code can issue an API key that reads the API description.

  **`@endora-commerce/admin-shell`.** New kernel-served screen `/api-description` (_System → API description_, gated on `platform.api_description.read`): the document's title, version and endpoint count, a JSON download, and a link that opens the interactive reference on the API's own address in a new tab, carrying the administrator session.

  **`@endora-commerce/mod-i18n`.** The screen's strings and its navigation label in English and Polish (`platform.apiDescription.*`, `appShell.nav.platformApiDescription`).

  **`@endora-commerce/mod-api-keys`.** The module page lists the new scope.

### Patch Changes

- a57515b: The sidebar shows the release number in a section of its own: the logo, a divider, the version
  badge, a divider, then the rest of the sidebar. The badge no longer overlaps the logo's header.
  The collapsed sidebar still hides it and keeps the release in the logo's tooltip.
- Updated dependencies [97d24cf]
- Updated dependencies [fcf4d09]
- Updated dependencies [09e72a3]
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
- Updated dependencies [b8adc7f]
- Updated dependencies [86a88fd]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [2933bf0]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [a57515b]
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
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/admin-kit@0.107.0
  - @endora-commerce/contracts@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0
  - @endora-commerce/admin-kit@0.106.0

## 0.105.0

### Minor Changes

- 1190180: The Admin UI says which Endora Commerce release it is talking to, and the health payload stops
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
  `process.env.npm_package_version ?? '0.0.0'`: the _host application's_ manifest version, which is
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

### Patch Changes

- a65b215: An administrator changing their own password has to supply the current one.

  **Breaking for API clients of `PATCH /api/v1/admin/me`.** The route used to store whatever
  `password` it was sent: a signed-in session was the only proof asked for, so anybody holding one —
  an unattended browser, a copied cookie — could replace the password and keep the account. A
  request that carries `password` must now carry `currentPassword` as well:

  ```jsonc
  // before
  { "password": "<new password>" }
  // now
  { "password": "<new password>", "currentPassword": "<current password>" }
  ```

  - `password` without `currentPassword` is refused with `400 VALIDATION_FAILED`, the issue naming
    the `currentPassword` field.
  - A wrong `currentPassword` is refused with `403 CURRENT_PASSWORD_INVALID`. It is 403 and not the
    401 the buyer-side change-password route answers with, because the Admin UI treats every 401 as
    an expired session and signs the administrator out.
  - A refused request changes nothing: a first or last name sent in the same request is not applied
    either.
  - A request without `password` is unchanged — first and last name stay editable without any
    password, and a `currentPassword` sent alone is ignored.

  The current password is checked with the same hash verification sign-in uses. Nothing else about a
  password change moves: the administrator's sessions and second factor are left as they were.

  `updateAdminUserSelfRequestSchema` in `@endora-commerce/contracts` gains the optional
  `currentPassword` field and the rule that ties it to `password`; `UpdateAdminUserSelfRequest` gains
  the field. `AdminUserService` in `@endora-commerce/mod-admin-users` gains `updateSelf(id, input)`,
  which the route calls, and `AdminUserService.update` no longer accepts `password` — it was the
  unverified write, and the route was its only caller.

  The other ways to set an administrator's password are untouched: creating an account,
  `POST /api/v1/admin/admin-users/:id/password` (a peer reset, gated by `admin_users:manage`) and the
  `admin_users create` command.

  **Admin UI.** The profile screen has a "Current password" field above "New password". It is asked
  for only when a new password is typed, and a wrong one is reported on the field itself, not in
  the page banner.

  **Sentences.** `errors.CURRENT_PASSWORD_INVALID` in the `core` bundle reads "The current password
  is incorrect." / "Obecne hasło jest nieprawidłowe." instead of the placeholders "Current Password
  Invalid." / "Błąd: current password invalid." — the buyer-side change-password route answers with
  the same code, so its message changes too. Three keys join the bundle in English and Polish:
  `profile.field.currentPassword`, `profile.field.currentPasswordHelp` and
  `profile.error.currentPasswordRequired`.

- 9260c36: An administrator's sessions are revoked when the credential behind them is withdrawn.

  Three writes used to leave every session of the account answering:

  - **Changing your own password** (`PATCH /api/v1/admin/me`) replaced the hash and nothing else, so
    a browser signed in elsewhere — the one the password was being changed because of — stayed
    signed in for up to thirty days. It now revokes **every other session of the account**: the
    sign-ins on other browsers and devices and the impersonation sessions the administrator started.
    The session the request was made from is kept, no new cookie is issued, and the profile screen
    stays open. A refused change (wrong or missing `currentPassword`) and a name-only edit revoke
    nothing.
  - **Deactivating an administrator** (`PATCH /api/v1/admin/admin-users/:id` with
    `status: 'inactive'`) and **deleting one** (`DELETE /api/v1/admin/admin-users/:id`) now revoke
    every session of the account. A permission check already refused an inactive account, but a
    route gated on the session alone — `GET` and `PATCH /api/v1/admin/me` among them — kept
    answering it, and reactivating the account brought the old sessions back.

  A peer reset (`POST /api/v1/admin/admin-users/:id/password`) already revoked every session and is
  unchanged. API keys are not sessions and are not touched; neither is the account's second factor.

  **A revoked session could come back.** `SessionService.destroyAllForAdmin` and
  `destroyAllForCustomer` cleared the Redis cache entries and then deleted the rows, so a request from
  a session being revoked could read the row in between and cache it again — after which it answered
  from the cache until its thirty-day expiry. Rows are deleted first now, and `loadSession` looks for
  the row again after filling the cache and takes the entry back out when it is gone.

  **Logins begun with the old password are withdrawn.** A pending second-factor challenge or setup
  ticket issued after the old password verified could still be completed after a password change, a
  peer reset, a deactivation or a delete. `MfaLoginPort` gains a required method,
  `invalidatePending(subject)` (**breaking for implementers**), which `mfa` implements with a
  per-subject generation counter in its challenge store, and `AdminUserService` calls it wherever it
  revokes sessions. `AdminUserService`'s constructor takes the lazily resolved MFA port as an optional
  fifth argument.

  **Write first, revoke second.** The self-service change, the peer reset, deactivation and deletion
  now persist the new state and then revoke, where the peer reset used to revoke first: a sign-in with
  the old password between the two steps kept a session nothing revoked. A refusal from the session
  port therefore surfaces as the request's error with the new password already in force.

  **Audit.** A self-service password change is now recorded as `admin_user.change_password` with
  `via: 'self_service'` — the action a peer reset already records with `via: 'peer_reset'` — where it
  used to be an `admin_user.update` indistinguishable from a rename. The entry carries neither the
  password nor its hash. A request that changes the name as well records an `admin_user.update`
  entry beside it; a password-only request no longer records one.

  **A session of an account that is not active is refused, revoked or not.** Revocation is a step
  each write has to remember, so the admin guard no longer relies on it: `requireAdmin` and
  `requireAdminAny` answer `401 UNAUTHORIZED` to a session whose administrator account is
  deactivated, deleted or gone. **This changes a status code:** a permission-gated route used to
  answer such a session `403 FORBIDDEN`, and a route with no permission code answered it in full. An
  active account that lacks the permission is still answered 403. The extra account read is made
  only on a route with no permission code and after a refused permission check, so a granted
  permission costs what it did. While `admin_roles` or `admin_users` is absent from the deployment the
  check is not made — it has nobody to ask — so `GET /api/v1/admin/module-presence` keeps answering in
  that state as before.

  **A new password equal to the current one is refused** on `PATCH /api/v1/admin/me` with
  `400 NEW_PASSWORD_UNCHANGED` ("The new password is the same as the current one. Choose a different
  password." / "Nowe hasło jest takie samo jak obecne. Wybierz inne hasło."). It would have reported
  a change, and signed the other sessions out, without changing the credential. The check runs after
  the current password is verified. The buyer-side change-password route and the peer reset do not
  make this check: the peer does not know the target's password, and comparing would tell them.

  **Log redaction.** The request logger censored `*.password`, `*.passwordHash` and `*.secret` but not
  `*.currentPassword` or `*.newPassword`, the two other names a password travels under in a request
  body. Both are on the list now, which `buildServer` and `createLogger` share instead of each
  carrying its own copy.

  **API — two breaking changes, named first.**

  - `AdminPermissionChecker` in `@endora-commerce/platform` gains a required method,
    `isActiveAdministrator(adminUserId): Promise<boolean>`; `PermissionService` in
    `@endora-commerce/mod-admin-roles` implements it. A hand-written checker passed to
    `createRequireAdmin` / `createRequireAdminAny` has to add it.
  - `AdminAuthService.changePassword` in `@endora-commerce/mod-admin-users` is **removed**, and the
    class's constructor loses its fourth argument (the audit port). The method had no caller,
    answered a wrong current password with 401 and revoked nothing; `AdminUserService.updateSelf` is
    the one implementation.
  - `AuthSessionPort.destroyAllForAdmin` in `@endora-commerce/contracts` takes an optional second
    argument, `{ exceptSessionId }` (`AuthDestroyAllForAdminOptions`), which spares that one session
    when it is one of the administrator's own; `SessionService.destroyAllForAdmin` in
    `@endora-commerce/mod-auth` implements it. A port implementation that ignores the argument still
    type-checks but revokes the calling session too.
  - `AdminUserService.updateSelf` takes an optional third argument, `{ sessionCookieValue }`, from
    which it works out which session to keep.
  - `ERROR_CODES.NEW_PASSWORD_UNCHANGED` joins `@endora-commerce/contracts`, owned by `admin_users`.

  A refused password change is not written to the audit log, as a failed sign-in is not.

  **Admin UI.** After a password change the profile screen says that the other sessions were signed
  out (`profile.info.passwordChanged`, English and Polish) instead of "Profile updated."

- 149ee85: The Admin UI tells an administrator whose account holds no role why the panel is empty. Such an
  account can sign in — `GET /api/v1/admin/me` answers 200 with `role: null` and no permissions —
  while every permission-gated route refuses it with `403 ADMIN_ROLE_REQUIRED`. The shell mounted
  normally, every gated sidebar and palette entry filtered itself out, and the sentence explaining
  the refusal was never shown because no page was left to request it. `AppShell` now renders a
  warning notice above the routed screen whenever the signed-in session's `role` is `null`, saying
  that the account has no role and that another administrator, or `admin:create` on the command line,
  has to assign one. The notice is an `Alert` from the design system, so it is announced
  (`role="alert"`) as well as shown.

  Two keys join the `core` bundle in English and Polish: `appShell.noRole.title` and
  `appShell.noRole.description`.

  No API, setting or permission changes.

- 8d4440f: The configured admin idle-logout window now applies to every administrator, not only to those whose
  role includes `settings:read`. The Admin UI learned the window by requesting
  `GET /api/v1/admin/settings/admin.idle_logout_minutes`, which requires `settings:read`: an
  administrator with a narrower role was answered 403 on every sign-in and was signed out after the
  built-in 60 minutes whatever the operator had configured.

  `GET /api/v1/admin/me` now carries the window as `idleLogoutMinutes` (`number | null`), described
  by the new `adminMeResponseSchema` in `@endora-commerce/contracts`, and the Admin UI reads it from
  there — it no longer calls the settings endpoint for it. `AdminMe` in `@endora-commerce/admin-kit`
  gains the matching optional field. The field is additive; the Admin UI keeps its 60-minute default
  when the field is absent (a backend older than this release) or `null` (the setting could not be
  resolved).

  The permission gate on the settings admin API is unchanged. No setting or permission changes.

- a7d3609: The command palette offers the AI assistant as soon as it is configured, without a page reload.
  The palette asked the backend whether the assistant was available once per page session and kept
  that answer, so an operator who had opened the palette before enabling the assistant and attaching
  credentials in Settings was shown the pre-save state — no **Ask the assistant…** row — until the
  page was reloaded, while the backend had reported `ready` from the first read after the save. The
  same remembered answer kept the row offered after the assistant was switched off, where every
  prompt then answered `409`. The palette now asks each time it is opened, paints the last known
  answer meanwhile, and withdraws the row when the question fails.

  The module's documentation page described three settings that do not exist
  (`prompt_actions.provider`, `prompt_actions.model`, `prompt_actions.api_key`). It now describes the
  ones that do: the provider, model and API key come from an `llm` credential configuration
  referenced by `prompt_actions.llm_credentials`.

  No API, setting or permission changes.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [79bd849]
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
  - @endora-commerce/admin-kit@0.105.0

## 0.104.0

### Minor Changes

- dbf6778: An entry on the Admin UI's notification bell can be shown in each reader's language. Additive:
  a module that records entries as before is unaffected, and so is a consumer that reads only
  `title` and `body`.

  **`@endora-commerce/contracts`.** New type `AdminNotificationMessage` —
  `{ scope: string; key: string; params?: Record<string, string | number> }`, the bundle
  namespace (a module id, or `core`), a key in that bundle and what fills its `{name}`
  placeholders. `RecordAdminNotificationInput` gains two optional members, `titleMessage` and
  `bodyMessage`; `title` stays required and is the English sentence shown when the message
  cannot be resolved. `AdminNotificationRecord` gains the same two as optional members, so an
  existing implementation of `AdminNotificationRecordPort` — a test double included — still
  satisfies it.

  ```ts
  await adminNotifications.record({
    audience: 'admin_user',
    targetAdminUserId,
    kind: 'my_module.thing.done',
    title: `Thing ${number} is done`,
    titleMessage: { scope: 'my_module', key: 'notifications.done.title', params: { number } },
  });
  ```

  **`@endora-commerce/mod-admin-notifications`.** A migration,
  `Migration20261007T194748AdminNotificationsMessageKeys`, adds two nullable `jsonb` columns to
  `admin_notifications` — `title_message` and `body_message`; nothing is backfilled and existing
  rows read `null`. `adminNotificationRecordPort.record` stores a message and answers it, and
  **refuses** one it could not draw: a scope that is not a bundle namespace, an empty key or one
  longer than 255 characters, a param that is not a string or a finite number, and a
  `bodyMessage` without a `body`. `GET /api/v1/admin/notifications` answers `titleMessage` and
  `bodyMessage` on every item, `null` when the entry has none.

  **`@endora-commerce/admin-shell`.** `NotificationBell` resolves `titleMessage` and
  `bodyMessage` through the loaded translation bundles — the reader's language, then English —
  and shows the recorded `title` / `body` when the entry carries no message, when no bundle
  holds the key (the recording module is switched off or not installed), or when the template
  names a placeholder the entry has no param for. A raw key is never shown, and a param is drawn
  as text.

- 32775d5: The Admin UI's sidebar has a "CRM" section, placed after _Sales_. The shell declares no row in
  it: every entry is a module's contribution (`section: 'crm'`), so the heading renders only
  while a module contributes an entry the operator may see. Its label is `appShell.section.crm`
  in the core bundle, in English and Polish.

### Patch Changes

- 4d5f0dd: The admin dashboard shows its numbers on the first visit.

  After signing in, or after reloading the page on `/`, the four KPI tiles read "—" and the stock
  alerts card read "No products are currently low on stock" until the operator opened another screen
  and came back. `HomePage` decided which requests to send once, when it mounted, and it mounts in the
  same render as `ModulePresenceProvider` — which answers "absent" for every module until its first
  response arrives. So every request was skipped, and nothing went back for them when the answer
  changed.

  - **Each tile and the stock alerts card now owns its request**, and sends it when it is first
    shown. A surface belonging to a module that is off, or to a permission the role does not hold,
    still costs no request.
  - **A tile says what state its number is in.** A placeholder while the request is pending, and a
    message with a _Retry_ button when it fails — where it used to keep the same "—" for both and for
    a response that carried no number.
  - **The stock alerts card no longer reports a failure as an empty warehouse.** It has its own
    loading and error states; "No products are currently low on stock" is shown only when the
    request succeeded and returned none.

  Seven strings are added to the `core` bundle, in English and Polish: `home.kpi.error`,
  `home.kpi.loading`, `home.kpi.retry`, `home.kpi.retryLabel`, `home.stockAlerts.error`,
  `home.stockAlerts.loading` and `home.stockAlerts.retry`.

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [d8b4e1b]
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- @endora-commerce/admin-kit@0.101.1
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

### Patch Changes

- @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- d4a193c: The sign-in screen's "No account yet?" hint no longer tells the reader to run `pnpm --filter backend run admin:create` from the repository root — a command only a checkout of the Endora Commerce repository has. It now reads "Ask your platform administrator, or create one from the command line: see the Getting started guide", linking to the guide's new _Creating an administrator_ section, which spells the command for an instance, a production image and a repository checkout. The `loginCopy.footerPrefix` and `loginCopy.footerSuffix` keys are replaced by `loginCopy.noAccount` and `loginCopy.noAccountLink`, and `ADMIN_ACCOUNT_HELP_URL` is new beside them; none of the three is exported from the package's entry point.
- @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.10.7

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7

## 0.10.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6

## 0.10.5

### Patch Changes

- f89d305: Add the `payment_method.list.integrations` admin zone so separately installed payment gateways can contribute their own configuration cards. Remove the five extracted gateways' breadcrumb and shared translation records from the free packages.
- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5

## 0.10.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/admin-kit@0.9.4

## 0.10.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/admin-kit@0.9.2

## 0.10.1

### Patch Changes

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
  - @endora-commerce/admin-kit@0.9.1

## 0.10.0

### Minor Changes

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
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0

## 0.9.1

### Patch Changes

- Updated dependencies [5bfefe0]
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

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

### Patch Changes

- 10a17f0: The liveness and readiness probe is the platform's, and `@endora-commerce/mod-health-checks` is gone.

  `GET /api/v1/_health` is now registered by `@endora-commerce/platform` itself: `composeApp`
  puts `healthRoutePlugin({ orm, redis })` at the head of the module plugins it returns, and
  `composeTestServer` does the same, so an instance serves the probe because it is an Endora
  instance rather than because a module the scaffolder happened to select is installed. It was
  not: `endora new instance` writes the closure over the modules declaring
  `activation.nonDeactivatable`, `health_checks` declared no activation block at all, and no
  manifest named it as a dependency — so a scaffolded instance answered 404 on the route
  `deploy/compose.prod.yml` healthchecks, its API container never became healthy, and its
  storefront, which waits on `service_healthy`, never started. Moving the route also closes the
  withdrawal: `assertDeactivatable` returns early for a module with no activation block, so
  `module:uninstall health_checks` was accepted and an operator could take the liveness endpoint
  off a running instance with one command. Owner ruling D-229.

  **What a consumer has to do.** Nothing, if the instance composes through `composeApp` or
  `composeTestServer` — the route arrives with the platform. Remove
  `@endora-commerce/mod-health-checks` from the instance manifest; it no longer resolves. The
  route, its path, its payload and its status codes are unchanged.

  `@endora-commerce/platform/composition` gains `healthRoutePlugin`, `registerHealthRoutes`,
  `platformHealthProbes`, `healthResponseSchema`, `HealthDeps`, `HealthProbeSources` and
  `HealthResponse`. No new subpath: `./http` is untouched, because no module names any of this.

  `MEILISEARCH_URL` and `npm_package_version` are declared by the platform now, with the
  sentences the dissolved manifest carried. `@endora-commerce/mod-search` therefore stops
  declaring `MEILISEARCH_URL` — one variable may not carry two descriptions, and a module may not
  describe a platform input — while continuing to read it and to declare
  `MEILISEARCH_API_KEY`. **An operator-visible consequence:** the surviving declaration is
  `optional`, where `search`'s was `required`. Both readers have always defaulted to
  `http://localhost:7700`, so the requirement was aspirational, but a prompt built from these
  declarations will no longer insist on the value.

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [c1d281f]
- Updated dependencies [52c2bfd]
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

- 16a9a6d: **`./theme.css` is withdrawn from this package.** It is now
  `@endora-commerce/admin-kit`'s (owner ruling D-219).

  **Old:**

  ```css
  @import '@endora-commerce/admin-shell/theme.css';
  ```

  **New:**

  ```css
  @import '@endora-commerce/admin-kit/theme.css';
  ```

  The import fails loudly rather than silently — `ERR_PACKAGE_PATH_NOT_EXPORTED`
  at the first build — so there is nothing to notice later.

  Nothing else about this package changes: it still peer-depends on the kit, and
  the kit's `./theme.css` is what its own screens render against. The subpath
  moved because 55 module packages declare the kit and **none** declares this
  package, so classes published from here would have been rendered by packages
  that cannot name their definer and cannot put a version range on it.

  `@endora-commerce/admin-kit`'s own changeset says what is in the file, what the
  new default palette is and how to override it.

- e811df3: New package: the admin application itself.

  `@endora-commerce/admin-shell` is the router, the sidebar and command palette,
  the breadcrumb trail, the sign-in screen and the four surfaces the platform owns
  rather than a module (the dashboard, the profile, `/platform/modules` and the
  not-found treatment). It was `admin/src`; an admin project now holds only
  `index.html`, `main.tsx`, its Vite and Tailwind configuration, its brand assets,
  its theme tokens and the generated contribution registry.

  The barrel is three members and they are the three lines of an entry point:

  ```tsx
  import { App, AuthProvider, registerAdminServiceWorker } from '@endora-commerce/admin-shell';

  registerAdminServiceWorker();
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App contributions={MODULE_ADMIN_CONTRIBUTIONS} />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
  ```

  `contributions` is required rather than defaulted. The generated registry is the
  admin project's file and this is a package, so the shell cannot import it — and
  an `App` with no registry would render the host's own routes and none of the
  modules', which is a blank product that looks like a working one.

- fbe7317: The shell publishes its design tokens at a new subpath, `./theme.css`.

  It carries the `@theme inline` block, the `:root` and `.dark` token
  declarations, the `@layer base` rules and the 22-class `@layer components`
  legacy shim — everything an admin project used to hold in its own `index.css`.
  An instance now imports it and overrides a token by **redeclaring it after the
  import**:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/admin-shell/theme.css';
  @import './tailwind.generated.css';

  /* last, so a redeclaration wins */
  :root {
    --primary: 262 83% 58%;
  }
  ```

  That works because every semantic token is an indirection —
  `--color-primary: hsl(var(--primary))` — so a utility this package's build never
  saw resolves against the consumer's `:root`. What a redeclaration cannot change
  is a value baked as a literal: the palette is overridable, Tailwind's spacing
  scale is not.

  **Why it matters to a consumer rather than to us.** The `@layer components` block
  defines `.page-header`, `.badge--warning`, `.alert--error`, `.btn--primary`,
  `.table` and eighteen others, and installed module packages _render_ them. Held
  in the consumer's own stylesheet, those definitions were frozen at the moment
  their project was created: a module release adding `.badge--info` would have
  rendered unstyled, in every existing project, with no error anywhere. They now
  belong to the package whose components render them and arrive with an upgrade.

  Additive: no existing subpath, export or symbol changes, and a project that does
  not import it is unaffected.

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

### Patch Changes

- Updated dependencies [16a9a6d]
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
- Updated dependencies [e27bf6c]
- Updated dependencies [5ba2e97]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
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
- Updated dependencies [214cbdb]
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
- Updated dependencies [e7bbadc]
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
  - @endora-commerce/admin-kit@0.7.0
