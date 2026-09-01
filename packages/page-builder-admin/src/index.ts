/**
 * `@endora-commerce/page-builder-admin` — the admin-side page-builder **chrome**:
 * the header actions, the asset and catalog field factories, the colour palette,
 * the component overlay bridge, the action-bar target and the empty-canvas
 * predicate.
 *
 * ## Why this is a package and not a directory in `cms`
 *
 * Every file behind this barrel lived in `admin/src/modules/cms/components/`
 * and named `cms` nowhere — 1887 lines that `cms`, `blog` and `invoices` all
 * render, in `cms` because `cms` was the first builder written and for no other
 * reason (D-192; `admin-component-contribution.md` Z1.2). `cms` owning it is the
 * inversion D-192 refused, one hop out: `transactional_emails` would have had to
 * depend on `cms` in order to build an e-mail.
 *
 * The kit refuses it for two reasons of **shape** that survive repairing every
 * reach: R7, because every file here is a Puck component or field factory and
 * the kit is what all 66 module packages' admin layers compile against, so
 * `@measured/puck` would sit behind the admin design system for every one of
 * them; and R5, because the kit publishes what the admin already uses rather
 * than arriving as a barrel.
 *
 * So: a fourth member of the `page-builder` family beside
 * `@endora-commerce/page-builder-core`, `@endora-commerce/cms-components` and
 * `@endora-commerce/email-components`, in D-108's one `linked` group.
 *
 * ## Two subpaths
 *
 * `.` is this — the chrome any builder composes. `./email` is the e-mail builder
 * that composes it, which `newsletter` and `transactional_emails` render.
 *
 * `admin/src` keeps a re-export shim at each old `modules/cms/components/…`
 * path, so `cms`' own screens reach these bindings by the specifier they always
 * used and the forwarding is the identity rather than a copy — which matters
 * here more than it does for a stateless helper: `ColorPaletteProvider` is a
 * React context and `action-bar-target` is a module-scoped store, and two copies
 * of either are a `null` context and an action bar that never updates.
 */
export { emptyPageBuilderData, isEmptyPageBuilderData } from './chrome/page-builder-data.js';
export {
  getActionBarTarget,
  getHoverActionBarTarget,
  getSelectedActionBarTarget,
  setHoverActionBarTarget,
  setSelectedActionBarTarget,
  useActionBarTarget,
} from './chrome/action-bar-target.js';
export type { ActionBarTarget } from './chrome/action-bar-target.js';
export { QuickTooltip, wrapQuickTooltip } from './chrome/QuickTooltip.js';
export { PageBuilderOverlayBridge } from './chrome/PageBuilderOverlayBridge.js';
export {
  PageBuilderHeaderActions,
  PageBuilderHeaderShell,
  PageBuilderTemplateActions,
} from './chrome/PageBuilderHeaderActions.js';
export type { ApplyTemplateOption } from './chrome/PageBuilderHeaderActions.js';
export {
  createImageAssetField,
  createImageSourceField,
  createImageUrlField,
  createSlideImageField,
  createVideoAssetField,
  inputClassName,
  pickerButtonClass,
} from './chrome/AssetPickers.js';
export type { SlideImageValue } from './chrome/AssetPickers.js';
export {
  createCategorySlugField,
  createCategorySlugsField,
  createProductSlugField,
  createProductSlugsField,
} from './chrome/CatalogPickers.js';
export { PageBuilderColorPaletteProvider } from './chrome/ColorPaletteProvider.js';
export { ColorPaletteModal } from './chrome/ColorPaletteModal.js';
export {
  getPageBuilderColorPalette,
  putPageBuilderColorPalette,
} from './chrome/cms-page-builder-api.js';
