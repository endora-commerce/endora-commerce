import { describe, expect, it } from 'vitest';
import { insertAtCursor, varSnippet } from '@endora-commerce/page-builder-admin/email';

describe('insertAtCursor', () => {
  it('inserts at caret', () => {
    expect(insertAtCursor('Hello world', ' X', 5)).toEqual({
      value: 'Hello X world',
      selectionStart: 7,
      selectionEnd: 7,
    });
  });

  it('replaces selection', () => {
    expect(insertAtCursor('aa bb cc', 'YY', 3, 5)).toEqual({
      value: 'aa YY cc',
      selectionStart: 5,
      selectionEnd: 5,
    });
  });
});

describe('varSnippet', () => {
  it('wraps a key', () => {
    expect(varSnippet('order.id')).toBe('{{var order.id}}');
  });
});
