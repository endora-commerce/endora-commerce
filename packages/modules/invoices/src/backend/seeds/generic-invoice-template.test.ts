import { describe, expect, it } from 'vitest';
import {
  GENERIC_INVOICE_TEMPLATE_CONTENT,
  GENERIC_INVOICE_TEMPLATE_SEED_REVISION,
} from './generic-invoice-template.js';

/**
 * `specs/134-paid-module-extraction/` T063, piece 1 — the seed writes only this
 * module's own blocks.
 *
 * It used to write `ksef.InvoiceSection` into every instance's generic
 * template, so a free module seeded a block a different module declares. A
 * free instance has no KSeF section; an operator who adds the `ksef` module
 * places the block in the builder, where the layout position is theirs to
 * choose, and installing the module writes nothing into this module's stored
 * templates (`spec.md` §11.3, the sub-ruling).
 */
describe('generic invoice template seed', () => {
  const trees = (GENERIC_INVOICE_TEMPLATE_CONTENT as {
    languages: Record<string, { content: Array<{ type: string }> }>;
  }).languages;

  it('seeds only invoices’ own blocks, in every language', () => {
    for (const [language, tree] of Object.entries(trees)) {
      const types = tree.content.map((node) => node.type);
      expect(types, language).toHaveLength(8);
      expect(types.filter((type) => !type.startsWith('invoices.')), language).toEqual([]);
    }
  });

  it('keeps the seed revision, so no stored template is rewritten by the change', () => {
    // `ensureGenericSeed` rewrites an existing system row when this number
    // advances. Bumping it here would strip the KSeF node out of every
    // existing instance's stored template — a write into stored documents the
    // ruling rules out: existing templates keep the node, and it takes the
    // FR-019 path wherever its declarant is absent.
    expect(GENERIC_INVOICE_TEMPLATE_SEED_REVISION).toBe(2);
  });
});
