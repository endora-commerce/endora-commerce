import { describe, expect, it } from 'vitest';
import { publishedDocBlock, publishedMembers } from '../../helpers/published-port-source.js';
import { PaymentAdapterRegistry } from '../../../src/modules/payment_methods/services/payment-adapter-registry.js';

/**
 * D-98.4 — `PaymentAdapterRegistryPort` publishes the measured demand and
 * nothing else.
 *
 * The demand is three: `register` has five contributors (the four gateways and
 * `payments`' built-ins), `get` and `ownerOf` are read by `orders`. The other
 * six had no caller of any kind — the owner types its own reads against the
 * class, and every test that exercises them imports the process singleton — so
 * they were surface, not contract.
 *
 * The window matters more than the six methods do: once the payment extension
 * surface ships as a package, narrowing it breaks code that cannot be measured
 * (D-99.8). This test holds the narrowing in place, and, because the class is
 * unchanged, holds the distinction that makes it safe.
 */
const CONTRACT = 'payment-methods.ts';
const PORT = 'PaymentAdapterRegistryPort';

/** The owner's own vocabulary — on the class, off the contract. */
const OWNER_ONLY = ['unregister', 'isRegistered', 'isAvailable', 'resolve', 'list', 'listAll'];

describe('the published payment adapter registry surface (D-98.4)', () => {
  it('publishes exactly the contribution half and the two reads `orders` makes', () => {
    expect(publishedMembers(CONTRACT, PORT)).toEqual(['register', 'get', 'ownerOf']);
  });

  it('keeps every removed method on the class, which is what makes narrowing safe', () => {
    const registry = new PaymentAdapterRegistry();
    for (const method of OWNER_ONLY) {
      expect(
        typeof (registry as unknown as Record<string, unknown>)[method],
        `PaymentAdapterRegistry lost ${method}`,
      ).toBe('function');
    }
  });

  it('says what the removed readers are for, so nobody restores them as an oversight', () => {
    const doc = publishedDocBlock(CONTRACT, PORT);
    for (const method of OWNER_ONLY) {
      expect(doc, `the doc block no longer accounts for ${method}`).toContain(`\`${method}\``);
    }
  });

  it('states the return condition a cross-module caller has to handle', () => {
    const doc = publishedDocBlock(CONTRACT, PORT);
    expect(doc).toMatch(/`get`[\s\S]*`undefined`/);
  });

  it('keeps the presence sentence `ownerOf` is published for', () => {
    const doc = publishedDocBlock(CONTRACT, PORT);
    expect(doc).toMatch(/`ownerOf`[\s\S]*deliberately does not/);
    expect(doc).toContain('the reason it is unavailable');
  });
});
