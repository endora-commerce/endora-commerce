import { describe, expect, it } from 'vitest';
import { parseAcceptLanguage } from './accept-language.js';

/**
 * The q-weighted `Accept-Language` parse (feature 083, R9; moved here by issue #397
 * so the platform's prose-language ladder and the channel content-language rule
 * read the header through one parse). The header is attacker-controlled on every
 * request, so the bounds are asserted here rather than only through a route.
 */
describe('parseAcceptLanguage — a q-weighted list, bounded (R9)', () => {
  it('sorts by descending q rather than taking the first tag', () => {
    // `split(',')[0]` answers `en` here, which is the wrong language by the
    // client's own statement (issue #397).
    expect(parseAcceptLanguage('en;q=0.2,pl;q=0.9')).toEqual(['pl', 'en']);
  });

  it('treats a tag with no q as weight 1 and keeps the written order among equals', () => {
    expect(parseAcceptLanguage('en-US,pl;q=0.9')).toEqual(['en-US', 'pl']);
    expect(parseAcceptLanguage('pl,en')).toEqual(['pl', 'en']);
  });

  it('drops a tag whose q is malformed rather than guessing a weight', () => {
    expect(parseAcceptLanguage('de;q=abc,pl')).toEqual(['pl']);
    expect(parseAcceptLanguage('de;q=,pl')).toEqual(['pl']);
  });

  it('keeps * as a tag (no consumer treats it as a language)', () => {
    expect(parseAcceptLanguage('*')).toEqual(['*']);
  });

  it('reads the first element of a duplicated header', () => {
    // Fastify hands duplicate headers over as an array.
    expect(parseAcceptLanguage(['pl', 'en'])).toEqual(['pl']);
  });

  it('answers an absent header with no tags at all', () => {
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
    expect(parseAcceptLanguage('   ')).toEqual([]);
  });

  it('truncates the header at 512 characters and ignores the remainder', () => {
    // A tag beyond the bound is not an error — the parse simply does not reach
    // it. `pl` sits past character 512 and must not appear.
    const header = `en,${'q'.repeat(520)},pl`;
    const tags = parseAcceptLanguage(header);
    expect(tags).toHaveLength(2);
    expect(tags[0]).toBe('en');
    expect(tags).not.toContain('pl');
    expect((tags[1] as string).length).toBe(512 - 'en,'.length);
  });

  it('keeps the ten heaviest tags and no more', () => {
    const header = Array.from(
      { length: 20 },
      (_unused, i) => `t${i};q=${(1 - i * 0.05).toFixed(2)}`,
    ).join(',');
    expect(header.length).toBeLessThan(512);
    const tags = parseAcceptLanguage(header);
    expect(tags).toHaveLength(10);
    expect(tags).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']);
  });

  it('caps after weighting, so a heavy tag written last survives the cap', () => {
    const filler = Array.from({ length: 15 }, (_unused, i) => `t${i};q=0.1`).join(',');
    expect(parseAcceptLanguage(`${filler},pl;q=0.9`)[0]).toBe('pl');
  });
});
