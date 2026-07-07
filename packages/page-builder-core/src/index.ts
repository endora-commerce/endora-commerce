export {
  DEFAULT_BREAKPOINTS,
  PAGE_BUILDER_CONTEXTS,
  PB_RESPONSIVE_METADATA,
  SETTINGS_SCOPE_LABELS,
  hasResponsiveOverride,
  hideOnDataAttrs,
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
  resolveResponsiveNumber,
  resolveRowAlignClassForTier,
  resolveTextAlignClassForTier,
  responsiveRowAlignClass,
  responsiveTextAlignClass,
} from './render/responsive-styles.js';

export { withHideOn } from './visibility/with-hide-on.js';
