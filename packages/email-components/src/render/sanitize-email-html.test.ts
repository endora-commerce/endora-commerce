import { describe, expect, it } from 'vitest';
import { emailHtmlToPlainText, sanitizeEmailHtml } from './sanitize-email-html.js';

describe('sanitizeEmailHtml', () => {
  it('keeps whitelisted tags and strips script/style', () => {
    const out = sanitizeEmailHtml(
      '<p>Hi <strong>Ada</strong></p><script>alert(1)</script><style>p{color:red}</style>',
    );
    expect(out).toContain('<p>Hi <strong>Ada</strong></p>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<style');
    expect(out).not.toContain('alert');
  });

  it('preserves directive markers in text and href', () => {
    const out = sanitizeEmailHtml('<p>Order {{var order.id}}</p><a href="{{var product.url}}">Go</a>');
    expect(out).toContain('{{var order.id}}');
    expect(out).toContain('href="{{var product.url}}"');
  });

  it('blocks javascript: hrefs', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('<a');
  });

  it('keeps img tags with safe src and email-safe styles', () => {
    const out = sanitizeEmailHtml(
      '<p><img src="https://cdn.example/a.png" alt="Logo" width="120" onclick="evil()" /></p>',
    );
    expect(out).toContain('<img src="https://cdn.example/a.png" alt="Logo" width="120"');
    expect(out).toContain('max-width:100%');
    expect(out).not.toContain('onclick');
  });

  it('keeps host-relative asset img src (absolutized later at bake time)', () => {
    const out = sanitizeEmailHtml('<p><img src="/assets/file/abc" alt="" /></p>');
    expect(out).toContain('src="/assets/file/abc"');
  });

  it('strips img with javascript or data src', () => {
    expect(sanitizeEmailHtml('<img src="javascript:alert(1)" alt="x" />')).not.toContain('<img');
    expect(sanitizeEmailHtml('<img src="data:image/png;base64,xxx" alt="x" />')).not.toContain('<img');
  });

  it('converts sanitized HTML to plain text without losing directives', () => {
    const text = emailHtmlToPlainText(
      '<p>Hello {{var subscriber.email}}</p><p><img src="https://x/a.png" alt="Photo" /></p><p>Bye</p>',
    );
    expect(text).toContain('Hello {{var subscriber.email}}');
    expect(text).toContain('[Photo]');
    expect(text).toContain('Bye');
  });
});
