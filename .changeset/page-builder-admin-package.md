---
'@endora-commerce/page-builder-admin': minor
'@endora-commerce/cms-components': patch
---

New package: `@endora-commerce/page-builder-admin`, the admin-side page-builder chrome and
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
