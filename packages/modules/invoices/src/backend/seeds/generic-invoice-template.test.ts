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

  it('is at revision 3, the layout with empty labels (issue #437)', () => {
    // T063 kept revision 2 because `ensureGenericSeed` rewrote the stored
    // system row whenever it advanced, which would have stripped the KSeF
    // node out of existing templates. That code went with `invoice_templates`
    // (spec 152), so advancing it rewrites nothing; stored templates are
    // corrected by `document_templates`' own migration, prop by prop.
    expect(GENERIC_INVOICE_TEMPLATE_SEED_REVISION).toBe(3);
  });
});
