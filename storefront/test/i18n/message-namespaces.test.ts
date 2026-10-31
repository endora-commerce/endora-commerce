import { describe, expect, it } from 'vitest';
import { format } from '../../lib/i18n/format';
import {
  CATALOGUE_LOCALES,
  MESSAGE_NAMESPACES,
  MESSAGES,
  tForLocale,
  type MessageKey,
} from '../../lib/i18n/messages';
import { defineMessages } from '../../lib/i18n/messages/define';

/**
 * The catalogue split by area (issue #85).
 *
 * `MESSAGES` is the namespaces merged, and a merge keeps the *last* value of a
 * key two namespaces both declare — so a duplicate would compile, and one of
 * the two areas would render the other's sentence. Nothing in the type system
 * refuses it; this file does.
 */

/** Every key declared by more than one namespace, with the namespaces declaring it. */
function duplicateKeys(
  namespaces: Readonly<Record<string, { readonly 'en-US': Readonly<Record<string, string>> }>>,
): Record<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const [name, namespace] of Object.entries(namespaces)) {
    for (const key of Object.keys(namespace['en-US'])) {
      owners.set(key, [...(owners.get(key) ?? []), name]);
    }
  }
  return Object.fromEntries([...owners].filter(([, names]) => names.length > 1));
}

describe('the catalogue namespaces', () => {
  it('declare no key twice', () => {
    expect(duplicateKeys(MESSAGE_NAMESPACES)).toEqual({});
  });

  it('the duplicate finder sees a key two namespaces share (red proof)', () => {
    const a = defineMessages({
      'en-US': { 'chrome.footer.title': 'A', 'chrome.footer.only': 'B' },
      'pl-PL': { 'chrome.footer.title': 'A', 'chrome.footer.only': 'B' },
    });
    const b = defineMessages({
      'en-US': { 'chrome.footer.title': 'C' },
      'pl-PL': { 'chrome.footer.title': 'C' },
    });
    expect(duplicateKeys({ a, b })).toEqual({ 'chrome.footer.title': ['a', 'b'] });
  });

  it('every namespace carries the same keys in en-US and pl-PL', () => {
    const mismatched = Object.entries(MESSAGE_NAMESPACES)
      .filter(
        ([, ns]) =>
          JSON.stringify(Object.keys(ns['en-US']).sort()) !==
          JSON.stringify(Object.keys(ns['pl-PL']).sort()),
      )
      .map(([name]) => name);
    expect(mismatched).toEqual([]);
  });

  it('MESSAGES is every namespace merged, in both locales', () => {
    const total = Object.values(MESSAGE_NAMESPACES).reduce(
      (n, ns) => n + Object.keys(ns['en-US']).length,
      0,
    );
    expect(CATALOGUE_LOCALES).toEqual(['en-US', 'pl-PL']);
    expect(Object.keys(MESSAGES['en-US']!)).toHaveLength(total);
    expect(Object.keys(MESSAGES['pl-PL']!)).toHaveLength(total);
    const key: MessageKey = 'nav.cart';
    expect(tForLocale('en-US')(key)).toBe('Cart');
    expect(tForLocale('pl-PL')(key)).toBe('Koszyk');
  });

  it('defineMessages refuses a Polish block that differs from the English one (compile time)', () => {
    defineMessages({
      'en-US': { 'auth.login.heading': 'Sign in' },
      // @ts-expect-error — a key the English block declares is missing.
      'pl-PL': {},
    });
    defineMessages({
      'en-US': { 'auth.login.heading': 'Sign in' },
      'pl-PL': {
        'auth.login.heading': 'Zaloguj się',
        // @ts-expect-error — a key the English block does not declare.
        'auth.login.extra': 'Nadmiar',
      },
    });
    expect(true).toBe(true);
  });
});

describe('format', () => {
  it('fills every placeholder', () => {
    expect(format('{count} of {total}', { count: '2', total: '5' })).toBe('2 of 5');
  });

  it('inserts a value verbatim — a placeholder or a replacement pattern inside it is not read', () => {
    expect(format('Added {line}', { line: 'Bolt {line} $& $1' })).toBe('Added Bolt {line} $& $1');
  });

  it('leaves a placeholder with no value as written', () => {
    expect(format('{a} and {b}', { a: 'x' })).toBe('x and {b}');
    expect(format('{toString}', {})).toBe('{toString}');
  });
});
