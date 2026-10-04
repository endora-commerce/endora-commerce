/**
 * The e-mail layer — pure functions, no React and no I/O. The backend send path
 * runs them, and so does the admin's canvas and HTML preview, so what an
 * operator previews is what is sent.
 */
import type { EmailBlockRenderers } from '@endora-commerce/email-components/render/block-renderers';
import { escapeHtml } from '@endora-commerce/email-components/render/escape-html';

interface BadgeProps {
  readonly text?: string;
  readonly explode?: string | boolean;
}

function assertRenderable(props: BadgeProps): void {
  if (props.explode === true || props.explode === 'yes') {
    throw new Error('acceptance_blocks.Badge was asked to fail on render');
  }
}

export const emailBlocks: EmailBlockRenderers = {
  'acceptance_blocks.Badge': {
    defaultProps: { text: 'New badge' },
    html: (props: BadgeProps, ctx) => {
      assertRenderable(props);
      return (
        '<tr><td style="padding:8px 24px;font-family:Arial,Helvetica,sans-serif;">' +
        `<span style="display:inline-block;padding:4px 10px;border-radius:6px;background-color:${ctx.accentColor};color:#ffffff;font-size:14px;font-weight:bold;">` +
        `acceptance-badge:${escapeHtml(String(props.text ?? ''))}` +
        '</span></td></tr>'
      );
    },
    text: (props: BadgeProps) => {
      assertRenderable(props);
      return `acceptance-badge:${String(props.text ?? '')}\n`;
    },
  },
};
