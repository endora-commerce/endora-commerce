import { DEFAULT_FOOTER_BLOCK_CODE, defaultFooterTree } from '@endora-commerce/email-components/defaults/default-footer';
import { DEFAULT_HEADER_BLOCK_CODE, defaultHeaderTree } from '@endora-commerce/email-components/defaults/default-header';
import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';
import { describe, expect, it } from 'vitest';

import { renderTransactionalEmail } from './render-transactional-email.js';

/**
 * Issue #520 — every module's transactional default embeds the shared
 * `default_email_footer` block, either through `simpleEmailBodyTree` or with
 * its own `EmailInsertBlock`. A transactional send has no `unsubscribeUrl`, so
 * the footer's Unsubscribe link must not ship — not as an empty `href` in the
 * HTML part, and not as raw HTML in the text part.
 */
const embeds = {
  blocks: { [DEFAULT_HEADER_BLOCK_CODE]: defaultHeaderTree(), [DEFAULT_FOOTER_BLOCK_CODE]: defaultFooterTree() },
  templates: {},
};

const base = {
  subject: 'Your tasks for today',
  embeds,
  branding: { logoUrl: 'https://shop.example/logo.png', accentColor: '#123456' },
  variables: { name: 'Ada' },
  language: 'en-US',
};

const layouts = {
  // tasks_daily_digest, invoices, returns, payments, … — the canonical layout.
  'simpleEmailBodyTree': simpleEmailBodyTree({ text: 'Hello {{var name}}', idPrefix: 'digest' }),
  // order confirmation — its own tree, with an explicit footer insert.
  'an explicit EmailInsertBlock': {
    root: { props: {} },
    content: [
      { type: 'transactional_emails.EmailText', props: { id: 't', text: 'Hello {{var name}}' } },
      { type: 'transactional_emails.EmailInsertBlock', props: { id: 'f', code: DEFAULT_FOOTER_BLOCK_CODE } },
    ],
    zones: {},
  },
};

describe('the default footer in a transactional e-mail (#520)', () => {
  for (const [label, content] of Object.entries(layouts)) {
    it(`renders no Unsubscribe link and no raw HTML in text, laid out by ${label}`, () => {
      const out = renderTransactionalEmail({ ...base, content });
      expect(out.html).toContain('You are receiving this email because of activity related to your account.');
      expect(out.html).not.toContain('Unsubscribe');
      expect(out.html).not.toMatch(/href\s*=\s*["']\s*["']/);
      expect(out.text).toContain('Hello Ada');
      expect(out.text).toContain('You are receiving this email because of activity related to your account.');
      expect(out.text).not.toContain('Unsubscribe');
      expect(out.text).not.toMatch(/<[a-z/]/i);
    });
  }
});
