import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize-html.js';

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>', true)).not.toContain('script');
  });

  it('allows basic tags when DOMParser is available', () => {
    if (typeof DOMParser === 'undefined') return;
    expect(sanitizeHtml('<p class="x">Hello <strong>world</strong></p>', true)).toContain('<strong>');
    expect(sanitizeHtml('<p class="x">Hello</p>', true)).not.toContain('class=');
  });
});
