# @endora-commerce/mod-newsletter

## 0.10.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/page-builder-admin@0.9.6
  - @endora-commerce/page-builder-core@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.10.5

### Patch Changes

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
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/email-components@0.9.5
  - @endora-commerce/page-builder-admin@0.9.5
  - @endora-commerce/page-builder-core@0.9.5
  - @endora-commerce/platform@0.13.1

## 0.10.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4
  - @endora-commerce/page-builder-admin@0.9.4
  - @endora-commerce/page-builder-core@0.9.4

## 0.10.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3
  - @endora-commerce/page-builder-admin@0.9.3

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/page-builder-admin@0.9.2
  - @endora-commerce/page-builder-core@0.9.2

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
  - @endora-commerce/email-components@0.9.1
  - @endora-commerce/page-builder-admin@0.9.1
  - @endora-commerce/page-builder-core@0.9.1
  - @endora-commerce/platform@0.11.1

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

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0
  - @endora-commerce/email-components@0.9.0
  - @endora-commerce/page-builder-admin@0.9.0
  - @endora-commerce/page-builder-core@0.9.0

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2
  - @endora-commerce/page-builder-admin@0.8.2
  - @endora-commerce/page-builder-core@0.8.2

## 0.9.0

### Minor Changes

- 6c8d958: Eight migration statements move to the module whose dependency closure guarantees the table they
  name (D-226, `specs/120-migration-closure-bridge-ownership/` Phase 3).

  A migration may name a table only if its own module creates it, a module in its transitive manifest
  `dependencies` closure creates it, or the platform creates it. Where that did not hold, an instance
  that omitted the creating module could not migrate a fresh database at all — the failure this rule
  was ruled from was `relation "cms_pages" does not exist`.

  **No class is renamed and no stamp moves.** `mikro_orm_migrations` persists the migration class name
  and holds no checksum (measured on `@mikro-orm/migrations@6.6.13`), so a database that has applied
  one of the reduced bodies is offered nothing from it. What an upgrading consumer receives is the
  five new migrations below, each written idempotently, each a no-op against a database that already
  has the object and the real change against a fresh one. Measured on a database migrated at the
  previous revision: exactly five pending, every table's `pg_class` OID unchanged after applying
  them, and the resulting schema byte-identical to the previous revision's fresh schema.

  **`@endora-commerce/platform`** — two frozen bodies lose statements they could never have been
  ordered for, the platform declaring no dependencies and so never being orderable after a module's
  table. `Migration20260430T170044CoreSalesChannelsPromote` no longer adds `quote_requests.sales_channel_id`,
  its foreign key or its index. `Migration20260717T134752CoreTenantScopeIndexes` is now **empty** —
  all three of its indexes were on module-owned tables — and the class stays, because its name is on
  `BASELINE_MIGRATIONS` and removing it would move seventy frozen positions.

  **`@endora-commerce/mod-quote-requests`** — new `Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution`:
  the `sales_channel_id` column, its `ON DELETE RESTRICT` foreign key and its index, `add column if not exists`
  with the constraint add guarded by a `pg_constraint` probe. The column is still NULLABLE.

  **`@endora-commerce/mod-analytics`** — new `Migration20260912T125655AnalyticsEventsTenantScopeIndexes`:
  the two tenant-key indexes on `analytics_events`, verbatim and `if not exists`.

  **`@endora-commerce/mod-newsletter`** — new `Migration20260912T125702NewsletterSubscriberTenantScopeIndex`:
  the tenant-key index on `newsletter_subscribers.customer_account_id`, verbatim and `if not exists`.

  **`@endora-commerce/mod-cms`** — new `Migration20260912T125709CmsPageBodyAssetRefIndex`: the GIN
  index on `cms_pages.body`. It exists for `assets_library`' reference-protection scan and now lives
  with the table it is on; `cms` declares `assets_library` and not the other way round, so this is the
  only direction in which the closure holds.

  **`@endora-commerce/mod-assets-library`** — `Migration20260505T102206AssetsLibraryInit` no longer
  creates that index. An instance installing this package without `cms` no longer carries a migration
  that indexes a table nothing builds.

  **`@endora-commerce/mod-inventory`** — new `Migration20260912T125716InventoryOrganizationWarehouses`:
  the `organization_warehouses` bridge, `create table if not exists`, verbatim columns, primary key and
  both foreign keys. This is D-226's bridge rule one namespace over — an always-present near side
  (`organizations`) and a switchable far side — and it has a visible consequence:
  `module:uninstall --hard inventory` now reverts this table, a hard uninstall reverting by registry
  module id.

  **`@endora-commerce/mod-organizations`** — `Migration20260611T140349OrganizationsConsolidation` no
  longer creates `organization_warehouses`. Its `warehouses` foreign key named a table this module
  neither owns nor declares, and could not declare: `inventory` already declares `organizations`.

- 8e86e55: Eleven container names a module read and nothing defaulted are now defaulted by
  the module that reads them, so a composition that contributes nothing can
  resolve every one of them.

  `@endora-commerce/platform` — `composeApp` registers two more names:
  `customerOrganizationIdResolver`, the tenth actor-shaped name, whose value
  expression reads `request.actor` and nothing else; and `newsletterTokenSecret`,
  the resolved `NEWSLETTER_TOKEN_SECRET`.

  `@endora-commerce/mod-newsletter` — `newsletterModule`'s `defaultChannelId`
  option becomes `resolveDefaultChannelId: () => Promise<string | null>`. A
  consumer composing the module through `registerModule` is unaffected; a consumer
  calling `newsletterModule` directly passes `async () => null` where it passed
  `null`. The `NewsletterBridge` interface is removed — the module reads its nine
  members itself.

  `mod-catalog`, `mod-customers`, `mod-ksef`, `mod-orders`, `mod-quote-requests` —
  each registers the names it reads. No published shape changes; a composition
  that contributes one of them still overrides the default, which is what the
  contribution window is for.

  `mod-catalog`, `mod-customers` and `mod-orders` declare new manifest edges for
  ports they now resolve themselves: `catalog` -> `search:searchReindexPort`,
  `customers` -> `admin_roles`, `orders` -> `admin_users` and `admin_roles`. Every
  one of those owners declares `activation.nonDeactivatable`, so no operator loses
  an activation control.

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
  - @endora-commerce/admin-kit@0.8.1
  - @endora-commerce/page-builder-admin@0.8.1
  - @endora-commerce/page-builder-core@0.8.1

## 0.8.0

### Minor Changes

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
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0
  - @endora-commerce/email-components@0.8.0
  - @endora-commerce/page-builder-admin@0.8.0
  - @endora-commerce/page-builder-core@0.8.0

## 0.7.0

### Minor Changes

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

- f66359f: The stored Page Builder block names are namespaced, once, by five migrations.

  Each of the five table-owning modules rewrites **its own** columns — `cms` three, `blog`
  two, `transactional_emails` three, `newsletter` two, `invoices` one — with a recursive
  `pg_temp` function generated from `FROZEN_BLOCK_RENAMES`. A migration belongs to the module
  that owns the **table**, never to the module that owns the new name, so no new manifest
  `dependencies` edge arises: a block name is a string value inside a JSONB document, not a
  foreign key.

  The rewrite is **structural**: it replaces the value of a `type` property in a node position
  and nothing else. Twelve of the 74 names are ordinary English words (`Row`, `Text`, `Image`,
  `Map`, `Button`, …) that occur throughout shop content, so a textual substitution would
  corrupt a `RawHtml` block's markup and every `alt` attribute in the shop.

  It is **idempotent by construction** — every key of the map is bare and every value is
  dotted, so a second run finds nothing — and it **cannot fail on its input**: a name the map
  does not hold is left byte-identical and reported, never quarantined. `down()` applies the
  inverse over the identical walk.

  `cms` gains an operator command for the pre-flight:

  ```
  pnpm --filter backend run cli -- cms block-names
  ```

  Read-only, across all eleven columns, classifying every stored name as _will be renamed →
  new name_, _already namespaced_ or _unrecognised_. Run it before upgrading, resolve or accept
  the unrecognised set, take a backup, upgrade, and run it again: every _will be renamed_
  becomes _already namespaced_ and the unrecognised set is unchanged.

  `catalog`, `orders` and `ksef` are patch-bumped because their block declarations are now what
  the registry serves — the eight `catalog` blocks, the eight `orders` ones and
  `ksef.InvoiceSection` were previously registered as `cms`' and `invoices`'.

- 661e80d: Fourteen new packages: the **second** batch of modules to leave `backend/src/modules/`
  (feature 080, T040b). Five moved one at a time, then ten together; these fourteen are the
  same shape as the ten, and the properties below hold fourteen times over.

  **One changeset, not fourteen**, for the reason batch one gives: a changeset is written for
  the consumer of a package, and a package that did not exist a moment ago has no upgrader to
  instruct. What genuinely differs per package is its layer inventory, and that is the table.

  Every subpath is compiled output (D-164); none has a root wildcard; each package's `.` is
  its `manifest.ts`, where the generated manifest index reads the module's identity, its
  `dependencies`, its permission codes, its command-palette actions, its settings and its
  activation control.

  | Package                                     | Subpaths                         | Entities                                                                                                                                                                                                                                                                                                                                       | Migrations | Ships          |
  | ------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------- |
  | `@endora-commerce/mod-admin-notifications`  | `.`, `./backend`, `./migrations` | `AdminNotificationRead`, `AdminNotification`                                                                                                                                                                                                                                                                                                   | 1          | `dist`         |
  | `@endora-commerce/mod-api-keys`             | `.`, `./backend`, `./migrations` | `ApiKey`                                                                                                                                                                                                                                                                                                                                       | 1          | `dist`         |
  | `@endora-commerce/mod-linkedin-ads`         | `.`, `./backend`, `./migrations` | `LinkedInConversionMapping`                                                                                                                                                                                                                                                                                                                    | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-sales-channels`       | `.`, `./backend`                 | —                                                                                                                                                                                                                                                                                                                                              | —          | `dist`, `i18n` |
  | `@endora-commerce/mod-shopping-lists`       | `.`, `./backend`, `./migrations` | `ShoppingListItem`, `ShoppingList`                                                                                                                                                                                                                                                                                                             | 2          | `dist`         |
  | `@endora-commerce/mod-delivery-methods`     | `.`, `./backend`, `./migrations` | `DeliveryMethod`                                                                                                                                                                                                                                                                                                                               | 2          | `dist`         |
  | `@endora-commerce/mod-prompt-actions`       | `.`, `./backend`, `./migrations` | `PromptActionRequest`                                                                                                                                                                                                                                                                                                                          | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-mfa`                  | `.`, `./backend`, `./migrations` | `MfaEnrolment`, `MfaOrganizationPolicy`, `MfaRecoveryCode`, `MfaSocialIdentity`                                                                                                                                                                                                                                                                | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-webhooks`             | `.`, `./backend`, `./migrations` | `WebhookDelivery`, `Webhook`                                                                                                                                                                                                                                                                                                                   | 3          | `dist`         |
  | `@endora-commerce/mod-transactional-emails` | `.`, `./backend`, `./migrations` | `EmailBlockSalesChannel`, `EmailBlock`, `EmailTemplateSalesChannel`, `EmailTemplate`, `TransactionalEmailContent`, `TransactionalEmail`                                                                                                                                                                                                        | 2          | `dist`, `i18n` |
  | `@endora-commerce/mod-cms`                  | `.`, `./backend`, `./migrations` | `CmsBlock`, `CmsHookBlockAttachment`, `CmsHook`, `CmsPage`, `CmsTemplate`                                                                                                                                                                                                                                                                      | 2          | `dist`, `i18n` |
  | `@endora-commerce/mod-pwa`                  | `.`, `./backend`, `./migrations` | `PushMessageDelivery`, `PushMessage`, `PushSubscription`, `PwaIconRendition`                                                                                                                                                                                                                                                                   | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-newsletter`           | `.`, `./backend`, `./migrations` | `NewsletterAutomationRun`, `NewsletterAutomation`, `NewsletterCampaignSubscriber`, `NewsletterCampaign`, `NewsletterCustomField`, `NewsletterEmailBlockSalesChannel`, `NewsletterEmailBlock`, `NewsletterEngagementEvent`, `NewsletterSendRecord`, `NewsletterSubscriberTag`, `NewsletterSubscriber`, `NewsletterSuppression`, `NewsletterTag` | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-returns`              | `.`, `./backend`, `./migrations` | `Refund`, `ReturnCaseAttachment`, `ReturnCaseComment`, `ReturnCaseItem`, `ReturnCase`, `ReturnDeliveryMethod`, `ReturnListSavedView`, `ReturnReason`, `ReturnShipment`, `ReturnStatusTransition`, `ReturnStatus`                                                                                                                               | 2          | `dist`, `i18n` |

  **`./backend` publishes `registerModule(ctx)` and an `entities` array, and no entity class by
  name** (D-168) — type-only exports included, which this batch measured rather than assumed:
  two packages published their entities' row types so the dev seed could name them, and
  `module-package-entity-surface.test.ts` refused both, in as many words — _"that is the one
  thing that makes a foreign module's `import type { … }` compile"_. The exports are gone and
  the seed takes each class off the published array by name.

  **One of the fourteen owns no table and says so with an empty array rather than by
  omission.** `@endora-commerce/mod-sales-channels` exports `entities: readonly never[] = []`.
  The distinction is not cosmetic: the platform's package loader answers a _missing_ export
  with `[]`, so "this module has no table" and "somebody forgot the array" would otherwise
  arrive as one silence, whose only symptom is a query against a table nobody created.

  **One package publishes a type on `./backend` that is not an entity**, and it is there
  because a composition root has to name a contribution it supplies:
  `@endora-commerce/mod-shopping-lists` re-exports `ShoppingListService`. A root cannot reach
  a package's internal file — `rootDir` makes a relative specifier into `packages/` TS6059
  even for an `import type` — so a contribution shape has to be on a published subpath or it
  is unnameable.

  **Two packages declare a `@fastify/*` dependency nothing imports.**
  `@endora-commerce/mod-mfa` peers on `@fastify/cookie` and `@endora-commerce/mod-pwa` on
  `@fastify/multipart`, because `reply.setCookie`, `request.isMultipart()` and
  `request.file()` are declaration-merging augmentations rather than imports. Inside the
  application those arrived ambiently through the host's own dependency; a package compiles
  against its own manifest, where an unnamed dependency does not exist. Both write
  `import type {} from '@fastify/…'`, which is type-only: the plugin is still the host's to
  register.

  **`@endora-commerce/mod-newsletter` and `@endora-commerce/mod-pwa` also carry a companion
  `@types/*` in `devDependencies`** — `@types/nodemailer` and `@types/web-push` — which the
  manifest generator now derives. Nothing imports a `@types` package; the compiler finds it
  through `node_modules/@types`, which inside a package is the package's own declaration, so
  a module importing a JS-only library did not build until this landed.

- 5ec39db: `newsletter` gains `organization_id` on `newsletter_subscribers`, stamps it on
  both writes that own a row, and refuses a row that names a customer account
  without one.

  `NewsletterSubscriber` gains an `organizationId` property and the
  `newsletter_subscribers` table gains a nullable `organization_id` column, an
  index (`newsletter_subscribers_organization_idx`, following this table's own
  `newsletter_subscribers_channel_idx` spelling) and
  `check ("customer_account_id" is null or "organization_id" is not null)`. The
  migration first derives the missing organisation from the account that owns each
  subscriber, then refuses — with the count and up to twenty ids, deleting nothing
  — anything it could not derive. Like `push_subscriptions` and
  `availability_notifications`, and unlike `comparisons`, this table carries **no
  foreign key** on `customer_account_id`, so that refusal is a branch a real
  database can reach.

  **The e-mail address is not a derivation, and that is a decision rather than an
  omission.** `newsletter_subscribers.email` is globally unique and
  `customer_accounts` has an `email` too, so the backfill could have matched them
  and attributed far more rows. Matching would claim rows the schema does not
  link, silently and irreversibly, for whoever signed up with the address their
  employer later registered. The only derivation is `customer_account_id`.

  **What changes for a reader.** `NewsletterSubscriber` is `@CustomerScoped`, and
  the tenant filter's `allowed-set` arm consults the ORM's metadata for this
  property per query. Before this release the arm found none and refused the whole
  table, so an administrator whose authority is a set of organisations — a sales
  representative — was shown no subscribers at all and told so, through the
  `ORGANIZATION_ATTRIBUTION_PENDING` notice on the response envelope. It now grants
  on the column, so that administrator sees the subscribers of the organisations
  they are assigned to, and the notice stops being emitted for this table.

  **And that reaches the CSV export, which is the surface with no envelope.**
  `GET /api/v1/admin/newsletter/subscribers/export` answers with a `text/csv`
  body, so the notice could never be attached to it: a scoped administrator's
  download was a header row and nothing else, with nothing anywhere saying why. It
  now carries their organisations' owned subscribers. It carries **no ownerless
  subscriber** — every storefront sign-up, which on this table is the ordinary row
  rather than the edge — because such a row has no organisation and the constraint
  is an implication rather than an equivalence. Who an ownerless subscriber belongs
  to is an open product question this release does not answer; it lands the column
  that makes any answer expressible.

  **What changes for a caller.** `SubscriberServiceDeps` gains a **required**
  `customerAccounts: CustomerAccountReadPort`, and `NewsletterModuleOptions` gains
  the same field, threaded from the container's `customerAccountReadPort`. A
  composition that cannot answer "which organisation owns this account" can no
  longer construct `NewsletterSubscriberService` — that is the point, since the
  constraint refuses the row it would write. Both write sites take the two columns
  from one resolved-owner value, so the customer branch has no shape in which the
  organisation could be omitted and the anonymous branch has none to carry.

### Patch Changes

- 6f5687c: These four packages now declare a `test` script and ship a `vitest.config.ts`, so the unit
  tests they already carried beside their sources are collected and run.

  They were not. `specs/deferred-defects.md`'s _"Co-located tests inside a module package run
  nowhere"_ is the entry this closes: no vitest configuration included `packages/**` and no
  module package declared a test command, so fifteen files across these four packages were
  collected by no run, reported by no job and counted in no total. They were not failing —
  as far as the pipeline was concerned they did not exist, which in review reads as coverage.
  All fifteen pass on first collection: 103 tests, and the CI job that will now run them,
  `test:frontend`, goes from 229 files / 1240 tests to 244 / 1343.

  **If you consume one of these packages**, nothing you import changes: `files` still ships
  `dist` and `i18n`, `tsconfig.build.json` still roots the emit at `src/`, and the test files
  and the configuration are in neither. The only difference is that `pnpm test` inside the
  package now does something.

  **If you write a module package**, two rules now hold and are enforced rather than
  documented:
  - The generated `test` script is a bare `vitest run` — never `--passWithNoTests`. Measured
    on vitest 2.1.9 over a package with no test file, bare `run` exits 1 with _"No test files
    found"_ and the flag turns that into 0. A package that declares a runner and collects
    nothing must fail, or the repair reproduces the defect it fixes.
  - `manifests:generate` and `manifests:check` **refuse** a package that holds a test file and
    declares no `vitest.config.ts`, naming the file. That is what stops the gap reopening
    silently for the next package.

  A package's `vitest.config.ts` must `mergeConfig` the repository root's
  `vitest.config.base.ts`: that is where issue #255's foreign-workspace-link refusal lives,
  and a configuration that skips it can execute another checkout's sources while reporting on
  this branch.

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
- Updated dependencies [5fc0550]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [b9d15af]
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
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
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
- Updated dependencies [1f07b01]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
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
- Updated dependencies [a92d972]
- Updated dependencies [e7bbadc]
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
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/page-builder-core@0.7.0
  - @endora-commerce/email-components@0.7.0
  - @endora-commerce/platform@0.7.0
  - @endora-commerce/page-builder-admin@0.7.0
