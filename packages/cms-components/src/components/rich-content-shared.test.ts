import { describe, expect, it } from 'vitest';
import { coerceRichContentProps, resolveRichContentHtml } from './rich-content-shared.js';

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
