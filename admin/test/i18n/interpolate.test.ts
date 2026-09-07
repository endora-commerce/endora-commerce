import { describe, expect, it } from 'vitest';
import { interpolate } from '../../../packages/admin-shell/src/i18n/interpolate';

/**
 * Interpolator unit tests — the regex is a one-liner but its
 * substitution semantics are user-visible.
 */
describe('interpolate', () => {
  it('returns the template untouched when no params are supplied', () => {
    expect(interpolate('hello world')).toBe('hello world');
  });

  it('substitutes a single placeholder', () => {
    expect(interpolate('hello {name}', { name: 'Alice' })).toBe('hello Alice');
  });

  it('substitutes multiple placeholders', () => {
    expect(
      interpolate('{greet}, {name}! You have {n} unread.', {
        greet: 'Hi',
        name: 'Bob',
        n: 5,
      }),
    ).toBe('Hi, Bob! You have 5 unread.');
  });

  it('coerces numeric params to strings', () => {
    expect(interpolate('count={n}', { n: 42 })).toBe('count=42');
  });

  it('leaves placeholder untouched when its name is missing from params', () => {
    expect(interpolate('hello {name}', {})).toBe('hello {name}');
  });

  it('substitutes only matches against the literal regex {\\w+}', () => {
    // Text without word-character braces is left untouched.
    expect(interpolate('plain {  spaces } left alone', { 'spaces': 'X' })).toBe(
      'plain {  spaces } left alone',
    );
  });
});
