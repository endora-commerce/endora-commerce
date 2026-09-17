# @endora-commerce/mod-linkedin-ads

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
  - @endora-commerce/admin-kit@0.9.1
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
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

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
  - @endora-commerce/admin-kit@0.8.1

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

## 0.7.0

### Minor Changes

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
  - @endora-commerce/platform@0.7.0
