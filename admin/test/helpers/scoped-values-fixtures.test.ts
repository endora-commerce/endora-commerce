import { describe, expect, it } from 'vitest';
import { scopedValuesResponseSchema } from '@endora-commerce/contracts';
import { scopedField, scopedValuesResponse } from './scoped-values-fixtures';

/**
 * Feature 174 (T023) — the editor tests' builder answers in the API's shape: every response it
 * builds parses with the contract's `scopedValuesResponseSchema`, at every scope.
 */
describe('scoped-values fixtures', () => {
  it('builds a Global answer that parses', () => {
    expect(() => scopedValuesResponseSchema.parse(scopedValuesResponse())).not.toThrow();
  });

  it('builds a Channel × language answer with overrides that parses', () => {
    const body = scopedValuesResponse({
      scope: { level: 'channel_language', channelId: '00000000-0000-4000-8000-0000000000c1', languageCode: 'pl-PL' },
      fields: { name: scopedField('Wiertarka', { source: 'set' }) },
      seo: null,
    });
    expect(scopedValuesResponseSchema.parse(body).data.fields.name).toMatchObject({ value: 'Wiertarka', source: 'set' });
  });

  it('marks a field the scope does not support', () => {
    const view = scopedField(5, { levels: ['G', 'C'], supportedHere: false });
    expect(view).toMatchObject({ levels: ['G', 'C'], supportedHere: false });
  });
});
