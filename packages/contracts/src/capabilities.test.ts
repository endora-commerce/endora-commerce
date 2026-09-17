import { describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS, capabilityKeyRe } from './capabilities.js';

/**
 * `specs/132-connector-family-discovery/contracts/module-capabilities.md` R1.2.
 *
 * The key space is open on purpose: a capability owned by a package this
 * repository does not contain is spelled by its owner and has no entry here.
 * What is closed is the *shape*, so a stranger's key and a minted one are
 * judged by the same regex — which is why the regex is tested against a
 * population rather than against the three keys only.
 */
describe('capabilityKeyRe', () => {
  it.each(['pim-connector', 'erp-connector', 'invoice-ledger-vendor', 'a', 'a1', 'x-1-y'])(
    'accepts %s',
    (key) => {
      expect(capabilityKeyRe.test(key)).toBe(true);
    },
  );

  it.each([
    ['', 'empty'],
    ['Pim-Connector', 'upper case'],
    ['pim_connector', 'a module id, which is snake_case'],
    ['1pim', 'a leading digit'],
    ['-pim', 'a leading separator'],
    ['pim-', 'a trailing separator'],
    ['pim--connector', 'a doubled separator'],
    ['pim connector', 'a space'],
    ['pim.connector', 'a dot'],
  ])('refuses %s (%s)', (key) => {
    expect(capabilityKeyRe.test(key)).toBe(false);
  });
});

describe('CAPABILITY_KEYS', () => {
  it('mints exactly the three keys this repository owns', () => {
    expect(CAPABILITY_KEYS).toEqual({
      PIM_CONNECTOR: 'pim-connector',
      ERP_CONNECTOR: 'erp-connector',
      INVOICE_LEDGER_VENDOR: 'invoice-ledger-vendor',
    });
  });

  it('spells every minted key in the shape the regex accepts', () => {
    for (const key of Object.values(CAPABILITY_KEYS)) {
      expect(capabilityKeyRe.test(key), key).toBe(true);
    }
  });

  it('mints each key once — a duplicate value would make two names one family', () => {
    const values = Object.values(CAPABILITY_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });
});
