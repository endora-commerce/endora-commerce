import type { JSONContent } from '@tiptap/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonTarget = '_self' | '_blank';
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface RowProps {
  gap: number;
  align: 'stretch' | 'start' | 'center' | 'end';
  background: string;
  padding: number;
}

export interface ColumnsProps {
  columns: number;
  widths: string;
  gap: number;
}

export interface HeadingProps {
  level: HeadingLevel;
  text: string;
  align: 'left' | 'center' | 'right';
}

export interface TextProps {
  tiptapContent: JSONContent | null;
  html: string;
}

export interface RichContentProps {
  content: JSONContent | null;
  html: string;
}

export interface ButtonProps {
  label: string;
  href: string;
  target: ButtonTarget;
  variant: ButtonVariant;
}

export interface InsertBlockProps {
  code: string;
}

export interface InsertTemplateProps {
  code: string;
}
