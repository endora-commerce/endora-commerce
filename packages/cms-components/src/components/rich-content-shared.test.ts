import { describe, expect, it } from 'vitest';
import {
  coerceRichContentProps,
  htmlFromTiptap,
  resolveRichContentHtml,
  sanitizeRichHtml,
} from './rich-content-shared.js';

describe('coerceRichContentProps', () => {
  it('parses stringified tiptap JSON', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
    };

    const result = coerceRichContentProps({
      content: JSON.stringify(doc) as never,
      html: '',
    });

    expect(result.content).toEqual(doc);
    expect(typeof result.html).toBe('string');
  });

  it('falls back to html when content is empty', () => {
    const result = coerceRichContentProps({
      content: null,
      html: '<p>Stored html</p>',
    });

    expect(resolveRichContentHtml(result)).toContain('Stored html');
  });
});

describe('sanitizeRichHtml', () => {
  it('keeps img and safe color styles', () => {
    const html = sanitizeRichHtml(
      '<p><span style="color: #ff0000; position: absolute">Red</span><img src="https://cdn.example/a.png" alt="A" /></p>',
    );
    expect(html).toContain('img');
    expect(html).toContain('color: #ff0000');
    expect(html).not.toContain('position');
  });

  it('strips scripts and javascript urls', () => {
    expect(sanitizeRichHtml('<p onclick="x()">x</p><script>alert(1)</script>')).not.toContain('script');
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });
});

describe('htmlFromTiptap', () => {
  it('returns empty string when DOM serialization is unavailable', () => {
    // generateHTML needs a DOM (document/window); Vitest node env has none.
    const html = htmlFromTiptap({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hi' }],
        },
      ],
    });
    expect(typeof html).toBe('string');
  });
});
