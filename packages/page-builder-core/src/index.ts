export {
  DEFAULT_BREAKPOINTS,
  PAGE_BUILDER_CONTEXTS,
  PB_RESPONSIVE_METADATA,
  PB_DATA_METADATA,
  PB_ITEMS_METADATA,
  SETTINGS_SCOPE_LABELS,
  hasResponsiveOverride,
  hideOnDataAttrs,
  isDataField,
  isItemsField,
  isHiddenOnTier,
  isResponsiveField,
  isResponsiveProp,
  normalizeResponsive,
  resolveResponsive,
  settingsScopeToTier,
  tierFromViewportWidth,
  type BreakpointTier,
  type HideOn,
  type PageBuilderBreakpoints,
  type PageBuilderContext,
  type ResponsiveProp,
  type SettingsScope,
} from './types/responsive.js';

export type { HideOnProps } from './types/hide-on.js';
export type { PageBuilderEditorProps } from './types/editor-chrome.js';
export {
  EDITOR_NAME_FIELD_KEY,
  GENERAL_SECTION_FIELD_KEY,
  RESPONSIVE_SECTION_FIELD_KEY,
  RESPONSIVE_SCOPE_FIELD_KEY,
} from './types/editor-chrome.js';

export {
  buildPaletteCategories,
  type BuildPaletteOptions,
  type ServedPaletteBlock,
  type ServedPaletteSection,
} from './palette.js';

export {
  contextAdmits,
  definePageBuilderComponent,
  filterConfigByContext,
  getComponentContexts,
  getDisallowedComponentNames,
  getResponsiveFields,
  type ComponentContextMeta,
  type PageBuilderComponentDefinition,
} from './define-component.js';

export {
  RESPONSIVE_HIDE_ON_CLASS,
  breakpointCssVars,
  buildResponsiveNumberVars,
  buildResponsiveCSSValueVars,
  resolveResponsiveNumber,
  resolveRowAlignClassForTier,
  resolveTextAlignClassForTier,
  resolveTextAlignForTier,
  responsiveRowAlignClass,
  responsiveTextAlignClass,
  textAlignDataAttrs,
} from './render/responsive-styles.js';

export {
  DEFAULT_BORDER,
  DEFAULT_SPACING,
  CONTENT_WIDTH_MAX,
  ROW_CONTENT_MAX_WIDTH,
  CORNER_RADIUS_PX,
  SHADOW_CSS,
  borderSidesToCss,
  borderStyleForTier,
  borderToCss,
  buildResponsiveBorderVars,
  buildResponsiveColumnCountVars,
  buildResponsiveSpanVars,
  buildResponsiveSpacingVars,
  clampColumnSpan,
  contentPositionToJustify,
  gridTemplateColumnsFromCount,
  normalizeBorder,
  normalizeSpacing,
  resolveBorder,
  resolveColumnCount,
  resolveColumnSpan,
  resolveContentPosition,
  resolveSpacing,
  resolveVerticalAlign,
  spacingStyleForTier,
  spacingToCss,
  verticalAlignToCss,
  type BorderSide,
  type BorderStyle,
  type BorderValue,
  type ContentPosition,
  type ContentWidth,
  type CornerRadius,
  type RowContentMaxWidth,
  type RowSectionLayout,
  type Shadow,
  type SpacingValue,
  type VerticalAlign,
} from './types/box-styles.js';

export { createSpacingField } from './fields/spacing-field.js';
export { createBorderField } from './fields/border-field.js';
export { createColorField } from './fields/color-field.js';
export { createBackgroundField } from './fields/background-field.js';
export { NativeColorInput } from './fields/native-color-input.js';

export {
  normalizeBackground,
  backgroundToStyle,
  type BackgroundKind,
  type BackgroundProp,
  type BackgroundValue,
  type MediaSourceKind,
} from './types/background.js';

export { withHideOn } from './visibility/with-hide-on.js';

// Feature 096 — the one implementation of the block-name readers. Also
// reachable as `@endora-commerce/page-builder-core/block-name` through this
// package's wildcard subpath, which is what a migration should import: it
// carries no React.
export {
  formatBlockName,
  isNamespaced,
  ownerOf,
  parseBlockName,
  type ParsedBlockName,
} from './block-name.js';

// The structural walk over a stored Puck document — feature 096, T403/T602.
//
// It lived under the migration directory until Phase 6, which is where its
// first two readers were: the five rename migrations and the operator's
// pre-flight report. It is on the ordinary barrel because its third reader is a
// runtime one — the admin editor has to know which of a stored document's names
// no installed module can render, so that each of them degrades to the
// data-preserving placeholder FR-019 requires. **What the migration subpath
// quarantines is the frozen rename map, not this**: the difference between a
// frozen historical constant and the permanent alias map the owner rejected on
// 2026-09-02 is whether a resolver can reach the *map*, and
// `backend/test/unit/cms/frozen-map-not-on-a-runtime-path.test.ts` is what holds
// that line — which is also why this comment spells that subpath in prose
// rather than as a specifier: the assertion is a text one over this file, and
// it is right to be. A second, private walk written inside the admin would be
// exactly the copy `block-name.ts`' header exists to refuse.
export {
  countBlockNames,
  mapBlockNames,
  renameBlockNames,
  type BlockNameVisitor,
  type BlockNameWalkResult,
} from './block-tree.js';
