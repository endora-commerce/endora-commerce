import { describe, expect, it } from 'vitest';
import type { InvoicePdfBlockRegistration } from '@endora-commerce/contracts';
import { InvoicePdfBlockRegistry } from '../services/invoice-pdf-block-registry.js';
import { invoicePageBuilderDescriptor } from './descriptor.js';

/**
 * `specs/134-paid-module-extraction/` T063, piece 3 — the builder descriptor
 * describes this module's own blocks and asks each present contributor for
 * its own.
 */
const STAMP: InvoicePdfBlockRegistration = {
  name: 'acme.InvoiceStamp',
  moduleId: 'acme',
  describe: () => ({
    label: 'Stamp',
    fields: { ink: { type: 'color', label: 'Ink' } },
  }),
  render: () => ({ text: '' }),
};

describe('invoice page-builder descriptor', () => {
  it('describes invoices’ own ten blocks with no contributor', () => {
    const descriptor = invoicePageBuilderDescriptor(new InvoicePdfBlockRegistry());
    expect(descriptor.schemaVersion).toBe(1);
    expect(descriptor.components).toHaveLength(10);
    expect(new Set(descriptor.components.map((c) => c.ownerModule))).toEqual(new Set(['invoices']));
  });

  it('adds a present contributor’s block under its own module, and drops it while absent', () => {
    const present = new Set(['acme']);
    const registry = new InvoicePdfBlockRegistry((id) => present.has(id));
    registry.register(STAMP);

    const withStamp = invoicePageBuilderDescriptor(registry);
    expect(withStamp.components).toHaveLength(11);
    expect(withStamp.components.at(-1)).toEqual({
      name: 'acme.InvoiceStamp',
      ownerModule: 'acme',
      label: 'Stamp',
      fields: { ink: { type: 'color', label: 'Ink' } },
    });

    present.delete('acme');
    expect(invoicePageBuilderDescriptor(registry).components).toHaveLength(10);
  });
});
