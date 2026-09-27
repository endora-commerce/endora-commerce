import { describe, expect, it } from 'vitest';
import type { InvoicePdfBlockRegistration } from '@endora-commerce/contracts';
import {
  InvoicePdfBlockConflictError,
  InvoicePdfBlockRegistry,
} from './invoice-pdf-block-registry.js';

/**
 * `specs/134-paid-module-extraction/` T063 / T126 — the contributed PDF block
 * seam `invoices` owns. Rules stated here because the alternative to each is
 * plausible: a contributor that is off is skipped on every read (no restart
 * needed either way), a name is owned by the module its owner segment names,
 * `invoices`' own names cannot be taken, and a second contributor for one name
 * is refused rather than ordered.
 */

function block(overrides: Partial<InvoicePdfBlockRegistration> = {}): InvoicePdfBlockRegistration {
  return {
    name: 'acme.InvoiceStamp',
    moduleId: 'acme',
    describe: () => ({ label: 'Stamp', fields: {} }),
    render: () => ({ text: 'stamp' }),
    ...overrides,
  };
}

describe('InvoicePdfBlockRegistry', () => {
  it('answers a present contributor’s block and skips an absent one on every read', () => {
    const present = new Set(['acme']);
    const registry = new InvoicePdfBlockRegistry((id) => present.has(id));
    const stamp = block();
    registry.register(stamp);

    expect(registry.present().map((b) => b.name)).toEqual(['acme.InvoiceStamp']);
    expect(registry.find('acme.InvoiceStamp')).toBe(stamp);

    present.delete('acme');
    expect(registry.present()).toEqual([]);
    expect(registry.find('acme.InvoiceStamp')).toBeUndefined();

    // Back on without re-registering: nothing was captured at composition.
    present.add('acme');
    expect(registry.find('acme.InvoiceStamp')).toBe(stamp);
  });

  it('defaults to always-present, so a registry a unit test builds answers what it registered', () => {
    const registry = new InvoicePdfBlockRegistry();
    registry.register(block());
    expect(registry.present()).toHaveLength(1);
  });

  it('accepts the identical registration twice and refuses a second contributor for one name', () => {
    const registry = new InvoicePdfBlockRegistry();
    const stamp = block();
    registry.register(stamp);
    registry.register(stamp);
    expect(registry.present()).toHaveLength(1);
    expect(() => registry.register(block())).toThrow(InvoicePdfBlockConflictError);
  });

  it('refuses a name whose owner segment is not the registering module', () => {
    const registry = new InvoicePdfBlockRegistry();
    expect(() => registry.register(block({ name: 'other.InvoiceStamp' }))).toThrow(/owner segment/);
    expect(() => registry.register(block({ name: 'InvoiceStamp' }))).toThrow(/owner segment/);
  });

  it('refuses a contribution under invoices’ own namespace', () => {
    const registry = new InvoicePdfBlockRegistry();
    expect(() =>
      registry.register(block({ name: 'invoices.InvoiceHeader', moduleId: 'invoices' })),
    ).toThrow(/renders its own blocks/);
  });
});
