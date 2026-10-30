import { describe, expect, it } from 'vitest';
import {
  productKeyResolutionSchema,
  productDefaultPath,
  productPagePathsSchema,
  productPath,
  productSlugSchema,
  productUrlKeysResponseSchema,
  putProductUrlKeysRequestSchema,
  urlKeyRedirectTakeoverRequiredDetailsSchema,
  urlKeyTakenDetailsSchema,
  urlKeyWriteOutcomeSchema,
} from './product-url-keys.js';

/**
 * Feature 163 — URL-key shapes (`contracts/url-keys-and-redirects.md` §1–§5) and the
 * one seam every emitted product URL is composed by (D7, Q-B → C).
 */

const P = '00000000-0000-4000-8000-0000000000a1';
const Q = '00000000-0000-4000-8000-0000000000a2';
const C = '00000000-0000-4000-8000-0000000000c1';
const R = '00000000-0000-4000-8000-0000000000f1';

const plEn = (prefixDefaultLanguage: boolean) => ({
  languages: ['pl-PL', 'en-US', 'de-DE'],
  defaultLanguage: 'pl-PL',
  prefixDefaultLanguage,
});

describe('productPath — the only product URL composer (feature 167: prefixed, never ?lang=)', () => {
  it('prefixes every language when the channel prefixes its default language', () => {
    expect(productPath({ key: 'wiertarka', languageCode: 'pl-PL', channel: plEn(true) })).toBe('/pl/p/wiertarka');
    expect(productPath({ key: 'drill', languageCode: 'en-US', channel: plEn(true) })).toBe('/en/p/drill');
  });

  it('leaves the default language unprefixed with the setting off; others are prefixed', () => {
    expect(productPath({ key: 'wiertarka', languageCode: 'pl-PL', channel: plEn(false) })).toBe('/p/wiertarka');
    expect(productPath({ key: 'bohrer', languageCode: 'de-DE', channel: plEn(false) })).toBe('/de/p/bohrer');
  });

  it('never appends ?lang=', () => {
    for (const on of [true, false]) {
      for (const languageCode of ['pl-PL', 'en-US', 'de-DE']) {
        expect(productPath({ key: 'x', languageCode, channel: plEn(on) })).not.toContain('lang=');
      }
    }
  });

  it('URL-encodes the key', () => {
    expect(productPath({ key: 'a b/c', languageCode: 'en-US', channel: plEn(true) })).toBe('/en/p/a%20b%2Fc');
  });

  it('productDefaultPath is the unprefixed x-default target', () => {
    expect(productDefaultPath('wiertarka')).toBe('/p/wiertarka');
    expect(productDefaultPath('a b')).toBe('/p/a%20b');
  });
});

describe('productSlugSchema', () => {
  it.each(['drill', 'drill-18v', 'a1-b2-c3'])('accepts %s', (key) => {
    expect(productSlugSchema.safeParse(key).success).toBe(true);
  });

  it.each(['', 'Drill', 'drill_18v', '-drill', 'drill-', 'dri--ll', 'x'.repeat(161)])('refuses %s', (key) => {
    expect(productSlugSchema.safeParse(key).success).toBe(false);
  });
});

describe('putProductUrlKeysRequestSchema (168: Channel and Channel × language keys)', () => {
  it('accepts a Channel key, a Channel × language key, {inherit:true} and a takeover confirmation', () => {
    const parsed = putProductUrlKeysRequestSchema.safeParse({
      globalKey: 'drill',
      channelKeys: [
        { channelId: C, key: 'drill-b2b' },
        { channelId: C, languageCode: 'de-DE', key: 'bohrer' },
        { channelId: C, languageCode: 'pl-PL', key: { inherit: true } },
      ],
      confirmTakeover: ['drill'],
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses null (the URL key is required), a Language-only key and a key outside the grammar', () => {
    expect(putProductUrlKeysRequestSchema.safeParse({ channelKeys: [{ channelId: C, key: null }] }).success).toBe(false);
    expect(putProductUrlKeysRequestSchema.safeParse({ languageKeys: [{ languageCode: 'de-DE', key: 'bohrer' }] }).success).toBe(false);
    expect(putProductUrlKeysRequestSchema.safeParse({ channelKeys: [{ channelId: C, key: 'Bohrer' }] }).success).toBe(false);
  });

  it.each(['//host', '/\\host', '..', 'a%2fb', 'a:b', 'a b', 'ŻÓŁW'])('refuses the key %s', (key) => {
    expect(putProductUrlKeysRequestSchema.safeParse({ channelKeys: [{ channelId: C, key }] }).success).toBe(false);
  });

  it('caps channelKeys at 64 and confirmTakeover at 20 (R21)', () => {
    const keys = (count: number) => Array.from({ length: count }, (_, index) => ({ channelId: C, key: `k-${index}` }));
    expect(putProductUrlKeysRequestSchema.safeParse({ channelKeys: keys(64) }).success).toBe(true);
    expect(putProductUrlKeysRequestSchema.safeParse({ channelKeys: keys(65) }).success).toBe(false);
    const takeovers = (count: number) => Array.from({ length: count }, (_, index) => `k-${index}`);
    expect(putProductUrlKeysRequestSchema.safeParse({ confirmTakeover: takeovers(20) }).success).toBe(true);
    expect(putProductUrlKeysRequestSchema.safeParse({ confirmTakeover: takeovers(21) }).success).toBe(false);
  });
});

describe('productUrlKeysResponseSchema', () => {
  it('parses with and without redirects (omitted while seo is off, Q-C); redirects carry (channel, language)', () => {
    const data = {
      globalKey: 'drill',
      channelKeys: [
        { channelId: C, languageCode: null, key: 'drill-b2b', orphaned: false },
        { channelId: C, languageCode: 'de-DE', key: 'bohrer-b2b', orphaned: false },
      ],
      effective: [{ channelId: C, languageCode: 'de-DE', key: 'bohrer-b2b', source: 'channel_language', url: '/de/p/bohrer-b2b' }],
    };
    expect(productUrlKeysResponseSchema.safeParse({ data }).success).toBe(true);
    expect(
      productUrlKeysResponseSchema.safeParse({
        data: {
          ...data,
          redirects: [{ id: R, channelId: C, languageCode: 'de-DE', key: 'old-drill', createdAt: '2026-10-22T10:00:00.000Z' }],
        },
      }).success,
    ).toBe(true);
    expect(
      productUrlKeysResponseSchema.safeParse({ data: { ...data, effective: [{ ...data.effective[0], source: 'language' }] } }).success,
    ).toBe(false);
  });
});

describe('productKeyResolutionSchema', () => {
  it('discriminates product from redirect', () => {
    expect(productKeyResolutionSchema.parse({ kind: 'product', productId: P, key: 'drill' }).kind).toBe('product');
    expect(
      productKeyResolutionSchema.parse({ kind: 'redirect', key: 'old', languageCode: 'de-DE', path: '/de/p/bohrer', permanent: true })
        .kind,
    ).toBe('redirect');
    expect(productKeyResolutionSchema.safeParse({ kind: 'redirect', key: 'old' }).success).toBe(false);
  });

  it('requires `permanent` on a redirect (feature 167: former key vs another language\'s key)', () => {
    const redirect = { kind: 'redirect', key: 'wiertarka', languageCode: 'en-US', path: '/en/p/drill' };
    expect(productKeyResolutionSchema.safeParse(redirect).success).toBe(false);
    expect(productKeyResolutionSchema.safeParse({ ...redirect, permanent: false }).success).toBe(true);
  });
});

describe('productPagePathsSchema', () => {
  it('requires xDefault (feature 167)', () => {
    const paths = { canonical: '/en/p/drill', alternates: [{ languageCode: 'en-US', path: '/en/p/drill' }] };
    expect(productPagePathsSchema.safeParse(paths).success).toBe(false);
    expect(productPagePathsSchema.safeParse({ ...paths, xDefault: '/p/wiertarka' }).success).toBe(true);
  });
});

describe('error details and the import outcome', () => {
  it('URL_KEY_TAKEN names the holder', () => {
    expect(
      urlKeyTakenDetailsSchema.safeParse({
        conflicts: [{ channelId: C, languageCode: 'de-DE', key: 'bohrer', heldByProductId: Q, heldByProductName: 'Bohrer' }],
      }).success,
    ).toBe(true);
  });

  it('URL_KEY_REDIRECT_TAKEOVER_REQUIRED names the losing product', () => {
    expect(
      urlKeyRedirectTakeoverRequiredDetailsSchema.safeParse({
        takeovers: [{ channelId: C, languageCode: null, key: 'old', losingProductId: Q, losingProductName: 'Old drill' }],
      }).success,
    ).toBe(true);
  });

  it('a connector write is written or reported, never taken over (FR-093)', () => {
    expect(urlKeyWriteOutcomeSchema.safeParse({ written: true }).success).toBe(true);
    expect(
      urlKeyWriteOutcomeSchema.safeParse({
        written: false,
        issue: { languageCode: 'de-DE', channelId: C, key: 'bohrer', heldByProductId: Q, kind: 'redirect' },
      }).success,
    ).toBe(true);
    expect(
      urlKeyWriteOutcomeSchema.safeParse({
        written: false,
        issue: { languageCode: null, channelId: C, key: 'bohrer', heldByProductId: null, kind: 'limit_reached' },
      }).success,
    ).toBe(true);
  });
});
