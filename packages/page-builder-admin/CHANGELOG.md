# @endora-commerce/page-builder-admin

## 0.8.2

### Patch Changes

- Updated dependencies [5bfefe0]
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2
  - @endora-commerce/page-builder-core@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [c1d281f]
- Updated dependencies [52c2bfd]
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1
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
  - @endora-commerce/email-components@0.8.0
  - @endora-commerce/page-builder-core@0.8.0
  - @endora-commerce/cms-components@0.8.0

## 0.7.0

### Minor Changes

- 1f07b01: New package: `@endora-commerce/page-builder-admin`, the admin-side page-builder chrome and
  the e-mail builder (feature 091 P5b; owner ruling D-192, widened in name only by
  `admin-component-contribution.md` Z1.2).

  Two subpaths. **`.`** publishes the chrome any builder composes — `PageBuilderHeaderActions`
  with `PageBuilderHeaderShell` and `PageBuilderTemplateActions`, the `createImage*` /
  `createSlideImage` / `createVideo*` asset field factories, the `create*Slug*` catalog field
  factories, `PageBuilderColorPaletteProvider`, `ColorPaletteModal`,
  `PageBuilderOverlayBridge`, `QuickTooltip` / `wrapQuickTooltip`, the `action-bar-target`
  store and `emptyPageBuilderData` / `isEmptyPageBuilderData`. **`./email`** publishes the
  e-mail builder those primitives compose — `EmailEditorPane`, `EmailVariablesProvider`,
  `EmailSubjectWithVariables`, `mergeEmailVariables`, `createEmailBuilderEditorPlugin` and the
  three template operations `saveCanvasAsEmailTemplate`, `listEmailTemplatesForApply` and
  `loadEmailTemplateCanvas`.

  **Why a fourth `page-builder` family member rather than a directory in `cms`.** All of it
  lived in `admin/src/modules/cms/components/` and `admin/src/modules/_shared/email-builder/`,
  and none of it names `cms`: `cms` held the chrome because `cms` was the first builder
  written. `cms` publishing it would make `transactional_emails` depend on `cms` in order to
  build an e-mail, and the admin kit refuses it on shape — every file here is a Puck component
  or field factory, so the kit would put `@measured/puck` behind the admin design system for
  all 66 module packages.

  **It is in the `linked` group** with `@endora-commerce/page-builder-core`,
  `@endora-commerce/cms-components` and `@endora-commerce/email-components`, and it peers on
  all three plus `@endora-commerce/admin-kit`. The peer ranges are load-bearing rather than
  tidy: `PageBuilderColorPaletteProvider` wraps `page-builder-core`'s `ColorPaletteProvider`
  context and `EmailVariablesProvider` is a context of its own, so a consumer that resolves two
  copies of either gets a `null` context at runtime and no type error.

  **Nothing here is new code.** Every binding is the one that stood in `admin/src`, and
  `admin/src` keeps a re-export shim at each old path, so an existing `@/modules/cms/components/…`
  specifier resolves to the package's own binding rather than to a copy.

  `@endora-commerce/cms-components` is patched because nothing of its own changed: it is listed
  so the release records that this package compiles its source and peers on its range.

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
- Updated dependencies [5fc0550]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [11fc9f3]
- Updated dependencies [afedd32]
- Updated dependencies [f66ce9b]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [b9d15af]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
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
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a92d972]
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
  - @endora-commerce/page-builder-core@0.7.0
  - @endora-commerce/cms-components@0.7.0
  - @endora-commerce/email-components@0.7.0
