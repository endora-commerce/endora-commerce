import { describe, expect, it } from 'vitest';
import { emailVariableDescriptorSchema } from '../src/transactional-emails.js';

// Issue #560 — a template variable's sample value per language lives in the
// declaring module's bundle, named by a key the way a palette label is.
describe('emailVariableDescriptorSchema — sampleValueKey', () => {
  const variable = { key: 'statusLabel', label: 'Status', sampleValue: 'Awaiting verification' };

  it('accepts a sampleValueKey beside the English sampleValue', () => {
    const parsed = emailVariableDescriptorSchema.parse({
      ...variable,
      sampleValueKey: 'emails.newOrgRegistration.sample.statusLabel',
    });
    expect(parsed.sampleValueKey).toBe('emails.newOrgRegistration.sample.statusLabel');
    expect(emailVariableDescriptorSchema.parse(variable).sampleValueKey).toBeUndefined();
  });

  it('rejects a sampleValueKey that is not a translation key', () => {
    for (const sampleValueKey of ['.leading', 'trailing.', 'Camel.foo', 'a..b', '', 'has space']) {
      expect(() => emailVariableDescriptorSchema.parse({ ...variable, sampleValueKey })).toThrow();
    }
  });
});
