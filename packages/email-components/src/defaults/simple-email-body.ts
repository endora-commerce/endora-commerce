import type { PuckDataTree } from '../schema/envelope.js';
import { DEFAULT_HEADER_BLOCK_CODE } from './default-header.js';
import { DEFAULT_FOOTER_BLOCK_CODE } from './default-footer.js';

export interface SimpleEmailBodyOptions {
  /** Optional H2 above the body copy. */
  heading?: string;
  /** Body copy; may contain Magento-style `{{var …}}` / `{{if}}` directives. */
  text: string;
  ctaLabel?: string;
  /** Button href — often a directive like `{{var verifyUrl}}`. */
  ctaHref?: string;
  headerCode?: string;
  footerCode?: string;
  /** Prefix for stable Puck prop ids. */
  idPrefix?: string;
}

/**
 * Canonical simple transactional layout:
 * header embed → spacer → optional heading → text → optional CTA → spacer → footer embed.
 */
export function simpleEmailBodyTree(opts: SimpleEmailBodyOptions): PuckDataTree {
  const prefix = opts.idPrefix ?? 'mail';
  const headerCode = opts.headerCode ?? DEFAULT_HEADER_BLOCK_CODE;
  const footerCode = opts.footerCode ?? DEFAULT_FOOTER_BLOCK_CODE;

  const content: Array<{ type: string; props: Record<string, unknown> }> = [
    { type: 'transactional_emails.EmailInsertBlock', props: { id: `${prefix}-header`, code: headerCode } },
    { type: 'transactional_emails.EmailSpacer', props: { id: `${prefix}-spacer-top`, height: 16 } },
  ];

  if (opts.heading) {
    content.push({
      type: 'transactional_emails.EmailHeading',
      props: { id: `${prefix}-heading`, level: 'h2', text: opts.heading, align: 'left' },
    });
  }

  content.push({
    type: 'transactional_emails.EmailText',
    props: { id: `${prefix}-body`, text: opts.text, align: 'left' },
  });

  if (opts.ctaLabel && opts.ctaHref) {
    content.push({
      type: 'transactional_emails.EmailButton',
      props: {
        id: `${prefix}-cta`,
        label: opts.ctaLabel,
        href: opts.ctaHref,
        align: 'left',
        backgroundColor: '#1f2937',
        textColor: '#ffffff',
      },
    });
  }

  content.push(
    { type: 'transactional_emails.EmailSpacer', props: { id: `${prefix}-spacer-bottom`, height: 16 } },
    { type: 'transactional_emails.EmailInsertBlock', props: { id: `${prefix}-footer`, code: footerCode } },
  );

  return { root: { props: {} }, content, zones: {} };
}
