import { describe, expect, it } from 'vitest';
import {
  adminCustomerDetailSchema,
  customerSelfProfileSchema,
  patchCustomerPreferredLanguageBodySchema,
  patchCustomerPreferredLanguageResponseSchema,
} from './customers.js';
import { customerAccountSchema } from './organizations.js';

/**
 * Issue #652 (D-292) — the customer account's preferred language on the wire.
 *
 * The request body takes one BCP-47-shaped tag, trimmed, at most 35
 * characters, and never `null`: the storefront control always submits a
 * language, and "forget my language" is not an operation the account page
 * offers. Whether the store offers the tag is the route's question, not the
 * schema's (422 `PREFERRED_LANGUAGE_NOT_OFFERED`).
 */
describe('patchCustomerPreferredLanguageBodySchema', () => {
  it('accepts a language tag and trims it', () => {
    expect(patchCustomerPreferredLanguageBodySchema.parse({ preferredLanguage: '  pl-PL ' })).toEqual({
      preferredLanguage: 'pl-PL',
    });
    expect(patchCustomerPreferredLanguageBodySchema.parse({ preferredLanguage: 'en' }).preferredLanguage).toBe('en');
    expect(
      patchCustomerPreferredLanguageBodySchema.parse({ preferredLanguage: 'zh-Hant-TW' }).preferredLanguage,
    ).toBe('zh-Hant-TW');
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['a non-tag', 'Polish please'],
    ['an underscore form', 'pl_PL'],
    ['a tag longer than 35 characters', `en-${'a'.repeat(8)}-${'b'.repeat(8)}-${'c'.repeat(8)}-${'d'.repeat(8)}`],
  ])('refuses %s', (_label, preferredLanguage) => {
    expect(patchCustomerPreferredLanguageBodySchema.safeParse({ preferredLanguage }).success).toBe(false);
  });

  it('refuses a body without the field', () => {
    expect(patchCustomerPreferredLanguageBodySchema.safeParse({}).success).toBe(false);
  });

  it('answers the stored tag', () => {
    expect(
      patchCustomerPreferredLanguageResponseSchema.parse({ data: { preferredLanguage: 'en-US' } }).data,
    ).toEqual({ preferredLanguage: 'en-US' });
  });
});

describe('the read shapes carry preferredLanguage (issue #652)', () => {
  it('is required and nullable on the buyer profile and the admin detail', () => {
    expect(customerSelfProfileSchema.shape.preferredLanguage.safeParse(null).success).toBe(true);
    expect(customerSelfProfileSchema.shape.preferredLanguage.safeParse('pl-PL').success).toBe(true);
    expect(customerSelfProfileSchema.shape.preferredLanguage.safeParse(undefined).success).toBe(false);
    expect(adminCustomerDetailSchema.shape.preferredLanguage.safeParse(null).success).toBe(true);
    expect(adminCustomerDetailSchema.shape.preferredLanguage.safeParse(undefined).success).toBe(false);
  });

  it('is on the session account GET /api/v1/me answers', () => {
    expect(customerAccountSchema.shape.preferredLanguage.safeParse('en-US').success).toBe(true);
    expect(customerAccountSchema.shape.preferredLanguage.safeParse(null).success).toBe(true);
  });
});
