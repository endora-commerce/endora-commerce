/**
 * The one sentence-case rule (issues #746 and #776) that `endora new module`
 * and the backend drift test both read.
 */
import { describe, expect, it } from 'vitest';

import {
  judgeSentenceCase,
  SENTENCE_CASE_PROPER_NOUNS,
  toSentenceCase,
} from '../src/lib/sentence-case.js';

describe('judgeSentenceCase', () => {
  it('flags a capitalised word after the first, and a lowercase first word', () => {
    expect(judgeSentenceCase('Quote Requests').offending).toEqual(['Requests']);
    expect(judgeSentenceCase('quote requests').offending).toEqual(['quote']);
    expect(judgeSentenceCase('Cancel this Quote Request?').offending).toEqual(['Quote', 'Request?']);
  });

  it('passes sentence case, acronyms and allowlisted product names', () => {
    expect(judgeSentenceCase('Quote requests').offending).toEqual([]);
    expect(judgeSentenceCase('CMS pages').offending).toEqual([]);
    expect(judgeSentenceCase('Import / export').offending).toEqual([]);
    const verdict = judgeSentenceCase('Send events to Google Tag Manager');
    expect(verdict.offending).toEqual([]);
    expect(verdict.nouns).toEqual(['Google Tag Manager']);
  });

  it('matches an allowlisted noun as a whole word only', () => {
    expect(judgeSentenceCase('New Meta custom event').offending).toEqual([]);
    expect(judgeSentenceCase('Product Metadata').offending).toEqual(['Metadata']);
  });

  it('judges a word behind leading punctuation', () => {
    expect(judgeSentenceCase('Tenant scoping (Multi-tenant isolation)').offending).toEqual([
      'Multi-tenant',
    ]);
  });

  it('does not judge a placeholder, a new sentence or the title after a dash', () => {
    expect(judgeSentenceCase('{author} mentioned you in project {number}').offending).toEqual([]);
    expect(judgeSentenceCase('Copy it now. Share it with the receiver.').offending).toEqual([]);
    expect(judgeSentenceCase('Newsletter — Email blocks').offending).toEqual([]);
  });
});

describe('toSentenceCase', () => {
  it('raises the first letter and lowers every offending word, keeping product names', () => {
    expect(toSentenceCase('Quote Requests')).toBe('Quote requests');
    expect(toSentenceCase('demo widgets')).toBe('Demo widgets');
    expect(toSentenceCase('Meta Ads Bridge')).toBe('Meta Ads bridge');
    expect(toSentenceCase('{type} Settings')).toBe('{type} settings');
  });

  it('agrees with the judge: its output passes', () => {
    for (const text of ['Quote Requests', 'Admin UI Languages', 'Per-Channel + Per-Language Overrides']) {
      expect(judgeSentenceCase(toSentenceCase(text)).offending).toEqual([]);
    }
  });
});

describe('the allowlist', () => {
  it('holds no duplicate, and every entry is capitalised', () => {
    expect(new Set(SENTENCE_CASE_PROPER_NOUNS).size).toBe(SENTENCE_CASE_PROPER_NOUNS.length);
    for (const noun of SENTENCE_CASE_PROPER_NOUNS) expect(noun).toMatch(/^\p{Lu}/u);
  });
});
