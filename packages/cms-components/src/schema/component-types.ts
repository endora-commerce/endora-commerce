import type { Slot } from '@measured/puck';
import type {
  BorderValue,
  CornerRadius,
  HideOn,
  ResponsiveProp,
  Shadow,
  SpacingValue,
} from '@b2b/page-builder-core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonTarget = '_self' | '_blank';
export type ButtonLinkType = 'url' | 'product' | 'category' | 'page';
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface HideOnProps {
  editorName?: string;
  hideOn?: HideOn;
}

export interface BoxStyleProps {
  margin?: SpacingValue | ResponsiveProp<SpacingValue>;
  padding?: SpacingValue | ResponsiveProp<SpacingValue>;
  border?: BorderValue | ResponsiveProp<BorderValue>;
}

export interface AppearanceProps {
  background?: string;
  cornerRadius?: CornerRadius;
  shadow?: Shadow;
}

export interface ColumnProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  span: number | ResponsiveProp<number>;
  content: Slot;
}

export interface RowColumnItem {
  span: number | ResponsiveProp<number>;
  content: Slot;
}

export interface RowProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  content: Slot;
  /** @deprecated migrated to Column components in content slot */
  columnItems?: RowColumnItem[];
  sectionLayout: RowSectionLayout | ResponsiveProp<RowSectionLayout>;
  contentMaxWidth: RowContentMaxWidth | ResponsiveProp<RowContentMaxWidth>;
  customMaxWidthPx?: number | ResponsiveProp<number>;
  /** @deprecated use sectionLayout */
  fullBleed?: boolean;
  /** @deprecated use contentMaxWidth */
  contentWidth?: 'full' | 'narrow' | 'wide' | ResponsiveProp<'full' | 'narrow' | 'wide'>;
  contentPosition: 'top' | 'middle' | 'bottom' | ResponsiveProp<'top' | 'middle' | 'bottom'>;
  minHeight: number | ResponsiveProp<number>;
  gap: number | ResponsiveProp<number>;
  rowGap?: number | ResponsiveProp<number>;
  verticalAlign?: 'top' | 'middle' | 'bottom' | 'stretch' | ResponsiveProp<'top' | 'middle' | 'bottom' | 'stretch'>;
  columnDivider?: boolean;
  reverseOnMobile?: boolean;
  overflow: boolean;
}

export type RowSectionLayout = 'in_flow' | 'full_width' | 'full_bleed';
export type RowContentMaxWidth = 'none' | 'narrow' | 'wide' | 'custom';

export type TextFontFamily = 'sans' | 'serif' | 'mono';
export type TextFontStyle = 'normal' | 'italic';

export interface TypographyProps {
  fontFamily?: TextFontFamily;
  fontStyle?: TextFontStyle;
  color?: string;
  fontSize?: number | ResponsiveProp<number>;
  fontWeight?: number | ResponsiveProp<number>;
  textAlign?: 'left' | 'center' | 'right' | ResponsiveProp<'left' | 'center' | 'right'>;
  lineHeight?: number | ResponsiveProp<number>;
}

export interface HeadingProps extends HideOnProps, BoxStyleProps, TypographyProps {
  level: HeadingLevel;
  text: string;
  /** @deprecated use textAlign */
  align?: 'left' | 'center' | 'right' | ResponsiveProp<'left' | 'center' | 'right'>;
}

export interface TextProps extends HideOnProps, BoxStyleProps, TypographyProps {
  text?: string;
  /** Legacy rows saved before Simple Text — read-only fallback at render time. */
  tiptapContent?: { type?: string; content?: unknown[] } | null;
  /** Legacy rows saved before Simple Text — read-only fallback at render time. */
  html?: string;
}

export type ImageObjectFit = 'cover' | 'contain' | 'fill' | 'none';
export type ImageWidthMode = 'auto' | 'full' | 'custom';
export type ImageAlign = 'left' | 'center' | 'right';

export interface ImageProps extends HideOnProps, BoxStyleProps {
  src: string;
  alt: string;
  href: string;
  linkTarget: '_self' | '_blank';
  objectFit: ImageObjectFit;
  opacity: number;
  cornerRadius?: CornerRadius;
  widthMode: ImageWidthMode | ResponsiveProp<ImageWidthMode>;
  widthPx: number | ResponsiveProp<number>;
  align: ImageAlign | ResponsiveProp<ImageAlign>;
}

export interface RichContentProps extends HideOnProps, BoxStyleProps {
  content: import('@tiptap/core').JSONContent | null;
  html: string;
}

export interface ButtonProps extends HideOnProps, BoxStyleProps {
  label: string;
  linkType: ButtonLinkType;
  linkSlug?: string;
  href: string;
  target: ButtonTarget;
  variant: ButtonVariant | ResponsiveProp<ButtonVariant>;
  backgroundColor?: string;
  textColor?: string;
}

export interface InsertBlockProps extends HideOnProps {
  code: string;
}

export interface InsertTemplateProps extends HideOnProps {
  code: string;
}
