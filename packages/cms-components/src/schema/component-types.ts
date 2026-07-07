import type { JSONContent } from '@tiptap/core';
import type { Slot } from '@measured/puck';
import type { HideOn, ResponsiveProp } from '@b2b/page-builder-core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonTarget = '_self' | '_blank';
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface HideOnProps {
  editorName?: string;
  hideOn?: HideOn;
}

export interface RowProps extends HideOnProps {
  content: Slot;
  gap: number | ResponsiveProp<number>;
  align: 'stretch' | 'start' | 'center' | 'end' | ResponsiveProp<'stretch' | 'start' | 'center' | 'end'>;
  background: string;
  padding: number | ResponsiveProp<number>;
}

export interface ColumnItemProps {
  content: Slot;
}

export interface ColumnsProps extends HideOnProps {
  columns: number;
  widths: string;
  gap: number | ResponsiveProp<number>;
  columnItems: ColumnItemProps[];
}

export interface HeadingProps extends HideOnProps {
  level: HeadingLevel;
  text: string;
  align: 'left' | 'center' | 'right' | ResponsiveProp<'left' | 'center' | 'right'>;
}

export interface TextProps extends HideOnProps {
  tiptapContent: JSONContent | null;
  html: string;
}

export interface RichContentProps extends HideOnProps {
  content: JSONContent | null;
  html: string;
}

export interface ButtonProps extends HideOnProps {
  label: string;
  href: string;
  target: ButtonTarget;
  variant: ButtonVariant | ResponsiveProp<ButtonVariant>;
}

export interface InsertBlockProps extends HideOnProps {
  code: string;
}

export interface InsertTemplateProps extends HideOnProps {
  code: string;
}
