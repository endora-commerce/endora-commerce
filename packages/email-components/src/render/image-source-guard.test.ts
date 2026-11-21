import { describe, expect, it } from 'vitest';
import { renderDirectives } from '../directives/directive-engine.js';
import type { PuckDataTree } from '../schema/envelope.js';
import { renderEmailHtml } from './render-email-html.js';

const tree = (type: 'EmailLogo' | 'EmailImage', src: string): PuckDataTree => ({
  root: { props: {} },
  content: [
    { type: 'transactional_emails.EmailText', props: { text: 'Body' } },
    {
      type: `transactional_emails.${type}`,
      props: { src, alt: 'Brand', width: 160, align: 'center' },
    },
  ],
  zones: {},
});

const html = (type: 'EmailLogo' | 'EmailImage', src: string, ctx: Record<string, unknown>) =>
  renderDirectives(renderEmailHtml(tree(type, src), { document: false }), ctx, { escape: true });

describe.each(['EmailLogo', 'EmailImage'] as const)('%s with a variable-backed source (#1587)', (type) => {
  it.each([
    ['empty', { branding: { logoUrl: '' } }],
    ['missing', {}],
  ])('omits the entire image row when the source variable is %s', (_label, ctx) => {
    const rendered = html(type, '{{var branding.logoUrl}}', ctx);
    expect(rendered).toContain('Body');
    expect(rendered).not.toContain('<img');
    expect(rendered).not.toContain('<td align="center"');
    expect(rendered).not.toContain('src=""');
  });

  it('renders the resolved URL with the existing image attributes', () => {
    const rendered = html(type, '{{var branding.logoUrl}}', {
      branding: { logoUrl: 'https://shop.example/logo.png?size=2&theme=dark' },
    });
    expect(rendered).toContain('Body');
    expect(rendered).toContain('<td align="center"');
    expect(rendered).toContain('src="https://shop.example/logo.png?size=2&amp;theme=dark"');
    expect(rendered).toContain('alt="Brand" width="160"');
    expect(rendered).toContain('margin:0 auto');
    expect(rendered).not.toContain('{{');
  });

  it('keeps a static URL even when branding has no logo', () => {
    const rendered = html(type, 'https://shop.example/static-logo.png', {});
    expect(rendered).toContain('Body');
    expect(rendered).toContain('<td align="center"');
    expect(rendered).toContain('src="https://shop.example/static-logo.png"');
    expect(rendered).toContain('alt="Brand" width="160"');
  });
});
