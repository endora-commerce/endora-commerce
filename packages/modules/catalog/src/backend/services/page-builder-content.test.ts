import { describe, expect, it } from 'vitest';

import {
  hasPageBuilderBlocks,
  normalisePageBuilderEnvelope,
  pageBuilderEnvelopeBytes,
  resolvePageBuilderLanguage,
  summarisePageBuilderDocument,
} from './page-builder-content.js';

/**
 * Feature 172 — the pure Page Builder helpers shared by category and product
 * content (research R-2, R-3, R-12; FR-013, FR-033).
 */

const block = (props: Record<string, unknown> = {}) => ({ type: 'Text', props: { id: 'b', ...props } });
const doc = (...blocks: unknown[]) => ({ root: { props: {} }, content: blocks });
const EMPTY = doc();

describe('hasPageBuilderBlocks', () => {
  it('sees a top-level block', () => {
    expect(hasPageBuilderBlocks(doc(block()))).toBe(true);
  });

  it('sees a block in a legacy zone bucket', () => {
    expect(hasPageBuilderBlocks({ content: [], zones: { 'a:b': [block()] } })).toBe(true);
  });

  it('answers false for a document saved untouched', () => {
    expect(hasPageBuilderBlocks(EMPTY)).toBe(false);
    expect(hasPageBuilderBlocks({ zones: { 'a:b': [] } })).toBe(false);
    expect(hasPageBuilderBlocks({})).toBe(false);
  });

  it('stays importable from its former home', async () => {
    const legacy = await import('./catalog-query.service.js');
    expect(legacy.hasPageBuilderBlocks).toBe(hasPageBuilderBlocks);
  });
});

describe('normalisePageBuilderEnvelope (FR-013, research R-2)', () => {
  it('drops a language with no block and keeps the rest', () => {
    expect(
      normalisePageBuilderEnvelope({ languages: { 'en-US': doc(block()), 'pl-PL': EMPTY } }),
    ).toEqual({ languages: { 'en-US': doc(block()) } });
  });

  it('answers null when no language holds a block', () => {
    expect(normalisePageBuilderEnvelope({ languages: { 'en-US': EMPTY, 'pl-PL': {} } })).toBeNull();
    expect(normalisePageBuilderEnvelope({ languages: {} })).toBeNull();
  });

  it('answers null for null', () => {
    expect(normalisePageBuilderEnvelope(null)).toBeNull();
  });
});

describe('summarisePageBuilderDocument (research R-3)', () => {
  it('counts top-level blocks and takes the first text-bearing prop', () => {
    expect(
      summarisePageBuilderDocument(doc(block({ src: 'x.png' }), block({ title: 'Choosing a drill' }), block({ text: 'later' }))),
    ).toEqual({ blocks: 3, excerpt: 'Choosing a drill' });
  });

  it('prefers text over title, heading, body and html within one block', () => {
    expect(
      summarisePageBuilderDocument(doc(block({ html: '<p>h</p>', body: 'b', heading: 'he', title: 't', text: 'te' }))),
    ).toEqual({ blocks: 1, excerpt: 'te' });
    expect(summarisePageBuilderDocument(doc(block({ html: '<p>h</p>', body: 'b' })))?.excerpt).toBe('b');
  });

  it('strips tags and folds whitespace', () => {
    expect(
      summarisePageBuilderDocument(doc(block({ html: '<h2>Buying\n guide</h2>\n\n<p>  for   <b>drills</b></p>' }))),
    ).toEqual({ blocks: 1, excerpt: 'Buying guide for drills' });
  });

  it('cuts the excerpt at 120 characters', () => {
    const excerpt = summarisePageBuilderDocument(doc(block({ text: 'a'.repeat(300) })))?.excerpt;
    expect(excerpt).toHaveLength(120);
  });

  it('answers a null excerpt when no block carries text', () => {
    expect(summarisePageBuilderDocument(doc(block({ src: 'x.png' }), block({ text: '   ' })))).toEqual({
      blocks: 2,
      excerpt: null,
    });
  });

  it('ignores a non-string text prop', () => {
    expect(summarisePageBuilderDocument(doc(block({ text: 42 }), block({ body: 'ok' })))?.excerpt).toBe('ok');
  });

  it('counts zero blocks for an empty document', () => {
    expect(summarisePageBuilderDocument(EMPTY)).toEqual({ blocks: 0, excerpt: null });
    expect(summarisePageBuilderDocument({})).toEqual({ blocks: 0, excerpt: null });
  });
});

describe('pageBuilderEnvelopeBytes', () => {
  it('is the UTF-8 byte length of the JSON', () => {
    const envelope = { languages: { 'pl-PL': { t: 'żółw' } } };
    expect(pageBuilderEnvelopeBytes(envelope)).toBe(Buffer.byteLength(JSON.stringify(envelope), 'utf8'));
    // "ż", "ó" and "ł" are one UTF-16 unit and two UTF-8 bytes each.
    expect(pageBuilderEnvelopeBytes(envelope)).toBe(JSON.stringify(envelope).length + 3);
  });
});

describe('resolvePageBuilderLanguage (FR-033, research R-12)', () => {
  const ctx = (preferredLanguage: string | undefined, defaultLanguage: string) => ({
    preferredLanguage,
    resolvedChannel: { defaultLanguage },
  });
  const all = {
    'de-DE': doc(block({ text: 'de' })),
    en: doc(block({ text: 'en' })),
    'en-US': doc(block({ text: 'en-US' })),
    'pl-PL': doc(block({ text: 'pl' })),
    'cs-CZ': doc(block({ text: 'cs' })),
  };

  it('takes the visitor language first', () => {
    expect(resolvePageBuilderLanguage(all, ctx('pl-PL', 'cs-CZ'))?.language).toBe('pl-PL');
  });

  it('then the channel default', () => {
    expect(resolvePageBuilderLanguage(all, ctx('fr-FR', 'cs-CZ'))?.language).toBe('cs-CZ');
    expect(resolvePageBuilderLanguage(all, ctx(undefined, 'cs-CZ'))?.language).toBe('cs-CZ');
  });

  it('then en-US, then en', () => {
    expect(resolvePageBuilderLanguage(all, ctx('fr-FR', 'it-IT'))?.language).toBe('en-US');
    const { 'en-US': _drop, ...noEnUs } = all;
    expect(resolvePageBuilderLanguage(noEnUs, ctx('fr-FR', 'it-IT'))?.language).toBe('en');
  });

  it('then any stored language', () => {
    expect(resolvePageBuilderLanguage({ 'de-DE': all['de-DE'] }, ctx('fr-FR', 'it-IT'))).toEqual({
      language: 'de-DE',
      document: all['de-DE'],
    });
  });

  it('skips a language whose document has no block', () => {
    expect(
      resolvePageBuilderLanguage({ 'pl-PL': EMPTY, 'cs-CZ': EMPTY, 'de-DE': all['de-DE'] }, ctx('pl-PL', 'cs-CZ'))
        ?.language,
    ).toBe('de-DE');
  });

  it('answers null when nothing holds a block', () => {
    expect(resolvePageBuilderLanguage({ 'pl-PL': EMPTY }, ctx('pl-PL', 'pl-PL'))).toBeNull();
    expect(resolvePageBuilderLanguage({}, ctx('pl-PL', 'pl-PL'))).toBeNull();
  });
});
