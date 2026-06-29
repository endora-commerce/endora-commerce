// Email-safe component prop shapes (feature 047). Kept React-free so the pure
// backend renderer and the admin Puck editor share one source of truth for the
// component palette. Every component here renders to table-based, inline-styled
// HTML that survives the broadest set of email clients (no flexbox/grid/script).

export type EmailHeadingLevel = 'h1' | 'h2' | 'h3';
export type EmailAlign = 'left' | 'center' | 'right';

export interface EmailHeadingProps {
  level: EmailHeadingLevel;
  text: string;
  align: EmailAlign;
}

export interface EmailTextProps {
  /** Plain text; newlines become <br>. May contain {{var ...}} directives. */
  text: string;
  align: EmailAlign;
}

export interface EmailButtonProps {
  label: string;
  href: string;
  align: EmailAlign;
  backgroundColor: string;
  textColor: string;
}

export interface EmailImageProps {
  src: string;
  alt: string;
  href: string;
  width: number;
  align: EmailAlign;
}

export type EmailDividerProps = Record<string, never>;

export interface EmailSpacerProps {
  height: number;
}

export interface EmailColumnsCell {
  text: string;
}

export interface EmailColumnsProps {
  columns: EmailColumnsCell[];
}

export interface EmailInsertBlockProps {
  code: string;
}

export interface EmailInsertTemplateProps {
  code: string;
}

/**
 * Canonical set of component names the email editor exposes and the renderer
 * understands. Used by the admin palette and by backend save-time validation
 * to reject any non-email-safe component (FR-008/021).
 */
export const EMAIL_SAFE_COMPONENT_NAMES = [
  'EmailHeading',
  'EmailText',
  'EmailButton',
  'EmailImage',
  'EmailDivider',
  'EmailSpacer',
  'EmailColumns',
  'EmailInsertBlock',
  'EmailInsertTemplate',
] as const;

export type EmailComponentName = (typeof EMAIL_SAFE_COMPONENT_NAMES)[number];

export function isEmailSafeComponentName(name: string): name is EmailComponentName {
  return (EMAIL_SAFE_COMPONENT_NAMES as readonly string[]).includes(name);
}
