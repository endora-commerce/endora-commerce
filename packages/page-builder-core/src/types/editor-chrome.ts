import type { HideOn } from './responsive.js';

/** Editor-only props — not used at render time on the storefront. */
export type PageBuilderEditorProps = {
  /** Optional label shown in the Page Builder sidebar / outline. */
  editorName?: string;
  hideOn?: HideOn;
};

export const EDITOR_NAME_FIELD_KEY = 'editorName' as const;

/** @deprecated Section headers replaced by tabbed fields panel */
export const GENERAL_SECTION_FIELD_KEY = '_pbGeneralSection' as const;
/** @deprecated Section headers replaced by tabbed fields panel */
export const RESPONSIVE_SECTION_FIELD_KEY = '_pbResponsiveSection' as const;
/** @deprecated Use RESPONSIVE_SECTION_FIELD_KEY */
export const RESPONSIVE_SCOPE_FIELD_KEY = RESPONSIVE_SECTION_FIELD_KEY;
