import { describe, expect, it } from 'vitest';
import {
  findUntranslatedErrorCodes,
  UNTRANSLATED_ERROR_CODES,
  type TranslationInput,
} from '../../../scripts/check-error-translations.js';

/**
 * The error-translation rule's own test (issue #113).
 *
 * The check shipped with a 78-entry ledger and no test at all, so the only
 * evidence it worked was that it printed a number nobody could reproduce. What
 * is proved here is that it goes **red**: on a code with no sentence, on a code
 * with a sentence in one language only, and on a ledger entry that has since
 * been translated. The routing table and the bundle reader are both injected,
 * so none of it depends on what the tree currently ships.
 */

/** A table of two codes, both routed to `blog`, keyed the way the envelope reads them. */
const KEYS = {
  BLOG_POST_NOT_FOUND: { moduleId: 'blog', key: 'errors.BLOG_POST_NOT_FOUND' },
  BLOG_SLUG_TAKEN: { moduleId: 'blog', key: 'errors.BLOG_SLUG_TAKEN' },
} as const;

function input(bundles: Record<string, Record<string, unknown>>): TranslationInput {
  return {
    keys: KEYS,
    readBundle: (moduleId, language) => bundles[`${moduleId}.${language}`] ?? {},
  };
}

describe('findUntranslatedErrorCodes — the shapes it has to see', () => {
  it('reports a code with no sentence in either language', () => {
    const findings = findUntranslatedErrorCodes(
      input({
        'blog.en': { 'errors.BLOG_SLUG_TAKEN': 'That slug is taken.' },
        'blog.pl': { 'errors.BLOG_SLUG_TAKEN': 'Ten adres jest zajęty.' },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'BLOG_POST_NOT_FOUND',
      moduleId: 'blog',
      missingIn: ['en', 'pl'],
    });
  });

  it('reports a code translated in one language only — both ship, or neither counts', () => {
    const findings = findUntranslatedErrorCodes(
      input({
        'blog.en': {
          'errors.BLOG_POST_NOT_FOUND': 'No such post.',
          'errors.BLOG_SLUG_TAKEN': 'That slug is taken.',
        },
        'blog.pl': { 'errors.BLOG_SLUG_TAKEN': 'Ten adres jest zajęty.' },
      }),
    );
    expect(findings.map((f) => f.missingIn)).toEqual([['pl']]);
  });

  it('does not accept a non-string under the key — a nested object renders nothing', () => {
    // A nested bundle passes `key in bundle` and fails at render time, which is
    // exactly the failure mode this check exists to make visible.
    const findings = findUntranslatedErrorCodes(
      input({
        'blog.en': { 'errors.BLOG_POST_NOT_FOUND': { message: 'No such post.' } },
        'blog.pl': { 'errors.BLOG_POST_NOT_FOUND': 'Nie ma takiego wpisu.' },
      }),
    );
    expect(findings.map((f) => `${f.code}:${f.missingIn.join(',')}`)).toContain(
      'BLOG_POST_NOT_FOUND:en',
    );
  });

  it('says nothing when both codes have both sentences', () => {
    const bundle = {
      'errors.BLOG_POST_NOT_FOUND': 'x',
      'errors.BLOG_SLUG_TAKEN': 'y',
    };
    expect(
      findUntranslatedErrorCodes(input({ 'blog.en': bundle, 'blog.pl': bundle })),
    ).toEqual([]);
  });

  it('reads the routed module, not the code prefix — an unrouted code is the ledger`s core block', () => {
    const findings = findUntranslatedErrorCodes({
      keys: { KSEF_UNAVAILABLE: { moduleId: 'core', key: 'errors.KSEF_UNAVAILABLE' } },
      readBundle: (moduleId) => (moduleId === 'ksef' ? { 'errors.KSEF_UNAVAILABLE': 'x' } : {}),
    });
    expect(findings.map((f) => f.moduleId)).toEqual(['core']);
  });
});

describe('the ledger, as a two-way ratchet', () => {
  /** The staleness half of `main`, which is the half a ledger loses first. */
  function stale(findings: readonly { code: string }[], ledger: ReadonlySet<string>): string[] {
    const found = new Set(findings.map((f) => f.code));
    return [...ledger].filter((code) => !found.has(code)).sort();
  }

  it('an unledgered untranslated code is a violation', () => {
    const findings = findUntranslatedErrorCodes(input({}));
    const ledger = new Set(['BLOG_SLUG_TAKEN']);
    expect(findings.filter((f) => !ledger.has(f.code)).map((f) => f.code)).toEqual([
      'BLOG_POST_NOT_FOUND',
    ]);
  });

  it('a ledger entry that now has a sentence is a violation too', () => {
    const bundle = { 'errors.BLOG_POST_NOT_FOUND': 'x', 'errors.BLOG_SLUG_TAKEN': 'y' };
    const findings = findUntranslatedErrorCodes(input({ 'blog.en': bundle, 'blog.pl': bundle }));
    expect(stale(findings, new Set(['BLOG_SLUG_TAKEN']))).toEqual(['BLOG_SLUG_TAKEN']);
  });

  it('names a real code in every entry — the ledger is written in code names, not prose', () => {
    for (const code of UNTRANSLATED_ERROR_CODES) {
      expect(code, `${code} is not a code name`).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });
});

describe('the tree itself', () => {
  it('has a routing table with codes in it, and no unledgered untranslated code', () => {
    const findings = findUntranslatedErrorCodes();
    // The routing table is the whole input: an empty one would report every
    // code translated. `main` exits 2 on it; here the floor is the assertion.
    expect(findings.length + UNTRANSLATED_ERROR_CODES.size).toBeGreaterThan(0);
    const unledgered = findings.filter((f) => !UNTRANSLATED_ERROR_CODES.has(f.code));
    expect(unledgered.map((f) => `${f.code} → ${f.moduleId} (${f.missingIn.join(', ')})`)).toEqual(
      [],
    );
    const found = new Set(findings.map((f) => f.code));
    expect([...UNTRANSLATED_ERROR_CODES].filter((code) => !found.has(code))).toEqual([]);
  });
});
