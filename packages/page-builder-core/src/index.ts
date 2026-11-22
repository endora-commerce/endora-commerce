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
// Feature 163, R17 (T199) — one switch for every true/false setting.
export { createToggleField, ToggleSwitch, type ToggleFieldOptions } from './fields/toggle-field.js';
// Feature 163, R17 (T200) — one translation for a field the page builder owns.
export {
  PAGE_BUILDER_SHARED_FIELD_KEYS,
  sharedFieldLabel,
  withSharedFieldLabel,
  type PageBuilderSharedFieldKey,
  type SharedFieldLabel,
} from './fields/shared-field-label.js';
export {
  createColorField,
  createResponsiveColorField,
  writeResponsiveColor,
  type ResponsiveColorProp,
} from './fields/color-field.js';
// Feature 163, T040 — block colours may reference a brand colour role (research R-6).
export {
  BRAND_COLOR_ROLES,
  brandColorFallback,
  brandColorRole,
  resolveColorValue,
  type BrandColorRole,
} from './types/brand-colors.js';
export { createBackgroundField } from './fields/background-field.js';
// Feature 163, T117 — the custom fields of `cms.Section`'s flat props; the
// spacing ones are responsive and sit on the editor's Responsive tab.
export {
  createSectionAnchorField,
  createSectionBackgroundField,
  createSectionRevealField,
  createSectionSpaceField,
  isSectionBackgroundField,
  isTopLevelParent,
  type SectionAssetInputProps,
  type SectionBackgroundField,
  type SectionFieldOptions,
  type SectionSpaceFieldOptions,
  type SectionSpaceProp,
} from './fields/section-field.js';
// Feature 163, T126, T127 — an aspect ratio per breakpoint on the Responsive tab.
export {
  createAspectRatioField,
  type AspectRatioFieldOptions,
  type AspectRatioProp,
} from './fields/aspect-ratio-field.js';
export { NativeColorInput } from './fields/native-color-input.js';
// Feature 163, T116 — the side bar's shared field chrome and the copy of the
// package's own controls (FR-039: the admin translates it through the provider).
export { PB_FIELD_HINT_CLASS, PB_FIELD_INPUT_CLASS, PB_FIELD_LABEL_CLASS } from './fields/field-classes.js';
export { FIELD_TIERS, FieldControlLabel, ResponsiveTiers, type FieldTier } from './fields/field-ui.js';
export {
  PAGE_BUILDER_FIELD_TEXT,
  PageBuilderFieldTextProvider,
  useFieldText,
  type FieldText,
  type PageBuilderFieldTextKey,
  type PageBuilderFieldTextResolver,
} from './fields/field-text.js';
// Issue #1684 — the content the builder seeds into a document, in the edited content locale.
export {
  PAGE_BUILDER_CONTENT_DEFAULTS,
  contentDefaultFor,
  contentDefaultsIn,
  withContentDefaultProps,
  type ContentDefault,
  type ContentDefaultPropsMap,
  type PageBuilderContentDefaultKey,
} from './fields/content-defaults-table.js';
export { PageBuilderContentLocaleProvider, useContentDefault, useContentLocale } from './fields/content-defaults.js';
// Feature 163, T195 — the host's image picker (the admin's asset library), for the rich text's image dialog.
export {
  PageBuilderImagePickerProvider,
  useImagePicker,
  type PageBuilderImagePicker,
  type PageBuilderImagePickerProps,
  type PickedImage,
} from './fields/image-picker.js';

export {
  normalizeBackground,
  backgroundToStyle,
  type BackgroundKind,
  type BackgroundProp,
  type BackgroundValue,
  type MediaSourceKind,
} from './types/background.js';

// Feature 163 — section settings as the editor and renderers handle them
// (data-model §3.4, research R-8, R-9).
export {
  DEFAULT_SECTION_SPACE,
  SECTION_CONTENT_POSITIONS,
  SECTION_CONTENT_WIDTH_OPTIONS,
  SECTION_SCHEME_OPTIONS,
  SECTION_SPACE_FALLBACKS,
  SECTION_SPACE_TOKENS,
  SECTION_WIDTH_OPTIONS,
  SECTION_WIDTHS_WITH_CONTENT_WIDTH,
  isSpaceToken,
  normalizeSectionBackground,
  type SectionBackgroundValue,
  type SectionDefaults,
  type SectionSettingsValue,
} from './types/section.js';

// Feature 163 — the prop shapes blocks share (data-model §3), authored in
// `contracts` and re-exported here for renderers and editor fields.
export {
  ASPECT_TOKENS,
  BACKGROUND_REPEATS,
  DESKTOP_FROM_TIERS,
  SECTION_OUTSET_PX_MAX,
  BACKGROUND_SIZE_KEYWORDS,
  BACKGROUND_SIZE_PERCENT_MAX,
  BACKGROUND_SIZE_PX_MAX,
  INLINE_ICON_NAME_RE,
  INLINE_ICON_OFFSET_EM,
  INLINE_ICON_SIZE_EM,
  INLINE_ICON_SIZE_PX,
  INLINE_ICON_SIZE_RE,
  backgroundSizeToCss,
  isBackgroundRepeat,
  isInlineIconOffset,
  isInlineIconSize,
  COLOR_TOKEN_RE,
  EMPHASIS_VARIANTS,
  FOCAL_TOKENS,
  HEX_COLOR_RE,
  SECTION_ANCHOR_MAX_LENGTH,
  SECTION_ANCHOR_RE,
  inlineRichTextToPlain,
  isAspectToken,
  isSafeLinkUrl,
  normalizeAnchor,
  plainTextToInlineRichText,
  type AspectToken,
  type BackgroundRepeat,
  type BackgroundSizeKeyword,
  type BackgroundSizeValue,
  type DesktopFromTier,
  type ButtonFill,
  type ButtonIconPosition,
  type ButtonSize,
  type ButtonSpec,
  type ButtonStyle,
  type ColorValue,
  type EmphasisVariant,
  type FocalToken,
  type InlineRichMark,
  type InlineRichNode,
  type InlineRichText,
  type LinkKind,
  type LinkTarget,
  type LinkValue,
  type Responsive,
  type ResponsiveImage,
  type RevealSetting,
  type SectionBackground,
  type SectionContentPosition,
  type SectionContentWidth,
  type SectionOverlay,
  type SectionScheme,
  type SectionSettings,
  type SectionWidth,
  type SpaceToken,
  type SpaceValue,
} from './types/page-builder-props.js';

// Feature 163 — the brand tokens' types (data-model §2). The values (the
// built-in set, the token lists) are on the `./brand-tokens` subpath.
export type {
  BrandFontSource,
  BrandScheme,
  BrandSchemeColors,
  BrandSpaceToken,
  BrandTypeStyle,
  BrandTypeToken,
  CmsBrandTokens,
} from './brand-tokens.js';

export {
  BLOCK_ORDER_PARENTS,
  BlockDepthContext,
  createStackOrderField,
  EmbeddedBlockDepth,
  STACK_ORDER_VALUES,
  stackOrderAttributes,
  useSectionContext,
  withHideOn,
  type SectionContextValue,
  type StackOrder,
} from './visibility/with-hide-on.js';

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
  countComponentNames,
  mapBlockNames,
  renameBlockNames,
  type BlockNameVisitor,
  type BlockNameWalkResult,
} from './block-tree.js';

// Feature 163 — the section anchors of a document, which the link field's
// in-page kind offers (research R-8, R-11). Pure, so the server's duplicate-anchor
// check can read the same walk as the editor.
export { collectAnchors } from './editor/anchors.js';
