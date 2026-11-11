import { describe, expect, it } from 'vitest';
import { customFieldErrorsOf } from '@endora-commerce/admin-kit/components';
import { ApiError } from '@endora-commerce/admin-kit/lib';

/**
 * Feature 175 — the one reading of a `422 CUSTOM_FIELD_VALUE_INVALID` refusal
 * into the `fieldErrors` an embedded `CustomFieldValuesPanel` says at each
 * field. Every host create screen (category, order, Organization, member,
 * quote request) imports this one; a copy per module was the duplication
 * Principle IX refuses.
 */
describe('customFieldErrorsOf', () => {
  it('maps each refused entry to its definition key and sentence', () => {
    const error = new ApiError(422, {
      error: {
        code: 'CUSTOM_FIELD_VALUE_INVALID',
        message: 'Some fields are missing or invalid.',
        details: [
          { path: 'vat_contact', issue: 'This field is required.' },
          { path: 'region', issue: 'Choose one of the options.' },
        ],
      },
    });
    expect(customFieldErrorsOf(error)).toEqual({
      vat_contact: 'This field is required.',
      region: 'Choose one of the options.',
    });
  });

  it('skips an entry that is not a path and a sentence', () => {
    const error = new ApiError(422, {
      error: {
        code: 'CUSTOM_FIELD_VALUE_INVALID',
        message: 'x',
        // What a server may send, not what the envelope type promises.
        details: [{ path: 'ok', issue: 'Fine.' }, { path: 1, issue: 'no' }, null, 'text'] as unknown as Array<{ path: string; issue: string }>,
      },
    });
    expect(customFieldErrorsOf(error)).toEqual({ ok: 'Fine.' });
  });

  it('answers null for any other failure, which the screen reports as before', () => {
    expect(customFieldErrorsOf(new Error('network'))).toBeNull();
    expect(customFieldErrorsOf(new ApiError(422, { error: { code: 'VALIDATION_FAILED', message: 'x', details: [] } }))).toBeNull();
    expect(
      customFieldErrorsOf(new ApiError(422, { error: { code: 'CUSTOM_FIELD_VALUE_INVALID', message: 'x', details: { key: 'a' } } })),
    ).toBeNull();
  });
});
