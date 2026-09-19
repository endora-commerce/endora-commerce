# @endora-commerce/mod-i18n

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0

## 0.9.1

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
  - @endora-commerce/platform@0.11.1

## 0.9.0

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

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/contracts@0.11.0

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0

## 0.8.0

### Minor Changes

- 016524f: Retire the two module-package **value** imports the production composition root
  still held.

  `backend/src/composition.ts` names a module package 23 times over 21 packages.
  Nineteen of those packages are reached type-only; two were reached by value, and
  a value import does not retire by moving a type. That matters because
  `specs/110-instance-repository/` T118 moves this root's contribution wiring, ORM
  boot, request-scope hook, error-envelope options and tenant-context resolution
  into `@endora-commerce/platform`, **where a platform file may not import a
  module** (D-52, D-53). Each of the two needed a seam of its own, and they did not
  want the same one.

  **`@endora-commerce/mod-auth` — a port.** `promoteAdminActor` is no longer
  exported from `./backend`. The implementation has not moved and must not: `auth`
  reads it itself from `require-admin.ts`, and promotion is about `request.actor`
  and `request.adminActor`, two decorations this module's plugin applies. It is
  registered instead under the container name `promoteAdminActor`, which is the
  step the old export's own doc block and
  `test/contract/kernel/harness-parity.test.ts` both recorded as open — _"actor
  promotion published as a port, resolved from the container"_.

  ```diff
  -import { promoteAdminActor } from '@endora-commerce/mod-auth/backend';
  -promoteAdminActor(request);
  +import type { AdminActorPromotion } from '@endora-commerce/platform/kernel/ports/require-admin.js';
  +// resolved from the container, never captured — the gate is transient
  +const promote = container.cradle.promoteAdminActor as AdminActorPromotion;
  +promote(request);
  ```

  The module gains two things. The port, above. And **the actor types**, published
  as `Actor`, `ActorAnonymous`, `ActorCustomer`, `ActorAdmin` and `ActorApiKey`,
  because retiring the value import took something nobody had noticed it was
  carrying: `plugin.ts` holds a `declare module 'fastify'` block adding `actor` and
  `adminActor` to `FastifyRequest`, an ambient augmentation reaches a consumer only
  if the declaring file is in that consumer's program, and the value import was the
  only thing putting it there. Thirty reads of `request.actor` stopped compiling
  the moment it went. A consumer that reads `request.actor` now writes a
  **type-only** import from `./backend` and the augmentation travels with it.

  **`@endora-commerce/mod-i18n` — a relocation, and a port was structurally
  unavailable.** `buildErrorTranslationTargets`, `describeErrorCodeCollisions` and
  their five shapes are gone from `./backend`; they are
  `@endora-commerce/platform`'s now, at `kernel/i18n/error-translation.ts`, beside
  `request-language.ts` — the producer of the other `ErrorEnvelopeOptions` member a
  composition root injects.

  ```diff
  -import { buildErrorTranslationTargets } from '@endora-commerce/mod-i18n/backend';
  +// the platform's; no published subpath carries it, and no module calls it
  ```

  The line it moved across is _the routing is derived from manifests, the
  translation is a service_. `I18nService.translate` — what the envelope's
  `translateErrorMessage` closure calls — stays here and is unchanged. The
  derivation translated nothing: it read `manifest.errorCodes` off the resolved
  manifest set, which is a composition-root input, and it had **no consumer inside
  this package at all** — the barrel re-exported it and nothing here called it,
  which is T040b's criterion 8, the test `absolutizePublicUrl` moved out of `email`
  under. A port was not a design choice rejected on taste: the production root
  calls this _before_ `composeModules`, so there is no container to resolve one
  from, and moving the call after composition would move the collision warning with
  it — a diagnostic logged where it is so that an operator reads it before the
  first request that renders wrong.

  The aggregate return type is renamed `ErrorTranslationRouting`.
  `http/error-envelope.ts` declares an `ErrorTranslationTargets` of its own — the
  record this one's `targets` member is assigned to — and two types of one name in
  one package, one being the input to the other's consumer, is a confusion with a
  real cost. Nothing outside the package named the aggregate.

  **`@endora-commerce/platform`** gains both targets and publishes neither on a
  barrel: no module calls the derivation and no module resolves the promotion port,
  so `specs/080-f4-real-scope/contracts/host-package.md` §1.3 classifies both
  _unreached_, and putting a host-only name into the module-facing contract is what
  that classification exists to prevent. `AdminActorPromotion` sits in
  `kernel/ports/require-admin.ts` beside `RequireAdminFactory` and
  `RequireCustomerGuard`, which is where a Fastify-shaped port type lives —
  `@endora-commerce/contracts` declares no dependency on Fastify.

  Behaviour is unchanged. `composition.ts` computes the same map at the same point
  in the boot, logs the same collision warning, and promotes the same actor in the
  same closure; the existing composition, error-envelope and harness-parity tests
  are the assertion and none of them moved.

### Patch Changes

- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0

## 0.7.0

### Major Changes

- 469a5f4: Removed `ERROR_TRANSLATION_KEYS` and `composeErrorTranslationTargets` from
  `@endora-commerce/mod-i18n/backend`. Error-code routing is now nothing but the modules' own
  `errorCodes` declarations, composed by `buildErrorTranslationTargets`, which was already
  published and is unchanged.

  `ERROR_TRANSLATION_KEYS` was a static table generated by a private prefix chain
  (`moduleIdForErrorCode`) over the closed `ERROR_CODES` enumeration, so a module written outside
  this repository could not produce a translated error at all: its code was in neither, and the
  envelope answered whatever English the raising code wrote, for ever. The chain's last line was
  `return 'core'`, so a code no rule matched was routed silently to the platform bundle and
  rendered as a raw code with nothing anywhere reporting it.

  **If you named `ERROR_TRANSLATION_KEYS`**, build the map from the manifests instead. The input is
  every registered manifest — core, this deployment's overlay modules and every installed package.

  ```diff
  -import { ERROR_TRANSLATION_KEYS } from '@endora-commerce/mod-i18n/backend';
  -const target = ERROR_TRANSLATION_KEYS[code];
  +import { buildErrorTranslationTargets } from '@endora-commerce/mod-i18n/backend';
  +const { targets, collisions } = buildErrorTranslationTargets(await resolvedManifestEntries());
  +const target = targets[code];
  ```

  **If you called `composeErrorTranslationTargets`**, call `buildErrorTranslationTargets` with the
  same argument. It was a transitional shape that laid the declarations over the chain so the
  migration could be delivered one owning module per merge request; all eighteen owners have
  declared, so there is nothing left to lay them over.

  Two behavioural differences follow, and both are the point rather than side effects. A code **no
  registered manifest declares** is now absent from the map, so the envelope answers the raising
  code's own message — there is no fall-through to the platform bundle. And a code **more than one
  module declares** is absent too, and named in `collisions` with every claimant and the file it
  was declared in: nobody wins, because routing one raiser's condition under another's sentence is
  good prose about the wrong thing, with no symptom a client can detect.

  `ErrorTranslationTarget`, `ErrorTranslationTargets`, `ErrorCodeDeclarationSource`,
  `ErrorCodeClaim`, `ErrorCodeCollision` and `describeErrorCodeCollisions` are unchanged.

  `@endora-commerce/platform` carries a documentation correction only: the
  `ErrorEnvelopeOptions.errorTranslationTargets` doc block no longer describes the injected map as
  a static table, and records that a deployment's overlay module can now own a code by declaring
  it. No emitted behaviour changes.

### Minor Changes

- 316f44b: `@endora-commerce/admin-kit` publishes four generic members that sat under a module's
  admin directory and were rendered from another's (feature 091, P8).

  **`./components` gains `ContentLanguageTabs` and `ScopePicker`.**
  - `ContentLanguageTabs({ languages, activeLanguage, onChange })` — a tab strip over
    content language codes. Its props type is `ContentLanguageTabsProps`.
  - `ScopePicker({ value, onChange })` — sales channels and the content languages inside
    them. Its props type is `ScopePickerProps` and its value type is **`ScopePickerValue`**,
    which is `CmsScopeValue` renamed: `{ salesChannelIds: string[]; languages: string[] }`,
    field for field. A consumer importing `CmsScopeValue` from `mod-cms`' admin code renames
    the type and changes nothing else.
  - `listScopeSalesChannels(pageSize?)` and `fetchScopeSalesChannel(code)` come with it. The
    picker called `sales_channels`' admin API client; it now builds both `GET`s from the
    published `apiClient` and the contract's own `SalesChannelListResponse` /
    `SalesChannelDetail`, so the kit holds no module code.

  **`./ui` gains `Section`** — `Section({ title, action?, className?, children })` and
  `SectionProps`. A heading, an optional action beside it and a slot; it is a layout
  primitive, which is why it is here and not on `./components`.

  **`./lib` gains the three invoice e-mail-outcome helpers** — `invoiceEmailNotSentReason`,
  `sendInvoiceEmailMessage` and `issueInvoiceNotice`, plus the `Translate` type they take.
  Signatures are unchanged: each still receives the caller's scope-bound `t`.

  **`@endora-commerce/mod-cms`' bundle loses six keys** and `@endora-commerce/mod-i18n`'s
  gains them under new names, because the two components now render out of `core` (ruling
  R-1: a translation namespace is module knowledge). None of the six had another reader.

  | gone from `mod-cms`      | arrives in `mod-i18n`           |
  | ------------------------ | ------------------------------- |
  | `languageTabs.empty`     | `contentLanguageTabs.empty`     |
  | `languageTabs.ariaLabel` | `contentLanguageTabs.ariaLabel` |
  | `scope.title`            | `scopePicker.title`             |
  | `fields.languages`       | `scopePicker.languages`         |
  | `scope.selectChannel`    | `scopePicker.selectChannel`     |
  | `scope.loadingLanguages` | `scopePicker.loadingLanguages`  |

  Every value is carried across unchanged in both shipped languages. **A consumer that
  supplies its own bundle has to move all six**: a key left in the `cms` scope does not fail
  to compile and does not 404 — it renders `core.scopePicker.title` into the operator's screen
  as a label.

  The invoice e-mail helpers move no key. All twelve they read —
  `invoices.emailNotSent.<reason>` (seven), `invoices.emailSent`,
  `invoices.emailNotSentNotice` and three `orderDetail.issueInvoice.*` — were already
  `mod-i18n`'s in both languages and in neither `mod-invoices`' bundle nor `mod-orders`'.

- 3eef7a2: `newsletter` and `transactional_emails` ship their admin surfaces.

  **New `./admin` subpath on two packages.** `@endora-commerce/mod-newsletter` and
  `@endora-commerce/mod-transactional-emails` each export `contributions` — an
  `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`, and nothing else.
  Seventeen routes and nine sidebar entries between them, all at the paths and codes the
  hand-written host registrations carried:
  - `mod-newsletter` — `/newsletter/subscribers` (the landing route), `/newsletter/campaigns`,
    `/newsletter/campaigns/:id`, `/newsletter/campaigns/:id/stats`, `/newsletter/automations`,
    `/newsletter/automations/:id`, `/newsletter/tags` and `/newsletter/blocks` on
    `newsletter:read`; `/newsletter/campaigns/new`, `/newsletter/automations/new` and
    `/newsletter/provider` on `newsletter:write`, which is the code the API enforces on the
    `POST`s those three screens exist to make and the code the provider row already carried.
    Six sidebar rows, in the `newsletter` section at weights 100 through 600.
  - `mod-transactional-emails` — `/transactional-emails` (the landing route),
    `/transactional-emails/blocks`, `/transactional-emails/blocks/:id`,
    `/transactional-emails/templates`, `/transactional-emails/templates/:id` and
    `/transactional-emails/:code`, all on `transactional_emails:read`. Three sidebar rows, in
    the `messaging` section at weights 100, 200 and 300.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **Both packages declare `@endora-commerce/page-builder-admin` as a peer dependency**, and
  that is what makes the two a batch rather than two rows. Their whole recorded admin debt was
  six reaches into `admin/src/modules/_shared/email-builder/`; P5b published that directory as
  `@endora-commerce/page-builder-admin/email`, so the six became bare specifiers into an
  `exports` map and there was nothing left to repair. Three `newsletter` screens (the campaign
  editor, the automation builder and the block editor) and three `transactional_emails` ones
  (both fragment editors and the e-mail editor, through this module's own `EmailEditorPane`
  adapter) mount `EmailEditorPane` and `EmailVariablesProvider` from it. `manifests:generate`
  derives the peer from those specifiers; a consumer installing either package from a registry
  must be able to resolve it.

  **Two new components on `mod-transactional-emails`, both internal to its `./admin` layer.**
  `EmailBlockEditorPage` and `EmailTemplateEditorPage` each render `EmailFragmentEditor` with
  one `kind`. The admin host used to pass that as a prop from its route table
  (`element={<EmailFragmentEditor kind="block" />}`), and an `AdminRouteDeclaration.component`
  is a factory returning a module whose `default` is read — there is nowhere in a declaration
  to put an argument.

  **Three new palette actions**, replacing hand-written rows in the admin shell, with the same
  destinations, codes and keywords:
  - `mod-newsletter` — `open-newsletter-campaigns` → `/newsletter/campaigns` and
    `open-newsletter-automations` → `/newsletter/automations`, both `newsletter:read`.
  - `mod-transactional-emails` — `open-email-blocks` → `/transactional-emails/blocks`,
    `transactional_emails:read`.

  Both packages' `i18n/{en,pl}.json` gain the nav labels (`nav.subscribers.label` and its five
  siblings; `nav.transactionalEmails.label`, `nav.emailBlocks.label`,
  `nav.emailTemplates.label`) and the new actions' label and description keys, module-relative
  and in both shipped languages.

  **`@endora-commerce/mod-i18n` loses fifteen keys**: `appShell.nav.newsletter*` (six),
  `appShell.nav.transactionalEmails`, `appShell.nav.emailBlocks`, `appShell.nav.emailTemplates`
  and the six `appShell.palette.sub.*` keys the deleted palette rows named. Nothing renders
  them after this change — the labels are the two modules' own now. `appShell.section.messaging`
  and `appShell.section.newsletter` stay: the shell still owns the section taxonomy.

- 543151a: `catalog` and `orders` ship their admin screens, and one icon name joins the allowlist.

  **`@endora-commerce/mod-catalog` gains an `./admin` subpath and `@endora-commerce/mod-orders`
  gains routes and nav on the one it had.** `catalog`'s new entry point exports `contributions`
  with eight `routes` and six `nav` declarations — the product roster and editor, the category
  tree, the attribute and attribute-set registries, the attachment types and the two
  bulk-operation screens. `orders`' entry point exported `contributions` with a `zones` array and
  nothing else since P4d; it now declares four routes and three nav entries beside it. A consumer
  that composes either package's `./admin` gets those screens without editing an application file.

  **`@endora-commerce/mod-catalog` declares three new manifest actions**: `open-products`,
  `open-categories` and `open-attributes`, each with the destination, permission code and keywords
  the admin's hand-written palette row carried, and with the labels and descriptions those rows
  rendered. `@endora-commerce/mod-orders`' manifest is unchanged — its palette row duplicated the
  `open-orders` action it had declared all along.

  **`@endora-commerce/contracts` adds `'ClipboardCheck'` to `KnownIconNameSchema`** and
  `@endora-commerce/admin-kit` adds the matching entry to `resolveIcon`'s map. A module
  declaration names its icon rather than importing it, and `orders`' three sidebar rows render
  that glyph.

  **Breaking for a consumer that imports these two modules' screens from the admin application.**
  Twenty-seven files moved out of `admin/src/modules/{catalog,orders}/` and four re-export shims
  were deleted with them:
  - `admin/src/modules/catalog/components/ProductPicker` — import `ProductPicker` from
    `@endora-commerce/admin-kit/components`.
  - `admin/src/modules/orders/Section` — import `Section` from `@endora-commerce/admin-kit/ui`.
  - `admin/src/modules/orders/StatusTransitionGraph` — import `StatusTransitionGraph` from
    `@endora-commerce/admin-kit/components`.
  - `admin/src/modules/orders/orderStatusColor` — `ORDER_STATUS_COLOR_PRESETS` and
    `ORDER_STATUS_DEFAULT_COLOR` are `@endora-commerce/contracts`'; `readableTextColor` and
    `statusBadgeStyle` (which that file also re-exported as `orderStatusBadgeStyle`) are
    `@endora-commerce/admin-kit/lib`'s.

  **`@endora-commerce/mod-i18n` drops fifteen keys** — nine `appShell.nav.*`, four
  `appShell.palette.sub.*`, `appShell.nav.quickOrder` and `appShell.crumb.detail` — from the
  shared bundle in both shipped languages, nothing rendering them any more. Their replacements are
  module-relative keys in `@endora-commerce/mod-catalog`'s and `@endora-commerce/mod-orders`' own
  bundles.

  **One route tightens.** `/orders/new` was declared by the admin application and therefore
  ungated, while the sidebar row that advertised it carried `orders:write`; the route is
  `@endora-commerce/mod-orders`' own now and takes that code. A read-only operator who could
  previously open an order-entry form whose save would refuse now meets the admin's not-found
  treatment instead.

- e5ae42c: `mfa`, `carts`, `audit_logs`, `admin_users` and `admin_roles` ship their admin surfaces, on a
  new `./admin` subpath each.

  Each of the five now exports `contributions` from `@endora-commerce/mod-<id>/admin` as an
  `AdminContributions` object — six routes and three sidebar entries between them. Every
  component is a dynamic-import factory, so a consumer's bundler emits one chunk per screen.

  Six things a consumer has to know:
  - **`@endora-commerce/mod-admin-roles/admin` declares a sidebar entry and no route.** The
    `/admin-roles` screen is served by `GET /api/v1/admin/admin-roles` in `admin_users`, so
    `@endora-commerce/mod-admin-users/admin` declares that route alongside its own
    `/admin-users`, while `admin_roles` declares the sidebar entry and the palette action that
    advertise it. All three arrays of `AdminContributions` are optional and a nav-only
    contribution is supported; a consumer rendering the registry needs both packages for the
    roles screen to be both reachable and advertised.
  - **Three sidebar labels moved namespace.** `appShell.nav.users`, `appShell.nav.roles` and
    `appShell.nav.auditLog` were in `@endora-commerce/mod-i18n`'s shared `core` bundle; they
    are now `nav.adminUsers.label`, `nav.adminRoles.label` and `nav.auditLog.label` in each
    package's own `i18n/`, resolved in the module's own scope. Anything reading an old key gets
    a raw key back. The text is unchanged in both languages, and the screens' own keys did not
    move.
  - **`@endora-commerce/mod-admin-users` and `@endora-commerce/mod-audit-logs` ship an `i18n/`
    directory for the first time**, and their manifests declare `i18n.bundlesDir` accordingly.
    A consumer that mirrored `files` by hand needs the new directory.
  - **Three packages declare `actions` for the first time**: `open-admin-users`,
    `open-admin-roles` and `open-audit-log`. They are ⌘K palette entries, resolved by the
    server against the effective enabled-set, and they pay three of the fifteen remaining
    entries in this repository's Principle XVI debt. `mfa` and `carts` still declare none —
    neither contributes a sidebar entry, which is that debt's population.
  - **`@endora-commerce/contracts` adds `ShieldCheck` to `KnownIconNameSchema`**, and
    `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Additive: no existing name changes,
    and a consumer validating an icon name against the old enum keeps working. It is needed
    because a nav entry declares its glyph **by name**, so keeping the one the sidebar already
    drew meant adding the name rather than substituting one already on the list.
  - **All five packages now peer on `@endora-commerce/admin-kit`, `react` and, where a screen
    routes, `react-router-dom` and `lucide-react`.** They are peers rather than dependencies
    for the reason `page-builder-core` is: the application must resolve exactly one copy, and a
    provider in one copy against a consumer in the other is a `null` context at runtime rather
    than a type error.

- f11ccdb: `customers`, `organizations` and `sales_channels` ship their admin screens, and two icon names
  join the allowlist.

  **Three packages' `./admin` subpath gains `routes` and `nav`, and two of them gain the subpath
  itself.** `@endora-commerce/mod-sales-channels/admin` already exported `contributions` with a
  `zones` array and nothing else; it now declares its screens there too. `@endora-commerce/mod-customers`
  and `@endora-commerce/mod-organizations` had no `./admin` subpath at all and now declare one.
  Eight routes and six sidebar entries between them, at the paths and codes the hand-written host
  registrations carried. The exported symbol is the same one every other module package uses —
  `contributions`, an `AdminContributions` object, and nothing else — so a consumer already
  reading `sales_channels`' zones needs no edit.
  - `@endora-commerce/mod-customers` — **new `./admin` subpath**, exporting `contributions`.
    `/customers` (the landing route), `/customers/online` and `/customers/:id`, all on
    `customers:read`, which is the code every `GET` behind them enforces; the detail screen keeps
    gating its block, unblock, impersonate, delete and restore controls on `customers:manage`
    inside itself. Two sidebar rows, in the `customers` section at weights 100 and 200. The detail
    screen is reached from the roster and has no row of its own. `CustomerDetail` renders the
    `customer.detail.after` zone, which is unchanged.
  - `@endora-commerce/mod-organizations` — **new `./admin` subpath**, exporting `contributions`.
    `/organizations` and `/organizations/:id`, both on the **any-of pair**
    `['customers:read', 'customers:manage']`, which is what
    `requireAdminAny(['customers:read', 'customers:manage'])` enforces on every organization
    endpoint. `AdminNavDeclaration.requiredPermission` and `AdminRouteDeclaration.requiredPermission`
    both take a `PermissionRequirement`, so the pair is declared rather than collapsed: naming only
    the read code hides the screen from a role holding just `customers:manage`. One sidebar row, in
    the `customers` section at weight 300. `OrganizationDetail` renders the
    `organization.detail.after` zone — four modules contribute there — and that is unchanged.
  - `@endora-commerce/mod-sales-channels` — `/sales-channels` and `/sales-channels/:code` on
    `sales_channels:read`, and `/sales-channels/new` on `sales_channels:write`. **That last one is a
    behaviour change for a consumer rendering these routes**: the create form is a screen whose only
    purpose is a write, `POST /api/v1/admin/sales-channels` enforces `sales_channels:write`, and the
    module's own `new-sales-channel` palette action already advertised that code. It was ungated
    while the route was the admin application's, so an operator holding only `sales_channels:read`
    could open a form whose save then refused; the roster's _+ New channel_ button is gated on the
    same code in this release, so the dead end is closed at both ends. `credentials` ships the
    identical split for `/credentials/new`. One sidebar row, in the `channels` section at weight 100.
    `SalesChannelEditPage` renders the `sales_channel.editor.after` zone, which is unchanged.

  **`@endora-commerce/contracts` — two members join `KnownIconNameSchema`: `Building2` and
  `Store`.** They are the glyphs the admin application drew for `/organizations` and
  `/sales-channels` by hand. A contribution names its icon rather than importing it, so a name that
  is not on the allowlist degrades to the fallback; adding them is what keeps the two rows looking
  as they did. Widening an enum is additive for a consumer validating against it and breaking for
  one exhaustively switching over `KnownIconName` — there is no such consumer in this repository.

  **`@endora-commerce/admin-kit` — `resolveIcon` answers for both new names.** `ICON_MAP` gains
  `Building2` and `Store`; the function's signature is unchanged and every existing name resolves
  exactly as before.

  **`@endora-commerce/mod-customers`, `@endora-commerce/mod-organizations` and
  `@endora-commerce/mod-sales-channels` ship new i18n keys, and `@endora-commerce/mod-i18n` loses
  six.** `nav.customers.label`, `nav.customersOnline.label`, `nav.organizations.label`,
  `nav.salesChannels.label` and the two new actions' `label`/`description` pairs are in the three
  modules' own `i18n/{en,pl}.json`; `appShell.nav.customers`, `appShell.nav.customersOnline`,
  `appShell.nav.organizations`, `appShell.nav.salesChannels`,
  `appShell.palette.sub.customerAccounts` and `appShell.palette.sub.storefrontChannels` are removed
  from the shared bundle in both shipped languages, nothing rendering them any more. **A consumer
  resolving one of those six keys out of the `core` namespace will get a raw key**; each has a
  module-namespaced replacement above.

  **`organizations` and `sales_channels` declare a new palette action each.**
  `open-organizations` (`/organizations`, `customers:read`) and `open-sales-channels`
  (`/sales-channels`, `sales_channels:read`) replace hand-written rows in the admin's own palette
  table — copies the server was never asked about, which went on advertising the screens whatever
  the effective enabled-set said. One narrowing comes with `open-organizations`:
  `ModuleActionSchema.requiredPermission` is a single string, so it names `customers:read` and a
  role holding only `customers:manage` loses the palette entry while keeping the sidebar one.

- 59c59c6: `cms` and `blog` ship their admin screens, and `cms` publishes its page-builder canvas.

  **Two packages' `./admin` subpath is new, and `@endora-commerce/mod-cms` gains a second UI
  subpath.** Eighteen routes and seven sidebar entries between them, at the paths the
  hand-written host registrations carried, plus `./admin-ui` on `cms` for the one component
  another module renders. The exported symbol on `./admin` is the same one every other module
  package uses — `contributions`, an `AdminContributions` object, and nothing else.
  - `@endora-commerce/mod-cms` — **new `./admin` subpath**, exporting `contributions`. Eleven
    routes: `/cms` and `/cms/pages` (the landing route) on `cms.read`, `/cms/pages/:id`,
    `/cms/blocks`, `/cms/blocks/:id`, `/cms/templates`, `/cms/templates/:id` and `/cms/hooks`
    on `cms.read`, and `/cms/pages/new`, `/cms/blocks/new` and `/cms/templates/new` on
    **`cms.write`**. `/cms` is a second declaration of the page list rather than a redirect,
    because a redirect would be the consuming application's route and not this module's. Four
    sidebar rows, in the `content` section at weights 100 to 400.
  - `@endora-commerce/mod-blog` — **new `./admin` subpath**, exporting `contributions`. Seven
    routes: `/blog/posts` (the landing route), `/blog/posts/:id`, `/blog/categories`,
    `/blog/categories/:id` and `/blog/tags` on `blog.read`, and `/blog/posts/new` and
    `/blog/categories/new` on **`blog.write`**. Three sidebar rows, in the `content` section at
    weights 600 to 800.

  **The five create routes take the write code, and that is a behaviour change for a consumer
  rendering these routes.** Each create screen exists to write — `POST /api/v1/admin/cms/pages`
  and its four siblings enforce the write code — and each module's own palette action
  (`new-page`, `new-post`) already advertised that code. The routes were ungated while they
  belonged to the admin application, so a read-only operator could open a form whose save then
  refused. The five create controls are gated on the same code in this release — the _New page_,
  _New block_, _New template_, _New post_ and _New category_ buttons and the category tree's
  _+ Child_ — so the dead end is closed at both ends. `@endora-commerce/mod-sales-channels`
  ships the identical split for `/sales-channels/new` and `@endora-commerce/mod-credentials` for
  `/credentials/new`.

  **`CategoryTreeNode` takes a new required prop.** It is not exported from any subpath, so this
  affects nobody outside the package; it is recorded because the prop is `canCreate: boolean`
  and required rather than optional — a caller that forgets it does not compile, which is the
  direction a permission gate has to fail in.

  **`@endora-commerce/mod-cms` — new `./admin-ui` subpath, exporting `PageBuilderEditor` and the
  `PageBuilderData` type.** This is the Puck canvas the CMS page, block and template editors
  render and that `@endora-commerce/mod-blog`'s post and category editors render too. Its props
  are `data` in and `onChange` back, so the consumer decides that it appears — a published
  component rather than something the owner contributes to a place of its own choosing. It is
  not in `@endora-commerce/admin-kit` because it is a `@measured/puck` host and the kit is what
  every module's admin layer compiles against, and not in
  `@endora-commerce/page-builder-admin` because it calls this module's API client, reads this
  module's translation namespace and lays the CMS page container out — that package holds the
  builder chrome that names no module at all.

  **`@endora-commerce/mod-blog` gains `@endora-commerce/mod-cms` as a peer dependency**, which
  is what a published component costs: the reach survives into the emitted JavaScript, so a
  consumer bundling `blog`'s admin layer must resolve `cms`. It is not a `dependency` — a module
  reaches another through a port declared in its manifest, never through npm — and it is not
  optional. A consumer that installs `@endora-commerce/mod-blog` without `@endora-commerce/mod-cms`
  will fail to resolve `@endora-commerce/mod-cms/admin-ui` at bundle time. There is no runtime
  half to worry about: `blog`'s module manifest already declares `cms` in its `dependencies`, so
  a platform where `cms` is absent or switched off is one where `blog` cannot be activated
  either.

  **`@endora-commerce/mod-cms` and `@endora-commerce/mod-blog` ship new i18n keys, and
  `@endora-commerce/mod-i18n` loses seven.** `nav.cmsPages.label`, `nav.cmsBlocks.label`,
  `nav.cmsTemplates.label`, `nav.cmsHooks.label`, `nav.blogPosts.label`,
  `nav.blogCategories.label` and `nav.blogTags.label` are in the two modules' own
  `i18n/{en,pl}.json`; `appShell.nav.cmsPages`, `appShell.nav.cmsBlocks`,
  `appShell.nav.cmsTemplates`, `appShell.nav.cmsHooks`, `appShell.nav.blogPosts`,
  `appShell.nav.blogCategories` and `appShell.nav.blogTags` are removed from the shared bundle
  in both shipped languages, nothing rendering them any more. **A consumer resolving one of
  those seven keys out of the `core` namespace will get a raw key**; each has a
  module-namespaced replacement above.

  **Neither module declares a new palette action, and neither loses one.** `cms` has declared
  `new-page` and `blog` `new-post` all along, and the admin application's own palette table
  never carried a hand-written row for either — so unlike batches 10, 13 and 14 there was
  nothing to convert.

- 21dac4f: `dictionaries`, `settings` and `credentials` ship their admin surfaces, and a module can
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
    switched off the caller must render nothing rather than a modal over an API that answers 503.
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

- 43e1968: `price_lists`, `quick_order`, `inventory` and `pim_ergonode` ship their admin screens, and
  four icon names join the allowlist.

  **Four packages' `./admin` subpath gains `routes` and `nav`.** All four already exported
  `contributions` from `@endora-commerce/mod-<id>/admin` with a `zones` array and nothing else;
  each now declares its screens there too, at the paths and codes the hand-written host
  registrations carried. Sixteen routes and nine sidebar entries between them. The exported
  symbol is unchanged — `contributions`, an `AdminContributions` object, and nothing else — so a
  consumer already reading the zones needs no edit; what is new is that the same object now
  answers for the screens.
  - `@endora-commerce/mod-price-lists` — `/price-lists` (the landing route),
    `/price-lists/display-modes` and `/price-lists/:id`, all on `price_lists:read`, which is the
    code the module's single `readGate` enforces on every `GET` behind them; each screen keeps
    gating its own saves on `price_lists:write` inside itself. One sidebar row, in the `pricing`
    section at weight 100. The display-mode screen is reached from a button on the roster and the
    detail screen from the roster itself, so neither has a row of its own.
  - `@endora-commerce/mod-quick-order` — `/orders/quick-order` on `orders:write`, the code both
    `POST`s behind the screen enforce; there is no `quick_order:*` permission in the platform at
    all. **No sidebar row**, which is the host table's own decision kept: quick order is the
    other way of getting lines into one order, reached from the `order.entry.tabs` strip this
    package already contributes into.
  - `@endora-commerce/mod-inventory` — seven routes: `/inventory` (the landing route),
    `/inventory/low-stock`, `/inventory/notifications`, `/warehouses`, `/warehouses/new` and
    `/warehouses/:id` on `inventory:read`, and `/inventory/import` on `inventory:write`, the
    code its `POST` enforces. Five sidebar rows in the `inventory` section at weights 100 to 500,
    the order the host table had. Both of this module's admin surface directories moved: the
    warehouse screens and their client are here too, the sidebar having always attributed
    `/warehouses` to this module.
  - `@endora-commerce/mod-pim-ergonode` — `/pim-ergonode` (the landing route),
    `/pim-ergonode/attribute-mappings`, `/pim-ergonode/category-mappings`, `/pim-ergonode/runs`
    and `/pim-ergonode/runs/:runId`, all on `pim_ergonode:read`. One sidebar row, `catalog`,
    weight 250 — between `@endora-commerce/mod-assets-library`'s 200 and
    `@endora-commerce/mod-pim-pimcore`'s 300, which is the placement both of those packages'
    declarations already describe. Its admin client moved with the screens and is now
    `src/admin/api/ergonode-client.ts` beside the protections client P4b split out.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **`@endora-commerce/contracts` gains four `KnownIconNameSchema` members** — `Warehouse`,
  `TrendingDown`, `Bell` and `PackageOpen`. Additive: no existing member changes, and
  `KnownIconName` widens rather than narrowing, so no consumer that names an icon today stops
  compiling. They are the four glyphs `inventory`'s sidebar rows carried, which the host imported
  from `lucide-react` by hand; a contribution names its icon rather than importing it, so without
  them four rows would have had to degrade to names already on the allowlist.

  **`@endora-commerce/admin-kit` maps the same four names** in `resolveIcon`. A caller passing one
  of them now gets the matching `lucide-react` component instead of the `Sparkles` fallback.

  **`@endora-commerce/mod-price-lists` declares its first palette action**, `open-price-lists`,
  targeting `/price-lists` on `price_lists:read`. It replaces a hand-written row in the admin
  shell and carries that row's destination, code and keywords, so an operator's ⌘K answer is
  unchanged; what changes is that the advertisement is now resolved from the manifest against the
  effective enabled-set. `@endora-commerce/mod-inventory` declares no new action: its
  hand-written row was a second copy of `open-inventory` and is simply gone.

  **`@endora-commerce/mod-i18n` loses thirteen keys** — the eight `appShell.nav.*` labels the
  four modules' sidebar rows rendered, two `appShell.palette.sub.*` subtitles, and
  `appShell.crumb.importRun` — in both shipped languages. Each moved into the owning module's own
  bundle under a module-relative key (`nav.priceLists.label`, `nav.stockOverview.label`,
  `nav.warehouses.label`, `nav.lowStock.label`, `nav.notifyWhenAvailable.label`,
  `nav.importStock.label`, `nav.pimErgonode.label`), or was retired with the hand-written
  breadcrumb rule that was its only reader. A consumer resolving one of those keys out of the
  shared bundle gets nothing; resolve it in the owning module's namespace instead.

- a28c796: `invoices`, `ksef` and `quote_requests` ship their admin surfaces, and the first zone whose
  host is a module package.

  **New `./admin` subpath on three packages.** `@endora-commerce/mod-invoices`,
  `@endora-commerce/mod-ksef` and `@endora-commerce/mod-quote-requests` each export
  `contributions` — an `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`, and
  nothing else. Eight routes and three sidebar entries between them, all at the paths and codes
  the hand-written host registrations carried:
  - `mod-invoices` — `/invoices` (the landing route), `/invoices/templates`,
    `/invoices/templates/:id` and `/invoices/:id`, all on `invoices:read`, which is the code
    every `GET` behind those four screens enforces; each screen keeps gating its own writes on
    `invoices:write` inside itself. One sidebar row, in the `sales` section at weight 500. The
    two template screens deliberately have no row: they are reached through
    `InvoiceSectionTabs`, which this package already owned.
  - `mod-ksef` — `/ksef` on `ksef:read`. One sidebar row, `sales`, weight 600. Its glyph is
    `Receipt` rather than the `ReceiptText` the host table rendered by hand, because
    `KnownIconNameSchema` does not carry the second and `Receipt` is what this module's
    `open-ksef` palette action has always named.
  - `mod-quote-requests` — `/quote-requests` (the landing route), `/quote-requests/new` and
    `/quote-requests/:id`, all on `rfqs:handle`, which is the module's only code and the one
    its admin routes build a single guard from. One sidebar row, `sales`, weight 400.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **`@endora-commerce/contracts` gains one zone member and its props.**
  `AdminZoneNameSchema` carries `'invoice.detail.after'` and `AdminZonePropsMap` maps it to the
  new exported interface `InvoiceDetailZoneProps { invoiceId: string; kind: InvoiceKind;
ksefReferenceNumber: string | null }`. Additive: no existing member, props type or export
  changes. A host mounts it with

  ```tsx
  <AdminZone name="invoice.detail.after" props={{ invoiceId, kind, ksefReferenceNumber }} />
  ```

  and a contributor declares
  `zoneComponent('invoice.detail.after', () => import('./MyPanel.js'), { weight, requiredPermission })`,
  whose module's default export is constrained to `ComponentType<InvoiceDetailZoneProps>`.

  **`@endora-commerce/mod-ksef` publishes the first contribution into another package's screen.**
  `InvoiceKsefPanel` is a zone component now — same rendering, same `ksef:read` gate, same
  proforma guard — and `@endora-commerce/mod-invoices` renders the place rather than importing
  the panel. Neither package names the other in any specifier. It is a zone and not a published
  component because the panel's signature is three values in and nothing out; and it carries no
  `match`, because the place has a single host and a single mount, and `match` has no negation to
  write "not a proforma" with.

  **`@endora-commerce/mod-i18n` loses four keys nothing renders any more** —
  `appShell.nav.invoices`, `appShell.nav.ksef`, `appShell.nav.quoteRequests` and
  `appShell.palette.sub.customerRfqs`. Each module's sidebar label is module-relative now
  (`nav.invoices.label`, `nav.ksef.label`, `nav.quoteRequests.label`) and ships in that module's
  own `i18n/` bundle in both shipped languages.

- 1fdeada: Add `composeErrorTranslationTargets(manifests)`, the error-code routing map a composition root
  injects while feature 090's migration is in flight.

  `buildErrorTranslationTargets` (shipped in the previous release) answers only from the modules'
  own `errorCodes` declarations, which is the end state. Nothing declares a code yet, so injecting
  it alone would empty the map and take every operator-visible sentence in both shipped languages
  out of reach at once. `composeErrorTranslationTargets` is the transitional shape:
  - a code its owner has declared routes to that owner;
  - a code nobody has declared yet keeps the answer `ERROR_TRANSLATION_KEYS` gives it;
  - a code more than one module declares routes to **neither**, and is absent from the map even
    when the incumbent table has an answer for it — the incumbent is not a tie-break
    (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md` §3.4).

  The collisions come out of the same call, so the report and the routing cannot disagree.

  ```ts
  const { targets, collisions } = composeErrorTranslationTargets(await resolvedManifestEntries());
  buildServer({ errorEnvelope: { errorTranslationTargets: targets } });
  ```

  It is deleted together with `ERROR_TRANSLATION_KEYS` when the last module migrates; callers then
  pass the same argument to `buildErrorTranslationTargets`. No routing answer changes in this
  release — the two are asserted equal over the whole of `ERROR_CODES`.

- 0e8e473: `linkedin_ads` and `meta_ads` ship their admin surfaces, on a new `./admin` subpath each.

  Each package now exports `contributions` from `@endora-commerce/mod-linkedin-ads/admin` and
  `@endora-commerce/mod-meta-ads/admin` — three routes (the mapping list, `/new` and `/:id`)
  and one sidebar entry — as an `AdminContributions` object. Every component is a
  dynamic-import factory, and the two editor routes share one factory value, so a consumer's
  bundler emits one chunk for the editor rather than two.

  Three things a consumer has to know:
  - **The sidebar label moved namespace.** `appShell.nav.linkedinAds` and
    `appShell.nav.metaAds` were in `@endora-commerce/mod-i18n`'s shared `core` bundle; they
    are now `nav.linkedInAds.label` and `nav.metaAds.label` in each package's own `i18n/`,
    resolved in the module's own scope. Anything reading an old key gets a raw key back. The
    text itself is unchanged in both languages. The screens' own keys did not move — they
    were already in each module's bundle.
  - **Each admin API client gains `listSalesChannels()`.** The two screens label a mapping's
    channel, and they used to do it by importing `sales_channels`' admin client out of the
    admin application. They now call `GET /api/v1/admin/sales-channels?activeOnly=false&pageSize=100`
    themselves and type the answer with `SalesChannelListResponse` from
    `@endora-commerce/contracts`. It is deliberately duplicated in the two packages rather
    than shared: the only place two modules could share it is `@endora-commerce/admin-kit`,
    and the kit holds no module knowledge.
  - **Each package peers on `@endora-commerce/admin-kit`, `react` and `react-router-dom`.**
    They are peers rather than dependencies for the reason `page-builder-core` is: the
    application must resolve exactly one copy, and a provider in one copy against a consumer
    in the other is a `null` context at runtime rather than a type error.

- 3c8102e: `analytics` ships its admin surface, on a new `./admin` subpath.

  The package now exports `contributions` from `@endora-commerce/mod-analytics/admin` — one
  route (`/analytics`) and one sidebar entry — as an `AdminContributions` object. The
  component is a dynamic-import factory, so a consumer's bundler splits the screen without
  being asked.

  Three things a consumer has to know:
  - **Every string the dashboard renders moved namespace.** The fourteen `analytics.*` keys
    and `appShell.nav.analytics` were in `@endora-commerce/mod-i18n`'s shared `core` bundle;
    they are now `page.title`, `range.7days`, `nav.analytics.label` and so on in this
    package's own `i18n/`, resolved in the `analytics` scope. Anything reading an old key
    gets a raw key back. The text itself is unchanged in both languages.
  - **The module declares a command-palette action, `open-analytics`.** It had an admin
    screen and a sidebar entry since feature 018 and no ⌘K entry, which Principle XVI says is
    not enough. It gates on `analytics:read`, the code `GET /api/v1/admin/analytics/summary`
    enforces.
  - **The package peers on `@endora-commerce/admin-kit`, `react` and `lucide-react`.** They
    are peers rather than dependencies for the reason `page-builder-core` is: the application
    must resolve exactly one copy, and a provider in one copy against a consumer in the other
    is a `null` context at runtime rather than a type error.

- a92d972: `google_analytics` ships its admin surface, on a new `./admin` subpath.

  The package now exports `contributions` from `@endora-commerce/mod-google-analytics/admin`
  — three routes (`/google-analytics`, `/google-analytics/new`, `/google-analytics/:id`) and
  one sidebar entry — as an `AdminContributions` object. Every component is a dynamic-import
  factory, so a consumer's bundler splits the screens without being asked; the two editor
  routes share one factory, so they are one chunk and not two.

  Two things a consumer has to know:
  - **The sidebar label moved namespace.** It was `appShell.nav.googleAnalytics` in
    `@endora-commerce/mod-i18n`'s shared `core` bundle and is now
    `nav.googleAnalytics.label` in this package's own `i18n/`, resolved in the
    `google_analytics` scope. Anything reading the old key gets a raw key back.
  - **The package peers on `@endora-commerce/admin-kit`, `react` and
    `react-router-dom`.** They are peers rather than dependencies for the reason
    `page-builder-core` is: the application must resolve exactly one copy, and a provider in
    one copy against a consumer in the other is a `null` context at runtime rather than a type
    error.

- 63be98c: A module can declare the error codes it owns, and a branded type keeps a typo out of a raise site

  Feature 090 (`specs/090-module-owned-error-codes/`), Phase 1 of D-182. Nothing routes
  differently yet — the prefix chain in `@endora-commerce/mod-i18n` is untouched and is still
  what the composition roots inject.

  **`@endora-commerce/contracts`**
  - `ModuleManifest` gains `errorCodes?: { code: string; tokens?: string[] }[]` — the codes a
    module owns. The sentence for each still lives in the module's own
    `i18n/<language>.json` under `errors.<CODE>`; there is deliberately no `message` field,
    because the raising code's own English already exists and can interpolate.
    `defineModuleManifest` refuses four things, naming the module and the code: a code that is
    not SCREAMING*SNAKE_CASE, the same code twice in one manifest, a refusal token that does not
    match `^[a-z]a-z0-9*]\*$`, and the same token twice under one code.
  - New: `defineModuleErrorCodes(['ACME_SYNC_REJECTED'])` returns each code as a branded
    `ModuleErrorCode`. This is the authoring shape for a module's own codes, and it is
    mandatory rather than a convenience — a bare string literal is assignable to neither
    `ErrorCode` nor `ModuleErrorCode`, so a typo at a raise site is a compile error. It does
    **not** make a typo in an `error.code === '…'` comparison an error; that is unchanged and
    measured.
  - New: `errorCodeRe`, `errorCodeTokenRe`, `ModuleErrorCodeDeclarationSchema`.
  - `errorEnvelopeSchema.error.code` relaxes from `z.enum(Object.values(ERROR_CODES))` to a
    regex over the same grammar, so a module-declared code validates. `ERROR_CODES` and
    `ErrorCode` are unchanged and stay closed. `ErrorEnvelope['error']['code']` is now
    `ErrorCode | ModuleErrorCode`: every value valid before is valid after, in both directions.

  **`@endora-commerce/platform`**
  - `HttpError`'s `code` parameter and field widen from `ErrorCode` to
    `ErrorCode | ModuleErrorCode`. Purely a relaxation; no call site changes.

  **`@endora-commerce/mod-i18n`**
  - New: `buildErrorTranslationTargets(manifests)`, which derives the routing map from the
    modules' own declarations, and `describeErrorCodeCollisions`. Two modules declaring one
    code routes it to **neither** and names every claimant with the file that declares it —
    there is no tie-break by origin, order or id, because each of those renders one raiser's
    condition under the other's sentence with no symptom anyone can detect. Exported but not
    yet wired: the composition roots still inject `ERROR_TRANSLATION_KEYS`.
  - `ErrorTranslationTarget['key']` widens from `errors.${ErrorCode}` to `errors.${string}`.

- 10bca4a: `_i18n` is a module package — the 66th of 67, and the one whose boot pass loads
  every other module's translation bundles.

  It publishes a root export (its manifest, its `lifecycleParticipant` and its two
  `cliCommands`), `./migrations`, and `./backend`, which carries `registerModule`,
  the `entities` array and the surface the host and the test tree reach:

  ```diff
  -import { ERROR_TRANSLATION_KEYS } from './modules/_i18n/services/error-translation.js';
  -import type { AdminI18nCradle } from './modules/_i18n/backend.js';
  +import { ERROR_TRANSLATION_KEYS, type AdminI18nCradle } from '@endora-commerce/mod-i18n/backend';
  ```

  Also published from `./backend`, each because something outside the module
  constructs or calls it: `I18nService`, `MissingKeyLogger`, `loadModuleBundles`
  and `BundleLoadError`, `reconcileBundles`, and `registerI18nAdminRoutes` with
  `I18nAdminDeps`. Nothing else moved — the container names are unchanged
  (`adminI18nService`, `adminI18nReconciler`), the module id stays `_i18n`, and the
  `translation_bundles` migration keeps its class name.

  **The npm name drops the leading underscore**: `_i18n` publishes as
  `@endora-commerce/mod-i18n`, which is what `manifests:generate` has always
  derived and what `_lifecycle` will do too.

  **The bundles ship from the package root, not from `dist`.** `packages/modules/_i18n/i18n/`
  is in `files` beside `dist`, because the platform anchors a module's `bundlesDir`
  to the module's own directory — for a package that is the directory holding its
  `package.json`. That is the same rule every module package with translations
  already follows; it matters more here only because this module is the one doing
  the loading. Verified from the compiled tree rather than assumed: `node`, over
  `backend/dist`, loads bundles for all 46 modules that declare them, none empty.

  Two things this move retired rather than changed:
  - `i18n-service.ts` re-exported `SUPPORTED_LANGUAGES` and `BundleLoadError`
    "for tests / consumers" and had neither. The first is
    `@endora-commerce/contracts`', the second is published by `./backend`. Import
    them from there.
  - `error-translation.ts` is now reached through `./backend`, so the map both
    composition roots inject into the error envelope is no longer a root's import
    out of the application's module tree. The drain that entry was waiting for —
    declaring the code→key mapping beside the codes in
    `@endora-commerce/contracts` — is still available and still worth doing.

- 5a2878a: Fourteen `rfq.detail.*` keys in `en` and `pl` for the quote-request validity deadline the
  operator now sets from the request's own detail screen.

  `rfq.detail.validity.*` covers the deadline field, its five help sentences (the preview of the
  date a save would write, the three "what leaving this blank keeps" answers, and the refusal for
  a value the contract would reject) and the two remedies a lapsed request offers depending on
  whether it can still be modified. `rfq.detail.badge.validityEnded` and
  `rfq.detail.meta.validityEnded` are the third sentence about a field that previously had two:
  a deadline already behind us used to render through `rfq.detail.meta.expires`, which reads as a
  promise still standing.

  No key is renamed or removed; a consumer on the previous bundle resolves everything it did
  before.

- 09df879: The shared admin page-builder chrome's copy moves out of `mod-cms`' bundle and into
  `mod-i18n`'s, which the admin serves under the synthetic `core` scope (feature 091 P5a;
  ruling R-1: a translation namespace is module knowledge, and this copy is nobody's).

  **`@endora-commerce/mod-cms`' bundle loses 33 keys**, every one of them under
  `pageBuilder.*` and every one of them read only by `PageBuilderHeaderActions.tsx` — the
  header shell, the template actions and the header tools that `cms`, `invoices` and the
  e-mail builder all render. The blocks that moved whole are
  `pageBuilder.saveAsTemplate.*` (9), `pageBuilder.applyTemplate.*` (9),
  `pageBuilder.copyLanguage.*` (8, minus `emptySource`), `pageBuilder.clearCanvas.*` (5) and
  `pageBuilder.fullscreen.*` (2). The bundle keeps its other 65 `pageBuilder.*` keys —
  `components.*`, `categories.*`, `drawer.*`, `copyLanguage.emptySource` and the rest — which
  belong to `cms`' own screens, and it keeps `common.saving`, `fields.name` and `fields.code`,
  which its editors read.

  **`@endora-commerce/mod-i18n` gains those 33 plus three new `common.*` entries**:
  `common.state.saving`, `common.field.name` and `common.field.code`. They are additions
  rather than moves because `cms` reads its own copies of the same three concepts from its own
  screens; no existing `core` key carried those values.

  **What a consumer that supplies its own bundle has to do:** move the 33 `pageBuilder.*` keys
  from the `cms` scope into `core`, and add the three `common.*` entries. A key left behind
  does not fail to compile and does not 404 — it renders `core.pageBuilder.clearCanvas.button`
  into the operator's screen as a label.

  `common.state.saving` is `"Saving…"` / `"Zapisywanie…"`, with the typographic ellipsis its
  `common.state.loading` sibling uses, where `cms`' own `common.saving` is `"Saving..."`. That
  is the one rendered character this release changes.

- 1f07b01: The fifteen `pageBuilder.colorPalette.*` strings move from `mod-cms`' bundle into
  `mod-i18n`'s, in both shipped languages (feature 091, P5b — the remedy P5a applied to the
  other thirty-three chrome keys, arriving for the one chrome file P5a's set did not include).

  `ColorPaletteModal` is the shared page-builder chrome's, not `cms`' screen: `cms`,
  `invoices` and the e-mail builder all render it, and it now ships in
  `@endora-commerce/page-builder-admin`. A package cannot depend on one module's bundle for
  strings three modules read, and a namespace is resolved at runtime by string — so a key the
  namespace does not carry renders `cms.pageBuilder.colorPalette.title` into the operator's
  screen instead of failing. The keys therefore live where the reader does, which for chrome
  is the synthetic `core` scope `mod-i18n` serves.

  **If you ship a translation override** keyed `cms.pageBuilder.colorPalette.*`, re-key it to
  `core.pageBuilder.colorPalette.*`. The fifteen keys, their values and both languages are
  otherwise unchanged; no other `cms` key moves, and the other sixty-five `pageBuilder.*` keys
  in `mod-cms`' bundle are its own screens' and stay.

- 0ec3f95: A permission declares what it depends on, and a catalogue row says who owns it.

  **`@endora-commerce/contracts`.** `modulePermissionDeclarationSchema` gains an
  optional `requires: string[]` — the codes a role holding this one also needs
  before the surface it opens is whole. It is advisory: no guard reads it, no role
  upsert is refused, and it is **not** a lifecycle edge, so declaring it does not
  put the named code's owner into your module's `dependencies` and does not stand
  in the way of an operator switching that owner off.

  ```ts
  // packages/modules/<id>/src/manifest.ts
  permissions: [
    { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
  ],
  ```

  `permissionCatalogueEntrySchema` — the row `GET /api/v1/admin/permissions`
  returns, and the return type of `PermissionCataloguePort.listAssignable()` —
  gains `owners: string[]` (required) and `requires?: string[]`. `owners` is the
  set of modules whose presence keeps the code grantable, and it is **not** the
  existing `module` field, which is a display grouping: `_lifecycle` files its
  codes under `module: 'module_lifecycle'`, which is no module id, and a shared
  code such as `integrations:manage` has two owners and one grouping.

  Readers need no change — the two fields are additive on the wire. **If you
  construct a `PermissionCatalogueEntry`** (a test double, a second implementation
  of `PermissionCataloguePort`), add `owners`:

  ```ts
  // before
  const row: PermissionCatalogueEntry = { code: 'blog.read', module: 'blog', label: 'View' };
  // after
  const row: PermissionCatalogueEntry = {
    code: 'blog.read',
    module: 'blog',
    label: 'View',
    owners: ['blog'],
  };
  ```

  New export `missingPermissionRequirements(granted, catalogue)`: the codes a role
  holding `granted` is advised to add, over the catalogue rows the platform
  already merged. It skips a requirement naming a code the given rows do not
  offer, and advises a `'*'` role nothing. It exists so that the role editor and
  the permission inventory read one function rather than two.

  **`@endora-commerce/mod-admin-roles`.** `PermissionCatalogueService` puts
  `owners` and `requires` on every row it merges, unions `requires` across every
  declarer of a shared code, and gains `listRequirementsByCode()`.

  **`@endora-commerce/mod-admin-users`.** The role editor renders the shortfall for
  the codes currently ticked, with a one-click add, and shows a row's owner set
  wherever it says something the display grouping does not.

  **`@endora-commerce/mod-quote-requests`.** Declares `rfqs:handle` with
  `requires: ['price_lists:read']` — the RFQ create screen prefills a price from a
  `price_lists` route, so a role holding only `rfqs:handle` falls back to manual
  entry.

  **`@endora-commerce/mod-i18n`.** Six `adminRoles.*` keys for the above, in both
  shipped languages.

- ca3fd67: `@endora-commerce/mod-pim-unopim/admin` declares the module's screens

  The `contributions` export gains `routes` and `nav` beside the three `zones` it already
  carried. Seven routes — `/pim-unopim`, its four mapping screens, `/pim-unopim/runs` and
  `/pim-unopim/runs/:runId` — and one sidebar entry in the `catalog` section at weight 400,
  all gated on `pim_unopim:read`. Every route component is a dynamic-import factory whose
  module has a default export, which is what the admin's registry loads.

  An application composing this package no longer needs to register any of it. If you were
  importing these screens from `admin/src/modules/pim_unopim/`, that directory is gone: the
  seven pages, the admin API client (now `./admin`'s `api/unopim-client.js`), `format.ts` and
  the section-tab, run-badge and issue-list components all ship inside the package. So do
  `PimRunStatusBadge` and `PimIssueList`, which were briefly shared with
  `@endora-commerce/mod-pim-ergonode` through a host directory; that module renders its own
  badge, so these are `pim_unopim`'s. They are **not** exported — a second connector wanting
  that chrome should get it from a published subpath rather than by reaching in.

  `@endora-commerce/mod-i18n`'s shared bundle loses nine keys in both shipped languages: the
  seven `appShell.nav.pimUnopim*` entries the host sidebar and its breadcrumb rules rendered,
  which the module's own `nav.pimUnopim.label` replaces, and the two
  `adminRoles.permission.pim_unopim:*` labels, which move into this module's own bundle where
  a module's permission labels belong. No wording changed.

### Patch Changes

- f8ffc57: `currencies` and `inventory` declare their own permission codes, and their admin routes enforce
  them instead of the catalogue's and the order module's. `currencies` also takes back the four
  routes `languages` was registering on its behalf.

  **Breaking for anyone whose roles reach either module's admin API, and for anyone importing
  `I18nRoutesDeps` from `@endora-commerce/mod-languages/backend`.**

  ## `currencies` — four routes and a new owner

  The routes moved module _and_ code. They were registered by `languages` and gated on
  `catalog:write` — all four, the list read included, so seeing the currency table required the
  authority to delete a row from it:

  ```
  GET    /api/v1/admin/currencies            languages, catalog:write -> currencies, currencies:read
  PUT    /api/v1/admin/currencies/:code      languages, catalog:write -> currencies, currencies:write
  POST   /api/v1/admin/currencies/:code/default  languages, catalog:write -> currencies, currencies:write
  DELETE /api/v1/admin/currencies/:code      languages, catalog:write -> currencies, currencies:write
  ```

  `registerI18nRoutes`' `I18nRoutesDeps` no longer takes `currencyAdmin`; `currencyRead` stays, for
  `GET /api/v1/i18n/config`, which composes both catalogues into one public payload and is
  unchanged. The new entry point is `registerCurrencyRoutes` in
  `@endora-commerce/mod-currencies/backend` — but a host does not call it: the module registers its
  own routes through `ctx.routes`, which is what makes the module-presence gate structural instead
  of a note in a comment.

  `@endora-commerce/mod-currencies` gains `auth` in its manifest `dependencies` (it resolves
  `requireAdmin` now) and `fastify` in its peer dependencies.

  ## `inventory` — 21 gates

  Nine reads on `orders:read` and twelve writes on `catalog:write`, all of them over this module's
  own tables: warehouses, stock levels, display-band thresholds, the back-in-stock queue, the CSV
  importer, and the channel↔warehouse assignment that decides which stock a channel may sell.
  Every one is now `inventory:read` or `inventory:write`.

  The channel↔warehouse routes are the ones to look at if you embed
  `admin/src/modules/warehouses/ChannelMembershipPanel`: a role that may edit a sales channel and
  holds no inventory code now sees no panel, where before it saw one backed by `catalog:write`.

  `open-inventory`, the module's ⌘K action, moves from `orders:read` to `inventory:read` with its
  route.

  ## No data migration, in both cases

  Granting the new codes to every holder of `catalog:write` or `orders:read` would reproduce the
  distribution the split exists to remove, which would make this a change of spelling rather than
  of authority. A role that reached these screens through the borrowed codes is granted the new
  ones explicitly on `/admin-roles`, where the manifests put them automatically.

  `@endora-commerce/mod-i18n` carries the four `adminRoles.permission.*` labels and the inventory
  screens' refusal notice, in `en` and `pl`.

- 9611d37: Error-code ownership: the `KSEF_*` and `PIM_ERGONODE_*` families are declared by the modules
  that own their nouns.

  `manifest.errorCodes` on `@endora-commerce/mod-ksef` gains its seven codes and on
  `@endora-commerce/mod-pim-ergonode` its thirteen; `@endora-commerce/mod-i18n` drops the same
  twenty from its own declaration, which is what decides where the error envelope looks for a
  sentence (D-129's remaining sweep, MR 2 of eight; D-121 tier T1;
  `specs/090-module-owned-error-codes/d129-sweep.md`).

  For a consumer this changes which bundle answers for those codes and nothing else. No wire
  shape moves — `error.code` is unchanged — and no sentence moves either: none of the twenty has
  a translation in `en` or `pl` today, in any bundle, so a Polish reader sees exactly what they
  saw before. What a downstream author gains is that writing one of those sentences is now a
  change to the module's own `i18n/{en,pl}.json` rather than to the platform's.

- 3786732: Error-code ownership: the rest of Tier A is declared by the modules that own its nouns.

  `manifest.errorCodes` gains six codes on `@endora-commerce/mod-prompt-actions`
  (`ASSISTANT_*`, `PROMPT_*`), five on `@endora-commerce/mod-custom-fields` (`CUSTOM_FIELD_*`),
  two on `@endora-commerce/mod-customers` (`CUSTOMER_ADDRESS_NOT_FOUND`,
  `REGISTRATION_REQUIRES_ORGANIZATION`), two on `@endora-commerce/mod-shopping-lists`
  (`SHOPPING_LIST_*`), one on `@endora-commerce/mod-price-lists` (`PRICE_LIST_NOT_FOUND`) and one
  on `@endora-commerce/mod-transactional-emails` (`TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE`);
  `@endora-commerce/mod-i18n` drops the same seventeen from its own declaration, which is what
  decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 3 of eight;
  D-121 tiers T1 and T2; `specs/090-module-owned-error-codes/d129-sweep.md`).

  For a consumer this changes which bundle answers for those codes. No wire shape moves —
  `error.code` is unchanged — and no sentence is relocated: none of the seventeen had a
  translation in `en` or `pl` in any bundle. Writing one of those sentences is now a change to the
  owning module's own `i18n/{en,pl}.json` rather than to the platform's.

  `@endora-commerce/mod-shopping-lists` gains an `i18n` bundle it never had, declared as
  `i18n: { bundlesDir: 'i18n' }` and shipped in `files`. It holds the two `SHOPPING_LIST_*`
  sentences in both languages, which is an operator- and buyer-visible improvement: a Polish
  reader refused a delete of the default or the last shopping list now reads Polish prose instead
  of the English the raise site carries.

- 5d9bb88: Error-code ownership: Tier B's six already-bundled modules declare the codes they own, and eight
  placeholder sentences leave the platform bundle.

  `manifest.errorCodes` gains seven codes on `@endora-commerce/mod-customer-accounts`
  (`ACCOUNT_BLOCKED`, `CANNOT_DEMOTE_LAST_ADMIN`, `CANNOT_REMOVE_LAST_ADMIN` and the four
  `CUSTOMER_*` record codes), six on `@endora-commerce/mod-catalog` (`BULK_TOO_LARGE`, the three
  `PACKAGING_UNIT_*` codes, `SELECTION_TOO_LARGE`, `SYSTEM_ATTRIBUTE_SET_IMMUTABLE`), three on
  `@endora-commerce/mod-orders` (`CURRENCY_MISMATCH`, `IDEMPOTENCY_KEY_REQUIRED`,
  `IDEMPOTENCY_KEY_REUSED`), two on `@endora-commerce/mod-mfa` (`TWO_FACTOR_REQUIRED`,
  `TWO_FACTOR_REQUIRED_BY_ROLE`), one on `@endora-commerce/mod-newsletter`
  (`ALREADY_SUBSCRIBED`) and one on `@endora-commerce/mod-promotions` (`PROMOTION_INVALID`);
  `@endora-commerce/mod-i18n` drops the same twenty from its own declaration, which is what
  decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 4 of eight;
  D-121 tiers T1 and T2; D-186 §1 and §2 in `specs/080-f4-real-scope/rulings.md`;
  `specs/090-module-owned-error-codes/d129-sweep.md`).

  `@endora-commerce/mod-customer-accounts`, `@endora-commerce/mod-newsletter` and
  `@endora-commerce/mod-promotions` declare an error code for the first time. No wire shape moves:
  `error.code` is unchanged for all twenty.

  **Eight sentences are deleted from `@endora-commerce/mod-i18n`'s bundle, and this is
  operator-visible.** Each was the error code rewritten twice — `"Currency Mismatch."` in `en` and
  `"Błąd: currency mismatch."` in `pl` — which D-186 §2 refuses to carry into a module's own
  bundle, where it would read as that module's answer rather than as an unwritten sentence. Four
  of the eight are replaced by real prose in both languages in the receiving module's own bundle:
  - `errors.SYSTEM_ATTRIBUTE_SET_IMMUTABLE` in `@endora-commerce/mod-catalog`
  - `errors.CANNOT_DEMOTE_LAST_ADMIN` and `errors.CANNOT_REMOVE_LAST_ADMIN` in
    `@endora-commerce/mod-customer-accounts`
  - `errors.CURRENCY_MISMATCH` in `@endora-commerce/mod-orders`

  The other four — `TWO_FACTOR_REQUIRED`, `TWO_FACTOR_REQUIRED_BY_ROLE`, `ALREADY_SUBSCRIBED` and
  `PROMOTION_INVALID` — are codes nothing in the platform raises, so there was no refusal to
  describe and the placeholder is deleted without a replacement. A consumer that reads those keys
  out of `@endora-commerce/mod-i18n`'s bundle directly will no longer find them; nothing in the
  platform produced the codes they belonged to.

- 3b07abc: Error-code ownership: Tier B's four remaining modules declare the codes they own, each shipping its
  first i18n bundle.

  `manifest.errorCodes` gains five codes on `@endora-commerce/mod-credit-limits`
  (`ACTIVE_RESERVATIONS_EXIST`, `ADJUSTMENT_BELOW_ACTIVE`, `CREDIT_LIMIT_ALREADY_GRANTED`,
  `CREDIT_LIMIT_NOT_GRANTED`, `LIMIT_INSUFFICIENT`), three on `@endora-commerce/mod-api-keys`
  (`API_KEY_CHANNEL_MISMATCH`, `API_KEY_NOT_BOUND`, `API_KEY_OUT_OF_SCOPE`), two on
  `@endora-commerce/mod-addresses` (`ADDRESS_IN_USE`, `ADDRESS_NOT_OWNED`) and one on
  `@endora-commerce/mod-webhooks` (`WEBHOOK_DELIVERY_NOT_REPLAYABLE`); `@endora-commerce/mod-i18n`
  drops the same eleven from its own declaration, which is what decides where the error envelope
  looks for a sentence (D-129's remaining sweep, MR 5 of eight; D-121 tier T1 throughout; D-186 §2
  and §3 in `specs/080-f4-real-scope/rulings.md`;
  `specs/090-module-owned-error-codes/d129-sweep.md`).

  All four declare an error code for the first time, and all four gain an `i18n` bundle they never
  had, declared as `i18n: { bundlesDir: 'i18n' }` and shipped in `files`. No wire shape moves:
  `error.code` is unchanged for all eleven.

  **Nine sentences are deleted from `@endora-commerce/mod-i18n`'s bundle, and this is
  operator-visible.** Each was the error code rewritten twice — `"Limit Insufficient."` in `en` and
  `"Błąd: limit insufficient."` in `pl` — which D-186 §2 refuses to carry into a module's own bundle,
  where it would read as that module's answer rather than as an unwritten sentence. Six of the nine
  are replaced by real prose in both languages in the receiving module's own bundle:
  - `errors.ADJUSTMENT_BELOW_ACTIVE`, `errors.CREDIT_LIMIT_ALREADY_GRANTED`,
    `errors.CREDIT_LIMIT_NOT_GRANTED` and `errors.LIMIT_INSUFFICIENT` in
    `@endora-commerce/mod-credit-limits`
  - `errors.ADDRESS_NOT_OWNED` in `@endora-commerce/mod-addresses`
  - `errors.WEBHOOK_DELIVERY_NOT_REPLAYABLE` in `@endora-commerce/mod-webhooks`

  The other three keep no sentence. `ACTIVE_RESERVATIONS_EXIST` and `ADDRESS_IN_USE` are raised by
  nothing in the platform, so there was no refusal to describe. `API_KEY_OUT_OF_SCOPE` is raised, and
  is still not rewritten: its reader is an integration rather than a person, and the raise names the
  scope the key is missing (`API key lacks the required scope: <scope>.`) — the envelope substitutes
  the message wholesale and that raise carries no `details`, so a fixed sentence would take
  information away from the only audience that meets it. A consumer that reads those three keys out
  of `@endora-commerce/mod-i18n`'s bundle directly will no longer find them.

  `@endora-commerce/mod-api-keys` therefore ships a bundle that installs **zero** entries, which is a
  state no module in this platform has been in before. `loadModuleBundles` answers
  `{"byLanguage":{}}` for it and the boot reconciler counts it as installed.

  `API_KEY_CHANNEL_MISMATCH` is raised by the platform's sales-channel resolver and now takes its
  sentence from a switchable module's bundle (D-186 §3). The coupling is bounded: the raise needs an
  `api_key` actor, which only `@endora-commerce/mod-auth`'s request hook produces and only by calling
  `@endora-commerce/mod-api-keys`' gated `apiKeyResolver`, so with the module absent the code cannot
  be produced at all.

- 958fe88: Error-code ownership: `admin_roles` declares the three codes it owns and ships its first i18n
  bundle.

  `ADMIN_ROLE_CODE_TAKEN`, `ADMIN_ROLE_IN_USE` and `ADMIN_ROLE_PROTECTED` move from
  `@endora-commerce/mod-i18n`'s manifest to `@endora-commerce/mod-admin-roles`'. For a consumer the
  observable difference is **which bundle answers for them**: the sentences are no longer served from
  the platform bundle and are now in this module's own `i18n/{en,pl}.json`, so a deployment that
  ships `@endora-commerce/mod-admin-roles` gets them and one that does not gets the raising code's own
  English.

  Two of the three arrive with prose written for the first time — they carried a machine-shaped
  restatement of their own code (`"Admin Role Code Taken."`), which is deleted rather than moved.

  **`protectedRoleRefusal(code)` is a new export** of `@endora-commerce/mod-admin-roles/backend`, beside
  the existing `roleInUseRefusal`. It is the refusal `AdminRoleService.remove` now throws for a
  module-seeded role, extracted for the same reason its neighbour was: the translated sentence names
  the role through a `{role}` placeholder, and only a test that renders a real refusal can see that
  the placeholder has something to fill it.

  **The 409 `ADMIN_ROLE_PROTECTED` response now carries `details: { role: '<role code>' }`.** It
  carried no `details` before. This is additive — the member is `role` and never `code`, which is the
  refusal token the error envelope keys `errors.<CODE>.<token>` on.

- d7dca40: Error-code ownership: `organizations` declares the eight codes it owns and ships its first i18n
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

- 04cba90: Close D-129's sweep: the platform error-code block is 21 codes with a reason each, and a gate
  that says so.

  **`@endora-commerce/contracts`** — `errorCodeTokenRe`'s doc block said the envelope "falls back
  to `errors.<CODE>`" when a token key is missing. It does not, and it never did:
  `localizeErrorEnvelope` composes one key — `errors.<CODE>.<token>` when the raise carries a
  `details.code`, `errors.<CODE>` when it does not — asks for it once and never re-asks. The
  correction matters to anyone declaring `tokens`, because it decides whether a code whose every
  raise is tokened needs its base sentence at all. It does, but for the check rather than for the
  operator (D-190). No shape changes; this is the published `.d.ts` telling the truth.

  **`@endora-commerce/mod-i18n`** — the same 21 declarations, regrouped by the ground that put each
  one there, with the block's doc comment rewritten to read as the platform block's home rather
  than as what a migration left behind. Nothing a consumer resolves moves: the codes, their
  `tokens` and every `errors.*` key in the bundle are unchanged.

  D-129's sweep is now complete — 79 codes moved into 20 modules over seven merge requests, 21
  stayed. Each of the 21 is annotated with its D-121 tier and the sentence that argues it, and
  `_i18n`'s declarations are held equal to those annotations in both directions, with the
  annotations' own membership held against the frozen chain capture plus the re-homing and minting
  ledgers. A twenty-second code cannot reach the platform block by nobody deciding.

- df749d7: `delivery_methods` declares `delivery_methods:read` and `delivery_methods:write`, and its admin
  routes enforce them instead of `catalog:read` / `catalog:write`.

  **Breaking for anyone whose roles reach either module's admin API.** The three
  `delivery_methods` routes moved:

  ```
  GET    /api/v1/admin/delivery-methods         catalog:read   -> delivery_methods:read
  PUT    /api/v1/admin/delivery-methods/:code   catalog:write  -> delivery_methods:write
  DELETE /api/v1/admin/delivery-methods/:id     catalog:write  -> delivery_methods:write
  ```

  And the shared route `@endora-commerce/mod-payment-methods` registers moved with them:

  ```
  GET    /api/v1/admin/order-statuses
    payment_methods:read OR catalog:read  ->  payment_methods:read OR delivery_methods:read
  ```

  That route is read by two admin editors — the payment-method screen and the delivery-method one
  — which is why it is an any-of. The `catalog:read` member was a placeholder for the delivery
  editor's gate while `delivery_methods` still borrowed the catalogue's authority; it is now that
  module's own read code, so no catalogue holder reaches the shared list any more.

  There is no data migration and that is deliberate: granting the new codes to every holder of
  `catalog:read` would reproduce the distribution the change exists to remove, which would make it a
  change of spelling rather than of authority. A role that was configuring delivery methods through
  the catalogue codes is granted `delivery_methods:read` / `delivery_methods:write` on
  `/admin-roles`, where the manifest puts them automatically.

  `@endora-commerce/mod-i18n` carries the two `adminRoles.permission.delivery_methods:*` labels and
  the screen's refusal notice, in `en` and `pl`.

- 1cdcee4: `_i18n`'s bundle stops carrying eight permission labels four modules already ship.

  `adminRoles.permission.mfa:reset`, `mfa:manage`, `prompt_actions:use`,
  `pwa:read`, `pwa:write`, `pwa:send_push`, `stripe:read` and `stripe:write` are
  removed from `i18n/en.json` and `i18n/pl.json`. Each of them is declared by
  `@endora-commerce/mod-mfa`, `mod-prompt-actions`, `mod-pwa` and `mod-stripe` in
  those packages' own bundles, in both shipped languages, and has been since
  feature 042 — the copy here was the one the admin actually rendered, because
  `/admin-roles` resolved the key in the synthetic `core` namespace alone. Feature
  091's Phase 3 makes the lookup read the merged bundle, so the module's own copy
  is now the answer and this one was a duplicate.

  No exported binding changes. A consumer that reads this package's bundle for one
  of those eight keys should read the owning module's bundle instead; the
  platform's merged bundle answers identically.

- 5fc21d1: Four keys for the InPost module's admin surfaces: `adminRoles.permission.inpost:manage`,
  `appShell.nav.inpost`, and `legacyMethods.integrations.inpost.{name,description}`, in both
  shipped languages.

  Nothing else in `i18n/{en,pl}.json` moves. That is worth stating: the branch this arrives
  on had regenerated both bundles with a tool that dropped 97 keys and replaced 18
  hand-written sentences with placeholders, and the merge rebuilt them from `master` plus
  these four rather than carrying that.

- 4fa03c3: `_i18n` declares the platform's 100 error codes, and `translate` answers to the module id as
  well as to the bundle namespace.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3, the last owner
  (`specs/090-module-owned-error-codes/core-block-home.md`). The list is the prefix chain's own
  answer for every code it routes to `core`, copied verbatim from the frozen capture and asserted
  equal to it in both directions. `core` is not a module id: it is the synthetic namespace this
  package's bundle is exposed under, so the module that owns the platform bundle is this one, and
  declaring the block here moves no sentence and edits no bundle.

  **One behavioural change, and it is the reason this is not a manifest-only patch.**
  `I18nService.translate(moduleId, …)` now resolves `_i18n` to the same bundle as `core`. Before
  this, the merged bundle map held a `core` key and no `_i18n` key, so
  `translate('_i18n', 'errors.INTERNAL', 'pl')` returned the placeholder — and both composition
  roots turn a placeholder back into the raising code's untranslated English. With the block
  declared, the composed routing map answers `_i18n` where the chain answered `core`, so without
  the normalisation 41 error codes would have lost their sentences in both shipped languages, with
  no log and no failing check.

  If you call `translate` yourself: `core` keeps working exactly as before and is still what the
  admin SPA asks for; `_i18n` now works too. The **placeholder** a miss returns is still built from
  the id you passed, so a caller comparing the answer to `` `${moduleId}.${key}` `` is unaffected.
  `getCoverageSnapshot` is unchanged — a fallback logged for `_i18n` is attributed to `core`, the
  namespace its bundle side is keyed by, rather than reported as a second module with no bundle.

  No routing code is touched: the prefix chain still answers for every code whose owner has not
  declared it yet, and it is deleted in the next merge request.

- 456ffa7: A listing that a viewer's organization scope emptied now says so.

  `@endora-commerce/contracts` adds `SCOPE_NOTICE_CODES`, `scopeNoticeCodeSchema`,
  `ScopeNoticeCode`, `scopeNoticeMetaSchema`, `ScopeNoticeEnvelope` and `scopeNoticeOf`.
  The last is the reader both sides share: `meta.scopeNotice` on any successful response,
  absent when there is nothing to say.

  ```ts
  import { scopeNoticeOf } from '@endora-commerce/contracts';

  const res = await apiClient.get<ListResult>('/api/v1/admin/comparisons');
  const notice = scopeNoticeOf(res); // 'ORGANIZATION_ATTRIBUTION_PENDING' | null
  ```

  `@endora-commerce/platform` adds `TenantScopeNotices` and
  `noteOrganizationAttributionRefusal` to `./tenancy`, an optional `notices` field on
  `TenantContext`, and a `preSerialization` hook inside `registerRequestScopeHook` that puts
  the code on the envelope. **This changes what every route registered behind that hook
  answers**: a successful object body gains `meta.scopeNotice` when the `customerAccount`
  filter refused a whole table during that request. Error bodies, arrays, buffers and string
  bodies are untouched, and a viewer whose reach is not restricted never sees the key,
  because only an `allowed-set` context carries a sink for the filter to write to.

  Nothing to do to adopt it: no route sets a flag, and the notice stops being emitted for a
  table on the day that table gains an `organization_id`, because the same filter arm starts
  granting instead of refusing.

  `@endora-commerce/mod-i18n` adds the two operator-facing sentences to the `core` bundle in
  `en` and `pl`: `scopeNotice.organizationAttributionPending.title` and `.body`.

- 69261b8: `taxes` declares `taxes:read` and `taxes:write`, and its admin routes enforce them instead of
  `catalog:write`.

  **Breaking for anyone whose roles reach this module's admin API.** All four routes moved, and
  unlike the three modules that preceded it, every one of them was gated on the catalogue's
  **write** code — there was no read gate to move:

  ```
  GET    /api/v1/admin/taxes           catalog:write -> taxes:read
  GET    /api/v1/admin/taxes/preview   catalog:write -> taxes:read
  PUT    /api/v1/admin/taxes/:code     catalog:write -> taxes:write
  DELETE /api/v1/admin/taxes/:id       catalog:write -> taxes:write
  ```

  So `taxes:read` is a capability that did not exist before rather than a rename of one: an
  operator can now be shown a VAT rate without being handed the authority to change it. Grant it
  alone for a finance or support role; grant the pair to configure rates.

  Nothing that _computes_ tax is affected. `orders`, `carts`, `product_feeds` and `quote_requests`
  resolve a rate through the `taxService` port in process; these routes serve the admin
  configuration screen and nothing else.

  There is no data migration and that is deliberate: granting the new codes to every holder of
  `catalog:write` would reproduce the distribution the change exists to remove, which would make it
  a change of spelling rather than of authority. A role that was configuring tax rules through the
  catalogue code is granted `taxes:read` / `taxes:write` on `/admin-roles`, where the manifest puts
  them automatically.

  `@endora-commerce/mod-i18n` carries the two `adminRoles.permission.taxes:*` labels and the
  screen's refusal notice, in `en` and `pl`.

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
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
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
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/platform@0.7.0
