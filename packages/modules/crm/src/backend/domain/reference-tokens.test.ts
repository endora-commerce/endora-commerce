import { describe, expect, it } from 'vitest';
import { formatOpportunityReferenceToken } from '@endora-commerce/contracts';
import { referenceTokensOf } from './reference-tokens.js';

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

describe('referenceTokensOf', () => {
  it('extracts a product and an order token, in first-appearance order', () => {
    const text = `See [[order:${ORDER}]] for the price of [[product:${PRODUCT}]].`;
    expect(referenceTokensOf(text)).toEqual([
      { type: 'order', id: ORDER },
      { type: 'product', id: PRODUCT },
    ]);
  });

  it('collapses a target named twice into one, and keeps the same id under two types apart', () => {
    const text = `[[product:${PRODUCT}]] and again [[product:${PRODUCT}]], then [[order:${PRODUCT}]]`;
    expect(referenceTokensOf(text)).toEqual([
      { type: 'product', id: PRODUCT },
      { type: 'order', id: PRODUCT },
    ]);
  });

  it('reads an upper-case uuid as the same target', () => {
    expect(referenceTokensOf(`[[product:${PRODUCT.toUpperCase()}]] [[product:${PRODUCT}]]`)).toEqual([
      { type: 'product', id: PRODUCT },
    ]);
  });

  it('answers nothing for no text, an empty text, and a text without tokens', () => {
    expect(referenceTokensOf(null)).toEqual([]);
    expect(referenceTokensOf(undefined)).toEqual([]);
    expect(referenceTokensOf('')).toEqual([]);
    expect(referenceTokensOf('Call back on Friday about the pallet price.')).toEqual([]);
  });

  it.each([
    ['an unknown type', `[[invoice:${PRODUCT}]]`],
    ['an id that is not a uuid', '[[product:42]]'],
    ['a uuid one character short', `[[product:${PRODUCT.slice(0, -1)}]]`],
    ['a single bracket', `[product:${PRODUCT}]`],
    ['whitespace inside the token', `[[product: ${PRODUCT}]]`],
    ['an unclosed token', `[[product:${PRODUCT}`],
    ['a type in upper case', `[[PRODUCT:${PRODUCT}]]`],
  ])('leaves %s as text', (_label, text) => {
    expect(referenceTokensOf(`before ${text} after`)).toEqual([]);
  });

  it('finds the well-formed token beside a malformed one', () => {
    expect(referenceTokensOf(`[[product:nope]] [[order:${ORDER}]] [[order:${OTHER}`)).toEqual([
      { type: 'order', id: ORDER },
    ]);
  });

  it('is not interested in markup: a token inside a tag is a token, and the tag is nothing', () => {
    const text = `<a href="x">[[product:${PRODUCT}]]</a><script>alert(1)</script>`;
    expect(referenceTokensOf(text)).toEqual([{ type: 'product', id: PRODUCT }]);
  });

  it('round-trips what the composer inserts', () => {
    const text = `${formatOpportunityReferenceToken('product', PRODUCT)} ${formatOpportunityReferenceToken('order', ORDER)}`;
    expect(referenceTokensOf(text)).toEqual([
      { type: 'product', id: PRODUCT },
      { type: 'order', id: ORDER },
    ]);
  });

  it('stays linear on hostile input — 10 000 characters of almost-tokens', () => {
    // The shapes that make a careless expression backtrack: long runs of
    // opening brackets, of a valid prefix, and of hex that never closes.
    const hostile = [
      '['.repeat(10_000),
      '[[product:'.repeat(1_000),
      `[[product:${'a'.repeat(9_990)}`,
      `[[order:${'1234abcd-'.repeat(1_100)}`.slice(0, 10_000),
      `${'[[product:11111111-1111-4111-8111-11111111111'.repeat(220)}`.slice(0, 10_000),
    ];
    for (const text of hostile) {
      expect(text.length).toBeGreaterThanOrEqual(9_000);
      const started = performance.now();
      expect(referenceTokensOf(text)).toEqual([]);
      expect(performance.now() - started).toBeLessThan(250);
    }
  });

  it('extracts every token of a text at the description’s size limit', () => {
    const token = (index: number) =>
      `[[product:${index.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111]] `;
    const text = Array.from({ length: 400 }, (_unused, index) => token(index)).join('');
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(referenceTokensOf(text)).toHaveLength(400);
  });
});
