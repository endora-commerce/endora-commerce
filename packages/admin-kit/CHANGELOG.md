# @endora-commerce/admin-kit

## 0.8.2

### Patch Changes

- Updated dependencies [5bfefe0]
  - @endora-commerce/contracts@0.10.0

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [c1d281f]
- Updated dependencies [52c2bfd]
  - @endora-commerce/contracts@0.9.0

## 0.8.0

### Minor Changes

- 16a9a6d: **`./theme.css` — the admin's design system now ships from this package**, and
  it carries the class vocabulary as well as the tokens (owner ruling D-219,
  `specs/110-instance-repository/contracts/admin-stylesheet-composition.md`
  R3–R4).

  **Old:**

  ```css
  @import '@endora-commerce/admin-shell/theme.css';
  ```

  **New:**

  ```css
  @import '@endora-commerce/admin-kit/theme.css';
  ```

  If your host also held `src/styles/design-tokens.css` and
  `src/styles/components.css` and imported them from `main.tsx`, **delete both and
  drop those two imports**: their content is in the file above. Keeping them
  overrides the package, which is what the ruling removes.

  The subpath moved here because this is the package every renderer already
  declares — 55 module packages depend on it and none depends on the shell — so a
  class name it publishes is one every renderer can put a version range on. It is
  also the reason this is a `major` on both packages rather than a move nobody
  notices.

  **What is in the file.** 79 custom properties under one `:root`, the 22
  `@theme inline` mappings that bind them to Tailwind utility names, `.dark`,
  `[data-density="compact"]`, the `@layer base` rules, and the **200-token class
  vocabulary** — `.b2b-*` and the page-builder classes — that host and module
  admin surfaces render by name.

  **The default palette changed**, and it is the one visible change in the
  rendered output. The shell's `./theme.css` declared a shadcn slate palette that
  this repository's own admin overwrote in full on every load; the merged file
  declares one palette and it is the one that has actually rendered since the
  rebrand. `--primary` is now `var(--accent-h) var(--accent-s) var(--accent-l)`
  rather than a slate literal. To get the old palette, redeclare it after the
  import.

  **Overriding is unchanged and still needs no fork**: a redeclaration for a
  value, a later rule for a class, both in your own stylesheet after the import.

  ```css
  @import '@endora-commerce/admin-kit/theme.css';

  :root {
    --accent-h: 262;
  }
  .b2b-btn {
    border-radius: 2px;
  }
  ```

  **23 classes were deleted rather than moved** — `.page-header`, `.card`,
  `.field`, `.input`, `.btn`, `.alert`, `.badge`, `.table` and their modifiers,
  the unprefixed `@layer components` shim. Measured over every class-attribute
  position in this repository, no file that loaded them rendered one. If you
  render any of them, define them yourself; the supported vocabulary is the
  `.b2b-*` family and `@endora-commerce/admin-kit/ui`.

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

- 1d84094: `@endora-commerce/api-client` is gone; its client is now `@endora-commerce/admin-kit`'s own
  (owner ruling D-202).

  **What changes for you.** Nothing you imported from `@endora-commerce/admin-kit/lib` moved:
  `apiClient`, `ApiError`, `apiBaseUrl` and `onUnauthorized` are the same bindings at the same
  subpath. What moved is where `ApiError` is _declared_ — it is now the kit's class rather than a
  re-export — so a consumer that reached past the kit for it has to stop:

  ```diff
  -import { ApiError } from '@endora-commerce/api-client';
  +import { ApiError } from '@endora-commerce/admin-kit/lib';
  ```

  Identity is the reason this matters rather than a rename: every `catch` in the admin decides
  what it is looking at with `instanceof ApiError`, and two classes of that name pass every
  structural comparison while failing that test.

  Three symbols the deleted package exported are **not** published: `createApiClient` and the
  `ApiClient` / `ApiClientOptions` types are internal to the kit now, because the kit's own
  `apiClient` was their only caller and this package's surface is derived from what its consumers
  reach for. Ask for them if you need to build a second client.

  Drop the `@endora-commerce/api-client` dependency from your manifest; the kit no longer peers
  on it.

### Minor Changes

- 93a300c: Publish the admin contribution declarations, and the package a module's admin
  layer is written against.

  **`@endora-commerce/contracts`** gains `admin-contributions.ts`, re-exported
  from the barrel. It is additive and breaks nothing:
  - `AdminRouteDeclarationSchema`, `AdminNavDeclarationSchema` and
    `AdminZoneContributionSchema` — the data half of what a module package's
    `./admin` layer exports, so a generator, a check or a server can enumerate a
    contribution without evaluating any of the module's UI code.
  - `AdminNavSectionNameSchema` — the closed set of sidebar sections a module may
    join, derived from the twelve `admin/src/components/AppShell.tsx` already
    declares. A module may not invent a section: an invented section is a heading
    nobody else can join.
  - `AdminZoneNameSchema` — the closed, hierarchical set of places in one
    module's screen where another module's contribution may appear. The four
    opening members are exactly the places measured module additions reached into
    by editing another module's file.
  - `PermissionRequirementSchema` — a permission code, or a set any one of which
    suffices; the shape `admin/src/lib/surface-visibility.ts` already defines,
    published so a module package declares it without reaching into the admin for
    the type.
  - `AdminContributions`, `AdminRouteDeclaration`, `AdminZoneContribution` and
    `AdminComponentFactory` — the interfaces that carry the dynamic-import
    factory, which is the only function-valued field a contribution has. It is a
    TypeScript type rather than a Zod schema deliberately: a function value
    carries nothing to validate beyond its arity, and a `z.function()` here would
    tell a reader it had been checked.

  **`@endora-commerce/admin-kit`** is new, private, and publishes one subpath:

  ```ts
  import {
    AdminNavSectionNameSchema,
    type AdminContributions,
  } from '@endora-commerce/admin-kit/contributions';
  ```

  Every export is the identical binding rather than a copy —
  `@endora-commerce/contracts` is a peer dependency, so a consumer resolves one
  copy and a schema compared across the seam is the same object.

  The four design-system subpaths the feature derives (`./ui`, `./components`,
  `./lib`, `./i18n`) are **not** in this release. The package's README records the
  measurement: a `tsc`-emitted façade re-exporting `admin/src` is TS6059 —
  verified on a two-file probe — and dropping `rootDir` to make it compile emits a
  second copy of every component into the kit's `dist`, which is a duplicated
  module-scope value in a tree full of React context. Publishing them takes the
  shape feature 080 used for the platform relocation: the implementations move
  into the package and `admin/src` keeps re-export shims at their old paths.

- a85b425: Publish the four design-system subpaths: `./ui`, `./components`, `./lib` and
  `./i18n`.

  ```ts
  import { Button, Card, PageHeader } from '@endora-commerce/admin-kit/ui';
  import { ResponsiveTable, EChart } from '@endora-commerce/admin-kit/components';
  import { apiClient, cn, formatMoney } from '@endora-commerce/admin-kit/lib';
  import { useTranslation } from '@endora-commerce/admin-kit/i18n';
  ```

  Additive: nothing published before this release changed, and `./contributions`
  is untouched.

  **The implementations moved into this package.** 57 files that were
  `admin/src/components/ui`, `admin/src/components`, `admin/src/lib` and
  `admin/src/i18n` now live here, and the admin application keeps a one-line
  re-export shim at each of the 53 old paths it still names. That is a move rather
  than a façade because a façade cannot be built: a `tsc` re-export escaping the
  package is TS6059, and dropping `rootDir` to make it compile emits a second copy
  of every component into `dist` — a duplicated module-scope value in a tree full
  of React context, which is a `null` context at runtime with no type error.

  Every export is therefore the **only** copy in the process, and that is asserted
  by reference equality rather than by structure
  (`admin/test/kit/admin-kit-identity.test.ts`): a second `createContext()`, a
  second `ApiError` class and a second copy of `PAGE_SIZE_OPTIONS` all pass a
  field-by-field comparison and none of them passes `toBe`.

  **Every dependency the kit renders with is a `peerDependency`** — `react`,
  `react-router-dom`, `lucide-react`, the four Radix packages,
  `class-variance-authority`, `clsx`, `tailwind-merge`, `echarts` and
  `@endora-commerce/contracts`. An application must resolve one copy of each: two copies of `react-router-dom` is two router
  contexts and a `useNavigate()` that throws.

  **Two groups are deliberately not published**, both recorded in
  `backend/scripts/ledgers/admin-surface.ts` with the event that retires them:
  - the six pickers over another module's data (`organization-picker`,
    `sales-channel-picker`, `asset-picker`, `cms-picker`) — publishing them would
    put module knowledge in a platform package; they belong to the owning module's
    own admin layer;
  - the admin application's session and module-presence state (`useAuth`,
    `useModulePresence`, `useSurfaceVisibility`, `usePageSizePreference`). Its
    `PAGE_SIZE_OPTIONS` constant **is** published here, because the list of page
    sizes is design-system and the per-admin preference is application state.

  A consumer that needs either today has no supported spelling for it; that is
  stated rather than worked around.

- 4c9892c: Added `apiBaseUrl` to `@endora-commerce/admin-kit/lib`.

  The origin the admin's `apiClient` was built from, published beside it. A screen that has to
  build a URL the fetch client cannot make for it — an `<a download>` href, a form action — needed
  that origin and had no supported way to ask for it, so it read `import.meta.env.VITE_API_BASE_URL`
  itself. Inside a **module package** that is a second copy of the `http://localhost:3001` fallback
  plus `vite/client` types in the package's own compiler configuration, for one string.

  ```diff
  -const apiBaseUrl =
  -  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';
  +import { apiBaseUrl } from '@endora-commerce/admin-kit/lib';
  ```

  The value is identical to the one `apiClient` uses — it is now the same binding, not a second
  read — and the expression stays verbatim in the kit, because Vite replaces
  `import.meta.env.VITE_API_BASE_URL` at build time and a cast or an indirection is a chance for
  that replacement to stop happening in a way no type-check can see.

- 972e7ed: Publishes the five pieces feature 091's batch 8 had to drain before `seo`, `taxes`,
  `credit_limits`, `delivery_methods`, `megamenu` and `returns` could own their admin
  surfaces: `ProductPicker`, `CountryPicker`, `CurrencyPicker` and
  `StatusTransitionGraph` on `./components`, and `statusBadgeStyle` /
  `readableTextColor` on `./lib`. The two dictionary reads
  (`listDictionaryCountries`, `listDictionaryCurrencies`) sit beside the pickers, as
  the asset cluster's do.

  Ten `cross-module-imports` keys retire on them — four into `catalog`'s picker, two
  into `dictionaries`' country picker, two into its currency picker and two into
  `orders` — of which four belong to modules this batch does not move (`orders`,
  `quote_requests` twice, `inventory`). Each took the exit P2's three data pickers
  took: the component builds its own request from the published `apiClient` and the
  owner's `@endora-commerce/contracts` schema, so it holds no module code and
  `admin-kit-surface.md` R6 permits it.

  **Two of the five changed shape, and both changes are R-1's rule applied.**

  `StatusTransitionGraph` no longer takes a `t` prop. Both callers passed
  `useTranslation('core')` and the component read `orderStatusConfig.*` keys out of
  it, so the prop carried the component's _own_ copy through the caller rather than
  the caller's vocabulary — which the `statusLabel` prop already carries. It resolves
  those keys itself now, out of the `core` namespace they were already in, and the
  rendered output is unchanged in both shipped languages. **If you rendered it**,
  drop `t={t}`; nothing else about the call changes.

  `orderStatusBadgeStyle` is published as **`statusBadgeStyle`**. A kit symbol named
  after a module is R6 wearing a different hat, and the caller that made the
  generality visible is `returns`, whose statuses are not orders'. The old spelling
  survives as an alias at `admin/src/modules/orders/orderStatusColor.ts`.

  `CountryPicker` and `CurrencyPicker` read `core` rather than `dictionaries` (R-1):
  their six keys moved from that module's bundle into `_i18n`'s under the same
  spelling. **If you translate this admin**, `dictionaries`' bundle loses the three
  `countryPicker.*` and three `currencyPicker.*` keys and `_i18n`'s gains them,
  plus five new `productPicker.*` — the four English sentences `ProductPicker`
  carried as literals, which a component nobody had to translate looks like.

  `CountryPicker` is **not** a duplicate of `CountrySelect`: this one reads the admin
  dictionary, which serves inactive rows and groups them, so an operator can see that
  a country exists and is switched off. `CountrySelect` reads the public facade,
  which cannot answer that.

- b1589fd: Publishes `CustomFieldValuesPanel` and `CustomFieldValuesPanelProps` on `./components`.

  The panel renders the definition-driven form for one host record's custom fields
  (feature 055). It was classified as a contribution the `custom_fields` module mounts
  inside four other modules' screens, and `admin-component-contribution.md` §9.1 rules that
  it never was one. Its props are `(entityType, values, save)` — data in, edited data back
  — so all four call sites hand it the **host's own** stored bag and the **host's own**
  writer, and `custom_fields`' admin API serves definitions and entity types and no values
  at all. Principle XIV working as designed puts `customFieldValues` on the host's row, so
  what crosses the seam is one `GET` for the definitions and nothing that belongs to the
  owner.

  That makes it the same shape as the pickers this package already publishes: it rebuilds
  `GET /api/v1/admin/custom-fields/definitions?entityType=…` from the published
  `apiClient`, and every type it names (`CustomFieldDefinitionDto`, `SupportedEntityType`)
  is `@endora-commerce/contracts`', which both sides compile.

  ```diff
  -import { CustomFieldValuesPanel } from '@/modules/custom_fields/CustomFieldValuesPanel';
  +import { CustomFieldValuesPanel } from '@endora-commerce/admin-kit/components';
  ```

  The admin keeps a re-export shim at the old path, so nothing outside the four consumers
  had to be rewritten and both spellings are one binding — asserted by reference equality,
  because a second copy would be a second `useState` draft of one record's values.

  **It reads `core`, and adds no key to it.** `customFields.title` and `customFields.save`
  were already in the shipped bundle in both languages, so R-1's rule about a translation
  namespace being module knowledge is satisfied without moving anything. Rendered output is
  unchanged.

  **One defect travels with it, deliberately unfixed.** `defs.length === 0` returns `null`
  **above** the error `Alert`, so a failed definitions load renders nothing and is
  indistinguishable from "no custom fields are defined for this entity type". That is
  accidentally right for a 503 and wrong for everything else. It predates this move and
  repairing it inside a move would mix two subjects, so the behaviour is preserved verbatim
  and asserted as it stands.

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

- 45e77bb: `@endora-commerce/admin-kit/components` gains `FulfilmentStrategyPicker` (feature 091, P9).

  The control sat under `inventory`'s admin directory and was rendered by `catalog`'s product
  Inventory tab and by `organizations`' fulfilment panel. It is a **published component and
  never was a zone contribution**: its props are a value in and a value back, and both
  consumers own the save (`contracts/admin-component-contribution.md` §10.2, Z1 question 1).

  **Exported symbols.** `FulfilmentStrategyPicker`, and the three types
  `FulfilmentStrategyPickerProps`, `FulfilmentStrategyValue` and `FulfilmentWarehouseOption`.

  ```ts
  import {
    FulfilmentStrategyPicker,
    type FulfilmentStrategyValue,
    type FulfilmentWarehouseOption,
  } from '@endora-commerce/admin-kit/components';
  ```

  ```tsx
  <FulfilmentStrategyPicker
    value={value} // { strategy: FulfilmentStrategy | null; warehouseOrder: string[] }
    onChange={setValue} // every edit, including the ordering, arrives here
    warehouses={warehouses} // { id, code, name }[] — the caller's list
    allowInherit // optional: offers an "inherit" option that maps to a null strategy
    disabled={saving} // optional
    idPrefix="org-fulfilment" // optional: disambiguates element ids when two pickers share a page
  />
  ```

  **Nothing about the component changed** — same props, same behaviour, same element ids. It
  keeps no state of its own: the parent owns `value` and the warehouse list, and owns the
  PATCH.

  **No key moves and no bundle changes.** The component already read `useTranslation('core')`
  and every `fulfilment.*` key it renders was already `@endora-commerce/mod-i18n`'s in both
  shipped languages, so ruling R-1 §9.2 — a translation namespace is module knowledge — costs
  this publication nothing. A consumer supplying its own bundle needs the fourteen
  `fulfilment.*` keys under `core`, which is where they already are.

  `admin/src/modules/inventory/components/FulfilmentStrategyPicker.tsx` stays as a re-export
  shim over the package's own bindings, so the old spelling and the subpath name one module
  record.

- ebc08af: Publishes the Assets-Library picker cluster: `AssetPicker`, `AssetUploader` and
  `AssetFieldPicker` on `./components`, `toAbsoluteAssetUrl` on `./lib`, and the three
  requests they make (`listAssets`, `fetchAssetDetail`, `uploadAsset`) beside them on
  `./components`.

  They were the last of feature 091's Group A pickers, left unpublished because
  `AssetFieldPicker`'s module knowledge was a **component** — `assets_library`' own
  `AssetPicker` — rather than a request, so there looked to be nothing to rebuild.
  Measured, `AssetPicker` is one `GET`, `AssetUploader` is one multipart `POST` over the
  `apiBaseUrl` this package already publishes, and every type all three name
  (`AssetSummary`, `AssetDetail`, `ListAssetsResponse`) is `@endora-commerce/contracts`'.
  So the cluster took the same exit the three data pickers took: the components build
  their own requests and hold no module code.

  **If you rendered a picker through the admin's `@/modules/assets_library/…` paths**,
  name the package instead — those files are gone, and the shim that remains is at
  `@/components/asset-picker/AssetFieldPicker` only.

  ```diff
  -import { AssetPicker } from '@/modules/assets_library/components/AssetPicker';
  -import { AssetUploader } from '@/modules/assets_library/components/AssetUploader';
  -import { toAbsoluteAssetUrl } from '@/modules/assets_library/lib/asset-url';
  -import { assetsLibraryClient } from '@/modules/assets_library/api/assets-library-client';
  +import {
  +  AssetPicker,
  +  AssetUploader,
  +  fetchAssetDetail,
  +} from '@endora-commerce/admin-kit/components';
  +import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
  ```

  `AssetUploader`'s `defaults` prop is typed `AssetUploadFields` rather than the module
  client's `UploadFields`; the shape is unchanged. `assetsLibraryClient.uploadAsset` and
  its `UploadFields` type are removed from the admin's own client, which had no caller
  left once the uploader moved — a second live copy of one multipart `POST` is not
  something to keep.

  **The components' copy is `core`'s now, not `assets_library`'s** (R-1). A translation
  namespace is module knowledge on the same test that permits an HTTP path: the schema
  crossing a path is in a peer dependency both sides compile, and a bundle is not — it is
  shipped by a module package this one may not depend on, and a key that did not travel
  renders `core.assetPicker.empty` at the operator rather than failing to compile. The
  eleven keys the two components read moved: three reuse `core`'s existing
  `common.action.close`, `common.state.loading` and `common.action.search` (the last added
  to that family), and eight are new under `assetPicker.*`. Rendered output is unchanged in
  both shipped languages.

  **If you translate this admin**, `assets_library`'s bundle loses nine keys —
  `common.close`, `picker.empty`, `picker.searchPlaceholder`, `picker.uploadNew` and the five
  `uploader.*` — and `_i18n`'s gains nine. `uploader.triggerCurrentFolder`, `common.loading`
  and `common.search` stay where they are: the module's own screens still read them.

- 47c958f: Published the admin session and module-presence state.

  `@endora-commerce/admin-kit/lib` gains `AuthProvider`, `useAuth`, `AdminMe`,
  `ModulePresenceProvider`, `useModulePresence`, `getModulePresence`,
  `setModuleActivation`, `useSurfaceVisibility`, `isSurfaceVisible`,
  `satisfiesPermission`, `usePageSizePreference` and the `GatedSurface` /
  `PermissionRequirement` types.

  **`useAuth` is how a screen refuses a control the operator may not use**, and until now a
  package could not name it. Sixteen packaged modules therefore render every control live to
  a read-only operator, who fills the form in and gets a 403 on save. This release is what
  lets each of them fix that; the screen-side repairs are the owners'.

  `usePageSizePreference` moves for a related reason. Its constant, `PAGE_SIZE_OPTIONS`, was
  published on its own because the hook reads the signed-in admin's id to key its
  `localStorage` entry — that id comes from `useAuth`, so the split has nothing left to
  separate and both halves are one package's now.

  **If you render one of these,** nothing changes: every prop is the same, and `admin/src`
  keeps a re-export shim at each old path.

  **If you test something that reads them, the seam changed and this is the part to read.**
  `useSurfaceVisibility` calls `useAuth` and `useModulePresence` **inside** the package, so a
  test that replaced either module at its own path no longer reaches the predicate:

  ```diff
  -vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasPermission: () => false }) }));
  -vi.mock('@/lib/module-presence', () => ({ useModulePresence: () => ({ isPresent: () => true }) }));
  +render(
  +  <AuthProvider initial={session}>
  +    <ModulePresenceProvider initial={{ modules: [...], degraded: false }}>
  +      <Subject />
  +    </ModulePresenceProvider>
  +  </AuthProvider>,
  +);
  ```

  `AuthProvider` takes a new optional `initial: AdminMe`, the prop `ModulePresenceProvider`
  has carried since it was written: supply it and the provider starts `authenticated` and
  skips its boot fetch. That is the whole substitution seam, and it is data rather than a
  mock — a permission gate asserted against a stub of the predicate asserts that the stub was
  consulted.

  Two properties of the projection are worth knowing before you seed one. `isPresent` answers
  `false` for a module id the projection does not list, so name every module your subject asks
  about; and an unlisted module is the _hidden_ branch of every gate, which renders as
  nothing at all.

- b2552d5: Published the three data-fetching pickers, and the Organization picker's row shape.

  `@endora-commerce/admin-kit/components` gains `SalesChannelPicker`, `CmsBlockPicker`,
  `CmsPagePicker`, `OrganizationPicker`, `OrganizationPickerMulti`,
  `OrganizationStatusBadge` and `useOrganizationsQuery`. Each of them was previously
  unreachable from a package: it lived in the admin application and imported another
  module's admin API client, so publishing it would have put module code in the kit.

  **A kit component gets its data by building the request itself**, from the published
  `apiClient` and the owner's schema in `@endora-commerce/contracts`. Five kit components
  already did that before this release (`CustomerPicker`, `AdminUserPicker`,
  `CustomerGroupPicker`, `CategorySelect`, `useCountriesQuery`); the rule was simply never
  written down. An HTTP path plus a schema out of a package the kit already depends on is
  not module knowledge — a module's _code_ is, and that is what these seven files no longer
  name.

  **If you render one of these,** nothing changes: every prop is the same, and
  `admin/src` keeps a re-export shim at each old path. **If you test one,** the seam moved:
  mock `@endora-commerce/admin-kit/lib`'s `apiClient`, not the module client.

  ```diff
  -vi.mock('@/modules/organizations/api/organizations-picker-client', () => ({
  -  organizationsPickerClient: { list: listSpy },
  -}));
  +vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  +  ...(await vi.importActual('@endora-commerce/admin-kit/lib')),
  +  apiClient: { get: getSpy, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  +}));
  ```

  `@endora-commerce/contracts` gains `organizationPickerListItemSchema` /
  `OrganizationPickerListItem` and `organizationPickerPageSchema` /
  `OrganizationPickerPage` — the picker's projection over
  `GET /api/v1/admin/organizations`, which now crosses a package boundary and so belongs
  here under Principle II. **There is no `OrganizationStatusPickerFilter`**: its four
  members are exactly `organizationStatusSchema`'s, measured, so the picker takes the
  published `OrganizationStatus` rather than acquiring a second name for one set.

  ```diff
  -import type { OrganizationStatusPickerFilter } from '@/modules/organizations/api/organizations-picker-client';
  +import type { OrganizationStatus } from '@endora-commerce/contracts';
  ```

  `admin/src/modules/organizations/api/organizations-picker-client.ts` is deleted; it
  existed only to serve this picker and nothing else imported it.

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

- cebad9c: Admin zones are usable: a props contract at both ends, `match`, and a `./zones` renderer.

  **Breaking, `@endora-commerce/contracts`.** `AdminZoneNameSchema` no longer carries
  `order.detail.tabs`, `delivery_method.row.actions`, `payment_method.row.actions` or
  `product.editor.sidebar.after`. All four were rendered by no host and contributed to by
  no module — measured — and the new `check:admin-zones` reports a member nothing renders
  as `unrendered-zone` with no ledger to record it in. The three members that replace them
  are the three places a host actually mounts:

  ```diff
  -AdminZoneNameSchema.parse('product.editor.sidebar.after')
  +AdminZoneNameSchema.parse('product.editor.details.before')
  +AdminZoneNameSchema.parse('product.editor.pricing.before')
  +AdminZoneNameSchema.parse('product.editor.field.after')
  ```

  **If you named one of the four removed members**, there is no drop-in replacement: a zone
  name is a place, and each of the four described a place that either does not exist
  (`product.editor.sidebar.after` — the product editor has no right-hand sidebar) or has no
  mount yet. The batch that renders your place adds the member with the mount, in one merge
  request; that is the rule the removals establish.

  New in `@endora-commerce/contracts`:
  - `AdminZonePropsMap`, `AdminZoneProps<Z>` and the props interfaces
    `ProductEditorZoneProps` / `ProductEditorFieldZoneProps`. The map is declared as
    `Record<AdminZoneName, object>`, so a zone member without a props type is a compile
    error in the package itself.
  - `match` on `AdminZoneContributionSchema` —
    `Record<string, string | readonly string[]>`, optional. The renderer includes a
    contribution when every key agrees with the mount's props, and it decides that
    **before** `React.lazy`, so a contributor that serves two of a zone's mounts is not
    downloaded on the rest.

  New in `@endora-commerce/admin-kit`:
  - A `./zones` subpath — `AdminContributionsProvider`, `useAdminZone(name, props)`,
    `<AdminZone name props />`, `ZoneErrorBoundary`, and the pure
    `selectZoneContributions` / `matchesZoneProps`. Presence, permission and `match` are
    filtered at enumeration, so an operator's activation flip needs no rebuild; each
    contribution gets its own error boundary and `Suspense`.
  - `zoneComponent(zone, load, options?)` and `AdminZoneComponent<Z>` on
    `./contributions` — the contributor's end of the props map, which is what constrains a
    module's default export to the zone it names.

  ```ts
  // host
  <AdminZone name="product.editor.field.after"
             props={{ productId, fieldPath: 'name', languageCodes: LOCALES }} />

  // contributor, in src/admin/index.ts
  zoneComponent('product.editor.field.after', () => import('./FieldProtection.js'), {
    weight: 10,
    requiredPermission: 'catalog:write',
  })
  ```

  `./zones` is a separate subpath from `./contributions` on purpose: the second is
  data-only and is what a module's declaration file imports, and one subpath would let a
  declaration file import a component.

- 196fbfa: Six modules ship their admin surfaces, and the delivery-methods list becomes a zone its
  carriers contribute to.

  **New `./admin` subpath on six packages.** `@endora-commerce/mod-seo`,
  `mod-taxes`, `mod-credit-limits`, `mod-delivery-methods`, `mod-megamenu` and `mod-returns`
  each export `contributions` — an `AdminContributions` object — from
  `@endora-commerce/mod-<id>/admin`. Every component is a dynamic-import factory, so a
  consumer's bundler emits one chunk per screen. The routes are unchanged: `/seo`, `/taxes`,
  `/credit-limits`, `/delivery-methods`, `/megamenu` plus `/megamenu/:id`, and `/returns`
  plus its four sub-screens.

  Three things a consumer has to know about that half:
  - **The subpath needs a build.** `./admin` resolves at `dist/admin/index.js`, emitted by
    each package's new `tsconfig.ui.json`; a checkout that has not run
    `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit` and `react` become peer dependencies of all six.** The kit
    is where every screen's design-system import resolves, and `react` is peered rather than
    depended on so the application resolves one copy.
  - **Each package now ships an `i18n/` bundle carrying its own `nav.*.label`.** The sidebar
    label is module-relative — `nav.seo.label`, `nav.taxes.label`, `nav.creditLimits.label`,
    `nav.deliveryMethods.label`, `nav.megamenu.label`, `nav.returns.label` — resolved in the
    module's own namespace instead of the shared `core` one.

  **New in `@endora-commerce/contracts`:**
  - `AdminZoneNameSchema` gains `'delivery_method.list.integrations'`, the first member whose
    host is not the product editor, with `DeliveryMethodIntegrationsZoneProps` (empty: the
    host renders one card per shipping integration and has no identifier to name one by) and
    its `AdminZonePropsMap` entry.
  - `KnownIconNameSchema` gains `'Newspaper'`, which `megamenu`'s sidebar entry names now
    that it declares its own row rather than importing the glyph.

  **New in `@endora-commerce/admin-kit`:** `DeliveryMethodIntegrationsZoneProps` is re-exported
  from `./contributions`, and `resolveIcon('Newspaper')` answers.

  **`mod-dhl-parcel` and `mod-inpost` each gain a zone contribution**, on the `./admin`
  subpath they already had:

  ```ts
  zoneComponent(
    'delivery_method.list.integrations',
    () => import('./zones/DeliveryMethodIntegrationCard.js'),
    {
      weight: 100,
      requiredPermission: 'dhl_parcel:read',
    },
  );
  ```

  `delivery_methods` used to render both cards itself, with each carrier's title, description,
  route and permission code written into its own file. A third carrier now needs no edit to a
  file its author does not own, and the presence gate, the permission gate and the ordering are
  the zone renderer's.

  Nothing is removed and no existing export changes shape, so a consumer of any package's
  `./backend`, `./migrations` or root subpath is unaffected.

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

- 214cbdb: `CategoryTreePicker` now resolves its strings in the `core` namespace instead of `catalog`
  (feature 091, ruling R-1: a translation namespace is module knowledge and the kit holds none).
  It is the last of the three components the ruling names; `AssetPicker` and `AssetUploader`
  moved in the preceding release.

  **What a consumer has to do: nothing, if it renders inside the platform's own
  `TranslationProvider`.** All seven keys moved with the component and kept their spelling —
  `categoryTreePicker.loading`, `.filter.placeholder`, `.aria.treeLabel`, `.empty.noCategories`,
  `.empty.noMatches`, `.expand`, `.collapse` — so only the namespace changed, and no rendered text
  changes.

  **What a consumer that supplies its own bundle has to do:** move those seven keys from the
  `catalog` scope of the bundle into `core`. A key left behind does not fail to compile and does
  not 404 — it renders `core.categoryTreePicker.loading` into the screen as a label.

- 3c8102e: `LineChart` joins the admin icon allowlist.

  `KnownIconNameSchema` gains `'LineChart'` and `resolveIcon` maps it to the lucide component
  of that name — the pair AGENTS.md's command-palette checklist requires in one merge request,
  because a name on the allowlist with no entry in the map renders the generic `Sparkles`
  fallback.

  It is added rather than substituted because a module's sidebar entry now declares its icon
  by name (`AdminNavDeclarationSchema.icon` is this same enum). `analytics`' entry was a
  direct `lucide-react` import in `admin/src/components/AppShell.tsx`; picking a name already
  on the list would have changed the glyph an operator sees, which is a visible regression
  bought for nothing.

- c94c52d: `api_keys`, `webhooks` and `comparisons` ship their admin surfaces, on a new `./admin` subpath
  each; `KnownIconNameSchema` gains two members and the kit's icon map the glyphs behind them.

  Each of the three module packages now exports `contributions` from
  `@endora-commerce/mod-<id>/admin` as an `AdminContributions` object whose every component is a
  dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
  downloaded by an operator who cannot reach it. The routes are unchanged — `/api-keys`,
  `/webhooks`, `/comparisons` and `/comparisons/:id` — and each package contributes a sidebar
  entry as well.

  Five things a consumer has to know:
  - **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
    `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
    not run `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit`, `react` and `lucide-react` become peer dependencies of all
    three, and `react-router-dom` of `comparisons`.** They were backend-only packages before
    this. The kit is where every screen's design-system import now resolves, and React is peered
    rather than depended on so the application resolves one copy.
  - **Every route carries a `requiredPermission`, and the admin enforces it.**
    `integrations:manage` for `/api-keys` and `/webhooks`, `comparisons:read` for both comparison
    routes — in each case the code the screen's own API enforces. A host `<Route>` was ungated,
    so a consumer who deep-links one of these paths for an operator without the code now gets the
    admin's not-found treatment where the screen used to render and its API answered 403.
  - **`KnownIconNameSchema` gains `Webhook` and `Scale`.** A nav entry and a palette action name
    their icon; both glyphs were `lucide-react` imports inside the admin's own `AppShell.tsx`
    until this change, so keeping the sidebar looking the same meant adding the names rather than
    substituting two already on the allowlist. `@endora-commerce/admin-kit`'s `resolveIcon` maps
    both. Widening a `z.enum` is additive for a producer and narrowing for a consumer that
    exhaustively switches on `KnownIconName`; nothing in this repository does.
  - **Each of the three declares its first command-palette action** — `open-api-keys`,
    `open-webhooks` and `open-comparisons` — with both labels in the package's own `i18n/` bundle.
    A consumer resolving palette entries from the manifests will see one more per module.

  Nothing is removed and no existing export changes shape, so a consumer of any of the three
  `./backend`, `./migrations` or root subpaths is unaffected.

- 4013a8b: `promotions`, `payment_methods`, `customer_accounts` and `product_feeds` ship their admin
  surfaces, on a new `./admin` subpath each; `KnownIconNameSchema` gains one member and the kit's
  icon map the glyph behind it.

  Each of the four module packages now exports `contributions` from
  `@endora-commerce/mod-<id>/admin` as an `AdminContributions` object whose every component is a
  dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
  downloaded by an operator who cannot reach it. Seventeen routes and eight sidebar entries move,
  and not one of the routes changes its path: `/promotions`, `/promotions/new`, `/promotions/:id`,
  `/promotions/:id/stats` and `/promotion-rules`; `/payment-methods`; `/customer-groups`; and the
  ten `/product-feeds*` paths.

  Six things a consumer has to know:
  - **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
    `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
    not run `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit`, `react`, `lucide-react` and `react-router-dom` become peer
    dependencies of all four.** They were backend-only packages before this. The kit is where
    every screen's design-system import now resolves, and React is peered rather than depended on
    so the application resolves one copy.
  - **Every route carries a `requiredPermission`, and the admin enforces it.** `promotions:read`
    for all five promotion routes, `payment_methods:read`, `customer_groups:read` and
    `product_feeds:read` — in each case the code the screen's own API enforces on its entry
    handler. A host `<Route>` was ungated, so a consumer who deep-links one of these paths for an
    operator without the code now gets the admin's not-found treatment where the screen used to
    render and its API answered 403. The write codes each of these modules also owns
    (`promotions:write`, `promotions:delete`, `payment_methods:write`, `customer_groups:write`,
    `product_feeds:write`) gate controls **inside** a screen and are unchanged.
  - **`KnownIconNameSchema` gains `PercentDiamond`.** A nav entry names its icon, and both of
    `promotions`' sidebar rows drew that glyph as a `lucide-react` import inside the admin's own
    `AppShell.tsx` until this change — so keeping the sidebar looking the same meant adding the
    name rather than substituting one already on the allowlist.
    `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Widening a `z.enum` is additive for a
    producer and narrowing for a consumer that exhaustively switches on `KnownIconName`; nothing
    in this repository does. The other three modules needed nothing — `CreditCard`, `Users` and
    `Rss` are already on the list, each added by an earlier palette action of that same module.
  - **`@endora-commerce/mod-product-feeds` gains two sales-channel reads of its own.**
    `feedSalesChannelReads.list()` and `.getByCode()` on the module's admin client build
    `GET /api/v1/admin/sales-channels` requests from the published `apiClient` and the contract's
    own `SalesChannelListResponse` / `SalesChannelDetail`. The create form used to import
    `sales_channels`' admin client for the same two calls; duplicating one HTTP call is
    deliberate, because the only place two modules could share it is the admin kit and the kit
    holds no module knowledge.
  - **`product_feeds`' download anchors now read the API origin from
    `@endora-commerce/admin-kit`'s `apiBaseUrl`.** They read `import.meta.env.VITE_API_BASE_URL`
    directly before, with a `''` fallback — same-origin, which in a dev tree is the Vite server
    and has no API behind it. The kit's fallback is `http://localhost:3001`. Whenever the
    variable is set the two are identical, so this is a repair to the unset case and not a change
    to any configured one.

  Each of the four modules' nav labels move out of the shared `_i18n` bundle into the package's
  own `i18n/`, under module-relative keys (`nav.promotions.label`, `nav.promotionRules.label`,
  `nav.paymentMethods.label`, `nav.customerGroups.label`, `nav.productFeeds.label`). One shared
  key is deliberately kept: `appShell.nav.paymentMethods` is still the parent crumb of five
  breadcrumb trails the admin holds for the payment-gateway settings screens.

  Nothing is removed and no existing export changes shape, so a consumer of any of the four
  `./backend`, `./migrations`, `./ports` or root subpaths is unaffected.

- fc34995: `pwa` ships an admin surface that is a sidebar entry and nothing else.

  `@endora-commerce/mod-pwa/admin` is a new subpath exporting `contributions` — an
  `AdminContributions` object with **one `nav` entry and no `routes`**. That combination is
  legal and was, until now, unexercised: the type's own documentation says _"a module shipping
  only a nav entry pointing at a host route is legal"_, and every conversion before this one
  moved a route. The entry advertises `/settings/pwa`, labelled `nav.pwa.label` in this
  package's own `i18n/{en,pl}.json` rather than in the shared bundle, in section `system` at
  weight 1400, gated on `pwa:read`.

  Two things a consumer has to know:
  - **The screen at that path is not in this package.** `PwaPage` lives in the admin
    application, under a directory `settings` owns, so the route is still declared by the host.
    A consumer that renders the registry's nav without the admin's own route table will show an
    entry pointing at a path it does not serve. That resolves when `settings` ships its own
    admin layer.
  - **`Smartphone` joins the icon allowlist.** `KnownIconNameSchema` gains the name and the
    kit's `resolveIcon` maps it to the lucide component of that name — the pair AGENTS.md's
    command-palette checklist requires in one merge request, because a name on the allowlist
    with no entry in the map renders the generic `Sparkles` fallback. It is added rather than
    substituted so the sidebar keeps the glyph it already drew.

- 9b2a43e: Added the `order.entry.tabs` admin zone, and `<RouteTabsZone>` — the renderer that makes a
  zone a tab strip.

  `@endora-commerce/contracts` gains the enum member `'order.entry.tabs'` and the props type
  `OrderEntryTabsZoneProps`, which is empty: the contributions _are_ the tabs, so the mount has
  no identifier to pass. `AdminZonePropsMap` gains the matching entry, so a host writing
  `<RouteTabsZone name="order.entry.tabs" props={{}} />` is type-checked against it exactly as
  an `<AdminZone>` mount is.

  `@endora-commerce/admin-kit` gains two exports:
  - `RouteTabsZone` on `./zones` — `{ name, props, className? }`. It renders the strip chrome
    and delegates the contributions to `<AdminZone>`, so the lazy-component cache, the
    per-contributor error boundary and the `weight` ordering are unchanged. **It renders
    nothing at all when fewer than two contributions survive presence and permission**: one tab
    is not a choice. The floor is a constant rather than a prop, deliberately — two is a
    property of tab strips, and a `minimum` prop would let a caller ask for the thing the rule
    refuses.
  - `RouteTabLink` on `./ui` — `{ to, label }`, the tab a contribution renders. It decides its
    own selected state, because in a contributed strip no component sees the whole set. That
    costs `RouteTabs`' _longest-wins_ tie-break: two contributed tabs whose paths are prefixes
    of one another would both read as selected. `RouteTabs` itself is unchanged and is still
    the primitive to use whenever one component knows every tab.

  `@endora-commerce/mod-orders` gains an `./admin` subpath — its first — contributing the
  _Standard order_ tab at weight 100. `@endora-commerce/mod-quick-order` gains the _Quick
  order_ tab at weight 200. Both are gated on `orders:write`, which is the code their routes
  enforce. Each label now ships in its own module's bundle
  (`orderEntry.tab.standard`, `orderEntry.tab.quick`) instead of the shared `core` one.

  **If you were rendering `OrderEntryTabs` from the admin application**, it is gone. It knew
  both module ids and both routes and belonged to neither module; mount the zone instead:

  ```diff
  -import { OrderEntryTabs } from '@/components/OrderEntryTabs';
  -<OrderEntryTabs />
  +import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
  +<RouteTabsZone name="order.entry.tabs" props={{}} className="mb-4" />
  ```

- e7bbadc: Field protection is published surface, and both PIM connectors contribute it.

  `@endora-commerce/admin-kit` gains a subpath, `./field-protection`, exporting
  `useFieldProtection`, `FieldProtectionToggle`, `FieldProtectionSummary`,
  `FieldProtectionPricePanel`, `describeFieldPath`, `controlIdPrefix` and the types
  `FieldProtectionSource`, `FieldProtectionView`, `FieldProtectionEntry`,
  `FieldProtectionPricePath` and `FieldProtectionApi`. It holds the per-scope store, the
  mount de-duplication and the optimistic write with its rollback, and it holds no HTTP
  knowledge at all: `load`, `save`, the translator and the source label arrive on one
  `FieldProtectionSource` prop from the integration that owns them.

  ```ts
  import { FieldProtectionToggle } from '@endora-commerce/admin-kit/field-protection';

  const source = {
    scopeKey: `my_pim:${productId}`,   // keys the store and prefixes the DOM ids
    sourceLabel: 'My PIM',             // what the operator calls the integration
    t: useTranslation('my_pim'),       // reads fieldProtection.* out of your bundle
    load: async () => (await client.get(productId)).data,
    save: async (protections) => (await client.replace(productId, { protections: [...protections] })).data,
  };

  <FieldProtectionToggle source={source} fieldPath="name" languageCode="pl-PL" />;
  ```

  `@endora-commerce/mod-pim-ergonode` gains an `./admin` subpath declaring three zone
  contributions — `product.editor.details.before`, `product.editor.pricing.before` and
  `product.editor.field.after` — and `@endora-commerce/mod-pim-pimcore` adds the same three
  to the ones it already declared, together with `pimcoreProtectionsClient` on its `./admin`
  export. Neither ships a control of its own any more, so a platform carrying both PIMs
  renders one control per connected integration instead of two implementations of one
  concept.

  Consumers that imported `FieldProtectionToggle`, `FieldProtectionSummary`,
  `ErgonodePriceProtectionPanel` or `ErgonodeAttributeValueProtection` from
  `admin/src/modules/pim_ergonode/components/FieldProtectionToggle` render an
  `<AdminZone>` instead: the file is deleted and no re-export shim replaces it, because the
  whole point of the change is that a host names no integration.

### Patch Changes

- 68044b1: `CustomFieldValuesPanel` now tells a failed definitions load apart from an entity type
  with no custom fields.

  The `defs.length === 0` early return sat **above** the error `Alert`, so both cases
  rendered nothing: a broken `GET /api/v1/admin/custom-fields/definitions` was
  indistinguishable from "no custom fields are defined for this entity type", and an
  operator had no way to know a retry was worth anything. This is the defect the panel's
  publication (`admin-kit@minor`, "One defect travels with it, deliberately unfixed")
  recorded rather than repaired, so that the move stayed reviewable.

  The empty return is now conditional on the load having answered:

  ```diff
  -if (defs.length === 0) return null;
  +if (defs.length === 0 && error === null) return null;
  ```

  An empty entity type still renders nothing — that behaviour is unchanged, and is asserted
  beside the repair. A failed load renders the card with the error `Alert` and **no save
  button**: there is nothing to edit and nothing to write. A read that succeeds also clears
  a previous entity type's failure, which it did not need to before, `error` now being what
  decides the empty branch.

  **The 503 case the old ordering was argued to be accidentally right for does not exist.**
  `custom_fields` declares `activation.nonDeactivatable`, which since issue #258 makes it a
  module the composition is required to have: `composeModules` refuses a composition that
  would reach its boot phase without it, and D-69 refuses every disable and every uninstall.
  A platform that cannot serve this endpoint does not boot, so `MODULE_DISABLED` is
  unreachable here and the repair needed two branches rather than three.

  No prop, no export and no translation key changes.

- 31975ca: `KnownIconNameSchema` gains `'PlugZap'`, with the matching entry in the kit's
  `resolveIcon` map. A module declaring a sidebar entry or a palette action names its icon as a
  string rather than importing the component, so a glyph the allowlist does not carry cannot be
  declared at all.

  `@endora-commerce/contracts` also publishes the Pimcore connector's own surface — the
  `Pimcore*` DTOs, the delivered-record envelope, `PIM_PIMCORE_SETTING_CODES` and seventeen
  `PIM_PIMCORE_*` members of `ERROR_CODES` — and three catalogue shapes the connector's ports
  need.

  No existing export changes shape.

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
