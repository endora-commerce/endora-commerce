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
