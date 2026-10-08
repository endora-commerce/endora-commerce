import { describe, expect, it } from 'vitest';
import { clipReferenceText, findMentionTrigger, MENTION_QUERY_LIMIT } from './mention-trigger.js';

/** `text` with the caret where `|` is. */
function at(marked: string): ReturnType<typeof findMentionTrigger> {
  const caret = marked.indexOf('|');
  return findMentionTrigger(marked.replace('|', ''), caret);
}

describe('findMentionTrigger (User Story 18, FR-082)', () => {
  it('opens on @ at the start of the text and after white space', () => {
    expect(at('@|')).toEqual({ kind: 'admin_user', start: 0, end: 1, query: '' });
    expect(at('Hello @|')).toEqual({ kind: 'admin_user', start: 6, end: 7, query: '' });
    expect(at('Hello\n@|')).toEqual({ kind: 'admin_user', start: 6, end: 7, query: '' });
    expect(at('Hello\t@|')).toMatchObject({ kind: 'admin_user', start: 6 });
  });

  it('a second @ asks for an Order and a third for a Product', () => {
    expect(at('see @@|')).toEqual({ kind: 'order', start: 4, end: 6, query: '' });
    expect(at('see @@@|')).toEqual({ kind: 'product', start: 4, end: 7, query: '' });
    expect(at('@@ORD-10|')).toEqual({ kind: 'order', start: 0, end: 8, query: 'ORD-10' });
    expect(at('@@@cargo van|')).toEqual({ kind: 'product', start: 0, end: 12, query: 'cargo van' });
  });

  it('what follows the @ is the search, a first name and a surname included', () => {
    expect(at('@Tom|')).toEqual({ kind: 'admin_user', start: 0, end: 4, query: 'Tom' });
    expect(at('ok @Tomasz Now| - take this over')).toEqual({
      kind: 'admin_user',
      start: 3,
      end: 14,
      query: 'Tomasz Now',
    });
    expect(at('@Żak|')).toMatchObject({ query: 'Żak' });
  });

  it('does not open for an e-mail address or any @ inside a word', () => {
    expect(at('jan@|')).toBeNull();
    expect(at('jan@firma|.pl')).toBeNull();
    expect(at('write to jan.kowalski@example.com|')).toBeNull();
    expect(at('a@@|')).toBeNull();
    expect(at('price@@@van|')).toBeNull();
  });

  it('does not open when a space follows the @s, for four of them, or across a line', () => {
    expect(at('@ |')).toBeNull();
    expect(at('@@ |')).toBeNull();
    expect(at('meet @ noon|')).toBeNull();
    expect(at('@@@@|')).toBeNull();
    expect(at('@@@@van|')).toBeNull();
    expect(at('@Tomasz\nNowak|')).toBeNull();
  });

  it('looks only at what is before the caret, and only at the run the caret is in', () => {
    expect(at('|@Tomasz')).toBeNull();
    expect(at('@Tom|asz')).toMatchObject({ query: 'Tom', end: 4 });
    // An earlier address in the same line does not stop a later mention…
    expect(at('cc jan@example.com and @An|')).toMatchObject({ kind: 'admin_user', query: 'An' });
    // …and a later @ ends an earlier run.
    expect(at('@Tomasz jan@example|')).toBeNull();
  });

  it('gives up on a search longer than a name or a number would be', () => {
    const long = 'x'.repeat(MENTION_QUERY_LIMIT);
    expect(at(`@${long}|`)).toMatchObject({ query: long });
    expect(at(`@${long}x|`)).toBeNull();
  });

  it('a stored token is not a trigger', () => {
    expect(at('[[admin_user:00000000-0000-4000-8000-0000000000a1]]|')).toBeNull();
    expect(at('[[admin_user:00000000-0000-4000-8000-0000000000a1]] ok|')).toBeNull();
  });
});

describe('clipReferenceText', () => {
  const token = '[[admin_user:00000000-0000-4000-8000-0000000000a1]]';

  it('leaves a text within the limit as it is, however long its tokens are', () => {
    const text = `Ask ${token} and ${token}.`;
    expect(clipReferenceText(text, 20)).toBe(text);
  });

  it('cuts a long text at the limit and says so, counting a token as one character', () => {
    expect(clipReferenceText('abcdefghij', 4)).toBe('abcd…');
    expect(clipReferenceText(`ab${token}cdef`, 4)).toBe(`ab${token}c…`);
  });

  it('never cuts a token in two', () => {
    const clipped = clipReferenceText(`abcd${token} and more`, 4);
    expect(clipped).toBe('abcd…');
    expect(clipReferenceText(`abc${token}${token}`, 4)).toBe(`abc${token}…`);
  });
});
