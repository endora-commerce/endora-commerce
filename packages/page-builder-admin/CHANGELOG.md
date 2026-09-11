# @endora-commerce/page-builder-admin

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
