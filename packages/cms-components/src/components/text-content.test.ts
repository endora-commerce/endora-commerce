import { describe, expect, it } from 'vitest';
import { extractPlainTextFromTiptap, resolveTextContent, stripHtmlToPlainText } from './text-content.js';

describe('resolveTextContent', () => {
  it('prefers the new text field', () => {
    expect(
      resolveTextContent({
        text: 'Hello',
        html: 'ignored',
        tiptapContent: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nope' }] }] },
      }),
    ).toBe('Hello');
  });

  it('falls back to tiptapContent when text is missing', () => {
    expect(
      resolveTextContent({
        tiptapContent: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Test' }],
            },
          ],
        },
      }),
    ).toBe('Test');
  });

  it('falls back to html when text and tiptap are missing', () => {
    expect(resolveTextContent({ html: '<p>Line one</p><p>Line two</p>' })).toBe('Line one\nLine two');
  });

  it('returns empty string when nothing is available', () => {
    expect(resolveTextContent({})).toBe('');
  });

  it('coerces non-string text values from the editor', () => {
    expect(resolveTextContent({ text: 42 })).toBe('42');
    expect(resolveTextContent({ text: null })).toBe('');
  });
});

describe('stripHtmlToPlainText', () => {
  it('keeps plain strings', () => {
    expect(stripHtmlToPlainText('dwadaw')).toBe('dwadaw');
  });
});

describe('extractPlainTextFromTiptap', () => {
  it('joins multiple paragraphs with newlines', () => {
    expect(
      extractPlainTextFromTiptap({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
        ],
      }),
    ).toBe('A\nB');
  });
});
