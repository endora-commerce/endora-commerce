# @endora-commerce/mod-catalog

## 0.7.0

### Minor Changes

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

- 3583e78: `catalog` is a package: `@endora-commerce/mod-catalog`, with three subpaths (`.` for the
  manifest, `./backend` for composition, `./migrations` for the twenty-one migration classes) and
  an `i18n/` bundle directory beside `dist`. It is the largest module in the tree — 18 entities,
  35 services and four route surfaces — and nothing about its behaviour, schema or HTTP surface
  changes with the move.

  **`./backend` exports an `entities` array and no entity class by name** (D-168). Eighteen
  classes are reachable only through that array, which is the value the host's ORM registers, so
  there is exactly one of each in a process. That number is why the array's shape matters more
  here than anywhere else: a consumer that picks a class out of it with a `find` gets the union of
  eighteen constructors, which TypeScript collapses to one member that is almost certainly not the
  one asked for. Take the class by **name**, never by index. If you want a row's _shape_, the
  contract is in `@endora-commerce/contracts`.

  **Three names leave `./backend` on purpose**, all of them for host programs that construct
  catalogue state rather than serve it:

  ```ts
  import {
    CatalogProductReadService, // the read surface price-list migration is driven from
    legacyToCfType, // legacy attribute value type -> unified custom-field triple
    type CatalogQueryService, // the cradle slot a composition root declares
  } from '@endora-commerce/mod-catalog/backend';
  ```

  `CatalogProductReadService` and `legacyToCfType` are a service and a pure function, so D-168 —
  which bars _entity_ classes from this door — does not reach them; `CatalogQueryService` is a
  type and evaluates nothing. A host program cannot name this package's source instead: a
  compiled build sets `rootDir`, and a `.ts` outside it is a compile error even under
  `import type`.

  **Two `fastify` request properties this module reads are not its own.** `request.actor` and
  `request.apiKeyBinding` are `declare module 'fastify'` augmentations owned by `auth` and
  `api_keys`. Inside one program they are ambient; a package is its own program, so the two reads
  narrow locally rather than importing an interface neither owner publishes. An overlay wrapping
  `routes.external.ts` should expect the same.

  The twenty-one migration classes keep their names, so a database that has applied them sees
  nothing pending.

- 7af67c0: Declared as `peerDependencies` the packages these seven already publish types from (D-181).

  Each of them emits a `.d.ts` that imports a specifier its manifest declared only as a
  `devDependency`, which a consumer's install does not resolve. The consequence is silent:
  the type becomes `any`, and under `skipLibCheck: true` — what `tsc --init` writes — there
  is **no diagnostic at all**. Measured on `@endora-commerce/mod-catalog` with
  `@endora-commerce/mod-custom-fields` not installed: the exported
  `CatalogCradle.customFieldDefinitionService` typed as `any`, clean compile; with it
  installed, the correct `CustomFieldDefinitionApplyApi` and a refused assignment.

  Eleven peers, in two shapes:
  - **A published port interface of another module package** — `mod-catalog` →
    `mod-custom-fields`, `mod-customer-accounts` → `mod-organizations`, `mod-orders` →
    `mod-carts` / `mod-credit-limits` / `mod-inventory` / `mod-invoices` / `mod-promotions`,
    `mod-payments` → `mod-orders`. All are `import type … from '<pkg>/ports'` and all appear
    in the emitted declarations, so a consumer type-checking the package resolves them.
  - **A `@types/*` companion whose library reaches the declarations** — `@types/pdfmake`
    for `mod-invoices` and `mod-comparisons` (`pdfmake/interfaces.js` has no types without
    it), `@types/ssh2-sftp-client` for `mod-product-feeds`.

  **If you install one of these packages**, its peers are now install-time requirements
  rather than something your own tree happened to provide. `@types/nodemailer` and
  `@types/web-push` are deliberately _not_ among them: their libraries are imported inside
  function bodies and reach no published signature. Neither is `@types/react` or any other
  types package that contributes global declarations — those exist once in a program by
  construction, and forcing our copy is a conflict you could not fix.

  `minor` rather than `major`: nothing here changes an exported symbol or a call, and the
  requirement is one a consumer that type-checks these packages already had to satisfy for
  the types to mean anything. It is more than a patch because a resolver that was silently
  succeeding will now report an unmet peer.

- afedd32: Six modules declare the Page Builder blocks they own — all 74 of them.

  Each package's exported `manifest` gains `blocks` and `blockCategories`, and each
  ships the `blocks.<local>.label`, `blocks.<local>.description` and
  `blocks.category.<key>` entries for them in `i18n/en.json` and `i18n/pl.json`:

  | Package                    | Blocks              | Category declarations  |
  | -------------------------- | ------------------- | ---------------------- |
  | `mod-cms`                  | 30                  | 8 CMS sections         |
  | `mod-catalog`              | 8 (5 CMS, 3 e-mail) | 2                      |
  | `mod-orders`               | 8 e-mail            | 1 (`order`)            |
  | `mod-transactional-emails` | 17 e-mail           | 4                      |
  | `mod-invoices`             | 10 invoice          | 1 (`invoice`)          |
  | `mod-ksef`                 | 1 invoice           | 1 (`invoice`, joining) |

  **Nothing reads these declarations yet.** The Page Builder registry is still
  populated from the single hand-written `register('cms', …)` call, the three Puck
  configs are still keyed by the bare names, and no stored document changes. Read
  the block `name`s as the names those blocks will have, not as names anything
  resolves today.

  Two `(key, context)` sections are declared by two modules each and **merge**:
  the e-mail `content` section (`mod-transactional-emails` names it,
  `mod-catalog` joins) and the `invoice` section (`mod-invoices` names it,
  `mod-ksef` joins). A joining declaration carries its own `titleKey` and omits
  `weight` and `visible`, so it cannot take a presentation its author did not
  intend to take while still being able to title the section on its own when the
  namer is switched off.

  Three sections change owner or gain a member, which is the point of the exercise
  rather than a side effect: the CMS `catalog` section is `mod-catalog`'s (`cms`
  hand-writes it and owns no block in it); the e-mail `order` section is
  `mod-orders`'; `cms.InsertTemplate` and `transactional_emails.EmailInsertTemplate`
  gain a section, having had none; and `transactional_emails.EmailColumn` moves into
  a new hidden `internal` section.

  `mod-cms`' bundles rename one key: `pageBuilder.categories._internal` becomes
  `pageBuilder.categories.internal`, following the category key in
  `@endora-commerce/cms-components`. The rendered title is unchanged.

### Patch Changes

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

- e969343: `catalog` declares the forty-seven error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  every one of them: the list is the chain's own answer, copied from the frozen
  capture, and is asserted equal to it in both directions.

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

- eeb6a47: Four zone members for the category editor, the product editor and the sales-channel editor.

  `@endora-commerce/contracts` adds four members to `AdminZoneNameSchema`, each with its
  entry in `AdminZonePropsMap`:

  | Member                         | Props                                       | Rendered by                                           |
  | ------------------------------ | ------------------------------------------- | ----------------------------------------------------- |
  | `category.editor.after`        | `CategoryEditorZoneProps { categoryId }`    | the category editor's form, after its save/cancel row |
  | `product.editor.pricing.after` | `ProductEditorZoneProps` (reused)           | the end of the product editor's Pricing tab           |
  | `product.editor.channels`      | `ProductEditorZoneProps` (reused)           | the body of the product editor's Channels tab         |
  | `sales_channel.editor.after`   | `SalesChannelEditorZoneProps { channelId }` | below the sales-channel editor's identity form        |

  `CategoryEditorZoneProps` and `SalesChannelEditorZoneProps` are new exported interfaces.
  `ProductEditorZoneProps` is reused for the two product members rather than aliased: a props
  type is the shape the mount carries, and two places in one editor that both carry a product
  id carry the same shape.

  ```tsx
  import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';

  // A tab whose body is a zone shows its button by counting the zone, never by
  // naming the module that fills it.
  const contributions = useAdminZone('product.editor.channels', { productId });
  // …
  <AdminZone name="product.editor.channels" props={{ productId }} />;
  ```

  `@endora-commerce/mod-price-lists` gains an `./admin` subpath declaring two zone
  contributions — `category.editor.after` and `product.editor.pricing.after`, both at
  `price_lists:read` — and takes `DisplayModeOverrideRow` and `LinkedPriceListsPanel` with it.

  **`DisplayModeOverrideRow` loses its `label` and `inheritHint` props**, and that is a copy
  change an operator will see. A host cannot hand its own wording to a contributor it does not
  know, so the control renders `priceLists.displayMode.rowLabel` in every place it appears.
  Two screens read different words than before: the category editor, which passed `catalog`'s
  `categories.priceDisplayMode.label` / `.help` (both keys are removed from `catalog`'s
  bundle — hence its `patch`), and the product editor's Pricing tab, which passed this
  module's own `priceLists.linked.displayModeLabel` / `.displayModeHint`. Those two `core`
  keys are now read by nothing; they are left in place because the same props are still passed
  by `organizations`' detail screen, whose conversion is a separate merge request.

  `@endora-commerce/mod-sales-channels` gains an `./admin` subpath declaring one contribution,
  `product.editor.channels` at `sales_channels:read`, and takes `EntityChannelMembership` with
  it. Its four calls are rebuilt from the published `apiClient` rather than moving
  `sales-channels-client`, so the package reaches nothing in the admin application.

  `@endora-commerce/mod-inventory` gains an `./admin` subpath declaring one contribution,
  `sales_channel.editor.after` at `inventory:read`, and takes the panel formerly at
  `admin/src/modules/warehouses/ChannelMembershipPanel.tsx`. Its own
  `isVisible({ module: 'inventory', requiredPermission: 'inventory:read' })` gate is gone —
  the zone renderer applies presence and that code before the chunk is fetched — while the
  `inventory:write` half stays, because a contribution declares one code and the panel offers
  a read view and write actions behind two.

  No contribution declares a `match`: each names a member exactly one host mounts, and `match`
  narrows the mounts of one place.

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

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
- Updated dependencies [27ca81d]
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
- Updated dependencies [3786732]
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
- Updated dependencies [73da94f]
- Updated dependencies [e637f56]
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
  - @endora-commerce/mod-custom-fields@0.7.0
  - @endora-commerce/platform@0.7.0
