import { describe, expect, it } from 'vitest';
import { renderDirectives } from '../directives/directive-engine.js';
import { DEFAULT_FOOTER_BLOCK_CODE, defaultFooterTree } from '../defaults/default-footer.js';
import { simpleEmailBodyTree } from '../defaults/simple-email-body.js';
import type { PuckDataTree } from '../schema/envelope.js';
import { renderEmailHtml } from './render-email-html.js';
import { renderEmailText } from './render-email-text.js';

/**
 * Issue #520 — a transactional e-mail has no unsubscribe URL, so the shared
 * footer's `<a href="{{var unsubscribeUrl}}">Unsubscribe</a>` shipped as an
 * empty `href`, and the plain-text part carried the anchor as raw HTML. The
 * anchor is dropped while the variable is empty or unset; the text part holds
 * no tag, its anchors written as "label: url". Newsletter, which always injects
 * the URL, keeps the link.
 */
const tree = (content: unknown[]): PuckDataTree => ({ root: { props: {} }, content, zones: {} });
const footerLegal = (text: string): PuckDataTree =>
  tree([{ type: 'transactional_emails.EmailFooterLegal', props: { text, align: 'center' } }]);

const UNSUB = 'https://shop.example/newsletter/unsubscribe?token=abc&x=1';

function html(t: PuckDataTree, ctx: Record<string, unknown>, embeds?: Record<string, PuckDataTree>): string {
  return renderDirectives(
    renderEmailHtml(t, { document: false, embeds: { blocks: embeds ?? {}, templates: {} } }),
    ctx,
    { escape: true },
  );
}

function text(t: PuckDataTree, ctx: Record<string, unknown>, embeds?: Record<string, PuckDataTree>): string {
  return renderDirectives(renderEmailText(t, { embeds: { blocks: embeds ?? {}, templates: {} } }), ctx);
}

/** A transactional message laid out the way the module defaults are. */
const transactional = simpleEmailBodyTree({ text: 'Your daily digest', idPrefix: 'digest' });
const footerEmbeds = { [DEFAULT_FOOTER_BLOCK_CODE]: defaultFooterTree() };

describe('footer legal unsubscribe link (#520)', () => {
  for (const [label, ctx] of [
    ['unset', {}],
    ['empty', { unsubscribeUrl: '' }],
    ['blank', { unsubscribeUrl: '   ' }],
  ] as const) {
    it(`drops the link from the HTML part when the URL is ${label}`, () => {
      const out = html(transactional, ctx, footerEmbeds);
      expect(out).toContain('You are receiving this email because of activity related to your account.');
      expect(out).not.toContain('Unsubscribe');
      expect(out).not.toMatch(/href\s*=\s*["']\s*["']/);
    });

    it(`drops the link from the text part when the URL is ${label}`, () => {
      const out = text(transactional, ctx, footerEmbeds);
      expect(out).toContain('You are receiving this email because of activity related to your account.');
      expect(out).not.toContain('Unsubscribe');
      expect(out).not.toContain('<');
      expect(out).not.toContain('>');
    });
  }

  it('keeps the link when the URL is set, as newsletter sets it', () => {
    const outHtml = html(transactional, { unsubscribeUrl: UNSUB }, footerEmbeds);
    expect(outHtml).toContain('href="https://shop.example/newsletter/unsubscribe?token=abc&amp;x=1"');
    expect(outHtml).toContain('>Unsubscribe</a>');
    const outText = text(transactional, { unsubscribeUrl: UNSUB }, footerEmbeds);
    expect(outText).toContain(`Unsubscribe: ${UNSUB}`);
    expect(outText).not.toContain('<');
  });

  it('drops an operator-written "Unsubscribe: {{var unsubscribeUrl}}" line too', () => {
    const t = footerLegal('Legal line.\nUnsubscribe: {{var unsubscribeUrl}}');
    expect(html(t, {})).not.toContain('Unsubscribe');
    expect(text(t, {})).toBe('Legal line.');
    expect(text(t, { unsubscribeUrl: UNSUB })).toBe(`Legal line.\nUnsubscribe: ${UNSUB}`);
  });

  it('writes every other anchor in the text part as "label: url" and strips the remaining tags', () => {
    const t = footerLegal(
      'Read our <a href="https://shop.example/privacy">privacy policy</a>.\n<strong>Acme</strong> Ltd',
    );
    const out = text(t, {});
    expect(out).toBe('Read our privacy policy: https://shop.example/privacy.\nAcme Ltd');
    // The HTML part keeps a link that has a destination.
    expect(html(t, {})).toContain('href="https://shop.example/privacy"');
  });
});

describe('defaultFooterTree', () => {
  it('still carries the unsubscribe anchor newsletter footers are seeded from', () => {
    // Newsletter's init migration calls defaultFooterTree() at run time; the
    // transactional fix lives in the renderer, never in this tree.
    const legal = defaultFooterTree().content.find(
      (n) => (n as { type: string }).type === 'transactional_emails.EmailFooterLegal',
    ) as { props: { text: string } };
    expect(legal.props.text).toContain('<a href="{{var unsubscribeUrl}}">Unsubscribe</a>');
  });
});
