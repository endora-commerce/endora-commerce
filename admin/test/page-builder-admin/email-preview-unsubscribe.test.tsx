import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOOTER_BLOCK_CODE,
  defaultFooterTree,
  simpleEmailBodyTree,
} from '@endora-commerce/email-components';
import { passthroughBundle, renderWithI18n } from '../helpers/render-with-i18n';

/**
 * Issue #862 — since #861 a transactional e-mail is sent without the
 * Unsubscribe link, because it has no `unsubscribeUrl`. The editor preview
 * still filled in a sample URL for every template, so an operator editing a
 * transactional template saw an "Unsubscribe" link that real sends no longer
 * carry.
 *
 * The pane already knows which kind of message it is showing: newsletter
 * mounts it with `builderContext="newsletter"`, and the transactional e-mails
 * module with `"email"`. The sample URL is supplied for the newsletter context
 * only — in the HTML preview and in the canvas previews of embedded blocks
 * (`previewNode`, which transactional e-mails uses for its shared footer).
 */

const { buildPreviewHtml, previewNode } = await import(
  '../../../packages/page-builder-admin/src/email/EmailEditorPane'
);

const SAMPLE_URL = 'https://shop.example/newsletter/unsubscribe?token=preview';

/** A message laid out as the module defaults are: a body, then the shared footer block. */
const message = simpleEmailBodyTree({ text: 'Your order has shipped', idPrefix: 'shipped' });
const embedTrees = { blocks: { [DEFAULT_FOOTER_BLOCK_CODE]: defaultFooterTree() }, templates: {} };

function previewOf(builderContext: 'email' | 'newsletter'): string {
  return buildPreviewHtml(message as never, [], '', {}, embedTrees, 'en-US', {}, builderContext);
}

function canvasEmbedOf(builderContext?: 'email' | 'newsletter'): string {
  const content = { 'en-US': defaultFooterTree() };
  const { container } = renderWithI18n(
    <>{builderContext === undefined ? previewNode(content) : previewNode(content, builderContext)}</>,
    passthroughBundle('core', ['pageBuilder.emailPreview.embedTitle']),
  );
  return container.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
}

describe('the e-mail editor preview and the Unsubscribe link (issue #862)', () => {
  it('shows no Unsubscribe link in a transactional template preview', () => {
    const html = previewOf('email');
    expect(html).toContain('You are receiving this email because of activity related to your account.');
    expect(html).not.toContain('Unsubscribe');
    expect(html).not.toContain(SAMPLE_URL);
  });

  it('keeps the sample Unsubscribe link in a newsletter preview', () => {
    const html = previewOf('newsletter');
    expect(html).toContain(`href="${SAMPLE_URL}"`);
    expect(html).toContain('>Unsubscribe</a>');
  });

  it('shows no Unsubscribe link in a transactional canvas embed, which is the default', () => {
    for (const html of [canvasEmbedOf(), canvasEmbedOf('email')]) {
      expect(html).toContain('You are receiving this email because of activity related to your account.');
      expect(html).not.toContain('Unsubscribe');
    }
  });

  it('keeps the sample Unsubscribe link in a newsletter canvas embed', () => {
    const html = canvasEmbedOf('newsletter');
    expect(html).toContain(SAMPLE_URL);
    expect(html).toContain('>Unsubscribe</a>');
  });
});
