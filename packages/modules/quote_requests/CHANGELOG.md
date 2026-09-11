# @endora-commerce/mod-quote-requests

## 0.7.0

### Minor Changes

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

- d5f7022: The validity deadline an operator sets on a Quote Request is enforced again.

  `expiresAt` — written from `expiresInDays` by `RfqAdminService.modify` and
  `createOnBehalf`, serialised into `QuoteRequest`/`QuoteRequestSummary`, and shown to both
  parties as `expires <date>` — was read by no rule. The feature-008 workflow rewrite
  (`4f24dc948`) dropped the live check `accept()` carried and nothing replaced it, so a
  customer could accept a revision and convert an approved quote to a cart at its agreed
  unit prices for ever. `RFQ_EXPIRED` and `QUOTE_VALIDITY_ENDED` stayed enumerated in
  `ERROR_CODES` with sentences in both shipped languages, raised by nothing.

  **Two customer transitions now refuse**, both with `410`, both only when the operator
  actually set a deadline (`expiresAt` absent still means no deadline):
  - `POST /api/v1/quote-requests/:id/accept-revision` → `RFQ_EXPIRED`
  - `POST /api/v1/quote-requests/:id/convert-to-order` → `QUOTE_VALIDITY_ENDED`

  The two codes are the split
  `specs/001-b2b-platform-foundation/contracts/quote_requests.contract.md` already made —
  the offer that lapsed undecided, and the accepted quote that ran out — restored rather
  than invented. Neither is redundant: they carry different remedies, and a client
  discriminating on `error.code` can say which happened.

  **Nothing else changes.** `reject-revision` and `resubmit` stay open — declining a lapsed
  offer consumes no committed price, and resubmit is the buyer's way forward; it raises a
  new request carrying no deadline. Every admin path is untouched, so the operator can
  re-quote a lapsed request with a fresh `expiresInDays` and the customer can then accept.
  The expiry worker is a different concept and is not touched: it sweeps `updatedAt` against
  a settings-wide `expiryDays` and never reaches `Approved`.

  **If you consume the customer routes**, handle `410` on those two paths. The envelope
  carries the code and the module's own translated sentence; the placeholder strings under
  `errors.RFQ_EXPIRED` and `errors.QUOTE_VALIDITY_ENDED` are replaced with real prose in
  `en` and `pl`.

  There is no data migration. A request whose `expiresAt` is already in the past refuses on
  both paths from the moment this lands — that is the rule, not an accident of deployment.

- f1ff167: New package: the Quote Requests (RFQ) module, the second to leave `backend/src/modules/`
  (feature 080, T040b).

  Three subpaths, no root wildcard, every one of them compiled output (D-164):
  - `@endora-commerce/mod-quote-requests` — the manifest. Isomorphic,
    `@endora-commerce/contracts` its only import, and where the generated manifest index reads
    the module's identity, settings, palette action and activation control from.
  - `@endora-commerce/mod-quote-requests/backend` — `registerModule(ctx)`, the two ports it
    publishes (`quoteRequestReadPort`, `rfqService`), and the `entities` array the host's ORM
    registry spreads. **No entity class is exported by name** (D-168): the five
    `QuoteRequest*` classes are imported by the barrel to build that array and nothing else,
    so `import type { QuoteRequest } from '@endora-commerce/mod-quote-requests/backend'` does
    not compile in a consumer's tree, whoever the consumer is.
  - `@endora-commerce/mod-quote-requests/migrations` — the `migrations` array the platform's
    package loader reads, plus the six migration classes by name for the host's migration
    registry. The names are contract in a way an entity class name is not: they are what
    `mikro_orm_migrations` persists, so every already-migrated database holds them as strings.

  `@endora-commerce/platform` is a `peerDependency` (D-160.2), and so are `@mikro-orm/*`,
  `fastify` and `zod`. Unlike `mod-blog` this package declares no `ioredis` peer, because it
  imports none: it keeps no cache of its own, and `RfqExpiryWorker` is a plain `sweep()` a
  caller drives — the name is historical, there is no BullMQ consumer behind it.

  The manifest id stays `quote_requests` — identity of record for the lifecycle registry, the
  settings store, the `rfqs:handle` permission code, the i18n bundle paths and the ownership of
  all six migrations (D-142). The npm name is only how npm keeps names unique.

  **What this package proves that `mod-blog` could not.** It ships six migrations rather than
  one, so the per-module ordering chain has more than one link, and its `ctx.subscribe`
  subscriber **writes** — `order.created.v1` completes the originating quote request — so a
  test can tell a registered subscriber from an unregistered one, which is the obligation the
  first module package left uncovered.

### Patch Changes

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

- 67eeced: `quote_requests` declares the nine error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the
  `RFQ_`/`QUOTE_` prefix rule in `@endora-commerce/mod-i18n`, which continues to
  answer identically for every one of them: the list is the chain's own answer,
  copied from the frozen capture, and is asserted equal to it in both directions.

  No `tokens` are declared: none of the nine carries a refusal discriminator —
  all ten raise sites of the three codes anything raises pass no `details.code`,
  and the other six are raised by nothing at all.

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
