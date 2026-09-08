import { describe, expect, it } from 'vitest';
import { manifest } from '../../src/manifest.js';

describe('invoice_ledger manifest', () => {
  it('is the locked shared ledger module', () => {
    expect(manifest.id).toBe('invoice_ledger');
    expect(manifest.activation).toMatchObject({ nonDeactivatable: true });
  });
});
