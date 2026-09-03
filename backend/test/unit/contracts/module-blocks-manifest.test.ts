import { describe, expect, it } from 'vitest';
import {
  defineModuleManifest,
  type BlockCategory,
  type BlockDefinition,
  type ModuleManifest,
} from '@endora-commerce/contracts';

/**
 * Feature 096 — `contracts/block-definition.md` §1, the four rules refused
 * where a manifest is built.
 *
 * They sit beside `assertActivationRules` for the reason that family always
 * does: each is cross-field — one reads `name` against the outer `id`, one
 * reads a block's `category` against the manifest's own `blockCategories`, one
 * reads those declarations against each other — and every message has to name
 * the module the author is looking at. All of them fire on import, on the
 * author's machine, with no instance and no database.
 *
 * Rule 2 is per **context** and not per block (T107, the category ruling of
 * 2026-09-02, §1.1). Phase 1 shipped it as "at least one of the block's
 * contexts", under which a block declared for `cms` and `email` whose section
 * exists only in `cms` is uninsertable in the e-mail palette with no error
 * anywhere. In this tree the strengthening costs nothing: no block spans two
 * palettes, and one category entry may list every context it serves.
 *
 * Every proof below hands `defineModuleManifest` a whole manifest object. That
 * is the top of the analysis, which is where a red proof has to enter
 * (`AGENTS.md`, issue #130): a fixture handed a pre-validated block, or handed
 * straight to `BlockDefinitionSchema`, cannot catch a rule that stopped
 * running.
 *
 * What this layer deliberately cannot decide is the same thing the error-code
 * layer cannot: anything about a **second** manifest. Two modules declaring one
 * name, and a category one module declares and another uses, are composition's
 * questions and `check:block-names`' (Phase 7). A partial refusal here would be
 * a green that means "not looking".
 */
function manifest(overrides: Partial<ModuleManifest> & { id: string }): ModuleManifest {
  return defineModuleManifest({
    name: 'Fixture module',
    version: '1.0.0',
    dependencies: [],
    ...overrides,
  } as ModuleManifest);
}

const productGrid: BlockDefinition = {
  name: 'catalog.ProductGrid',
  labelKey: 'blocks.productGrid.label',
  category: 'catalog',
  contexts: ['cms'],
  fields: { columns: { type: 'number' } },
};

const catalogCategory: BlockCategory = {
  key: 'catalog',
  titleKey: 'blocks.category.catalog',
  contexts: ['cms'],
  weight: 40,
};

describe('defineModuleManifest — blocks declaration (feature 096)', () => {
  describe('what it accepts', () => {
    it('accepts a manifest declaring no blocks at all', () => {
      const m = manifest({ id: 'catalog' });
      expect(m.blocks).toBeUndefined();
      expect(m.blockCategories).toBeUndefined();
    });

    it('accepts a block whose owner segment is the declaring module', () => {
      const m = manifest({
        id: 'catalog',
        blocks: [productGrid],
        blockCategories: [catalogCategory],
      });
      expect(m.blocks?.[0]?.name).toBe('catalog.ProductGrid');
    });

    it('accepts an underscore-prefixed module id in the owner segment', () => {
      const m = manifest({
        id: 'transactional_emails',
        activation: { nonDeactivatable: true, reason: 'The platform sends e-mail.' },
        blocks: [
          {
            ...productGrid,
            name: 'transactional_emails.EmailHeading',
            category: 'content',
            contexts: ['email'],
          },
        ],
        blockCategories: [
          { key: 'content', titleKey: 'blocks.category.content', contexts: ['email'] },
        ],
      });
      expect(m.blocks?.[0]?.name).toBe('transactional_emails.EmailHeading');
    });

    it('accepts a block whose category is declared for every one of its contexts', () => {
      // One category entry may carry both contexts, which is what makes the
      // every-context rule cost nothing in this tree: no block spans two
      // palettes today, and the one that does declares its section in both.
      const m = manifest({
        id: 'catalog',
        blocks: [{ ...productGrid, contexts: ['cms', 'email'] }],
        blockCategories: [{ ...catalogCategory, contexts: ['cms', 'email'] }],
      });
      expect(m.blocks?.[0]?.contexts).toEqual(['cms', 'email']);
    });

    it('accepts two entries under one key when their contexts are disjoint', () => {
      // `(key, context)` is the identity, so `layout` in the CMS palette and
      // `layout` in the e-mail palette are two sections that share a key.
      // Splitting them across two entries is legal; overlapping them is rule 4.
      const m = manifest({
        id: 'catalog',
        blocks: [productGrid],
        blockCategories: [
          catalogCategory,
          { key: 'catalog', titleKey: 'blocks.category.catalog', contexts: ['email'] },
        ],
      });
      expect(m.blockCategories).toHaveLength(2);
    });

    it('accepts a category declaration a block does not use', () => {
      const m = manifest({
        id: 'catalog',
        blocks: [productGrid],
        blockCategories: [
          catalogCategory,
          { key: 'promotions', titleKey: 'blocks.category.promotions', contexts: ['cms'] },
        ],
      });
      expect(m.blockCategories).toHaveLength(2);
    });

    it('accepts two modules declaring the same category key — it cannot see the second', () => {
      const cms = manifest({ id: 'cms', blockCategories: [catalogCategory] });
      const catalog = manifest({ id: 'catalog', blockCategories: [catalogCategory] });
      expect(cms.blockCategories).toEqual(catalog.blockCategories);
    });
  });

  describe('what it refuses — one proof per shape', () => {
    it('refuses a foreign namespace, naming the module, the block and the segment', () => {
      expect(() =>
        manifest({
          id: 'catalog',
          blocks: [{ ...productGrid, name: 'cms.Hero' }],
          blockCategories: [catalogCategory],
        }),
      ).toThrow(
        /manifest "catalog" declares block "cms\.Hero", whose owner segment "cms" is not this module's id/,
      );
    });

    it('refuses a bare name, naming the module and the block', () => {
      expect(() =>
        manifest({
          id: 'catalog',
          blocks: [{ ...productGrid, name: 'ProductGrid' }],
          blockCategories: [catalogCategory],
        }),
      ).toThrow(
        /manifest "catalog" declares block "ProductGrid", which is not a namespaced block name/,
      );
    });

    it('refuses an empty `contexts`, naming the module and the block', () => {
      expect(() =>
        manifest({
          id: 'catalog',
          blocks: [{ ...productGrid, contexts: [] }],
          blockCategories: [catalogCategory],
        }),
      ).toThrow(
        /manifest "catalog" declares block "catalog\.ProductGrid" with an empty `contexts`/,
      );
    });

    it('refuses a category this manifest declares for none of the block’s contexts', () => {
      expect(() =>
        manifest({
          id: 'catalog',
          blocks: [{ ...productGrid, contexts: ['email'] }],
          blockCategories: [catalogCategory],
        }),
      ).toThrow(
        /manifest "catalog" declares block "catalog\.ProductGrid" in category "catalog", which this manifest does not declare in `blockCategories` for context "email"/,
      );
    });

    it('refuses a category declared for one of two contexts, naming the missing one', () => {
      // T107. The rule read "at least one of the block's contexts" until the
      // category ruling of 2026-09-02. Under that reading this manifest is
      // legal and `catalog.ProductGrid` is uninsertable in the e-mail palette
      // with no error anywhere — FR-009's silent-loss shape one level down.
      expect(() =>
        manifest({
          id: 'catalog',
          blocks: [{ ...productGrid, contexts: ['cms', 'email'] }],
          blockCategories: [catalogCategory],
        }),
      ).toThrow(
        /manifest "catalog" declares block "catalog\.ProductGrid" in category "catalog", which this manifest does not declare in `blockCategories` for context "email"/,
      );
    });

    it('names the first missing context, in the block’s own order', () => {
      expect(() =>
        manifest({
          id: 'catalog',
          blocks: [{ ...productGrid, contexts: ['invoice', 'newsletter'] }],
          blockCategories: [catalogCategory],
        }),
      ).toThrow(/for context "invoice"/);
    });

    it('refuses one manifest declaring one `(key, context)` twice', () => {
      // T107 rule 4. A cross-module duplicate is normal and merges (§1.1);
      // this one has one author and is decidable where it is written.
      expect(() =>
        manifest({
          id: 'catalog',
          blocks: [productGrid],
          blockCategories: [
            catalogCategory,
            { key: 'catalog', titleKey: 'blocks.category.showcase', contexts: ['cms'] },
          ],
        }),
      ).toThrow(
        /manifest "catalog" declares the palette section "catalog" twice for context "cms"/,
      );
    });

    it('refuses a duplicate `(key, context)` that overlaps in only one context', () => {
      expect(() =>
        manifest({
          id: 'catalog',
          blocks: [productGrid],
          blockCategories: [
            { key: 'catalog', titleKey: 'blocks.category.catalog', contexts: ['cms', 'email'] },
            { key: 'catalog', titleKey: 'blocks.category.catalog', contexts: ['email'] },
          ],
        }),
      ).toThrow(
        /manifest "catalog" declares the palette section "catalog" twice for context "email"/,
      );
    });

    it('refuses a duplicate `(key, context)` even when no block names it', () => {
      // The rule is about the declarations, not about what uses them: a
      // section stated twice is stated twice whether or not a block arrives.
      expect(() =>
        manifest({
          id: 'catalog',
          blockCategories: [
            { key: 'promotions', titleKey: 'blocks.category.promotions', contexts: ['cms'] },
            { key: 'promotions', titleKey: 'blocks.category.promotions', contexts: ['cms'] },
          ],
        }),
      ).toThrow(
        /manifest "catalog" declares the palette section "promotions" twice for context "cms"/,
      );
    });

    it('refuses a category this manifest does not declare at all', () => {
      expect(() =>
        manifest({ id: 'catalog', blocks: [{ ...productGrid, category: 'showcase' }] }),
      ).toThrow(
        /manifest "catalog" declares block "catalog\.ProductGrid" in category "showcase", which this manifest does not declare/,
      );
    });
  });

  describe('the order the rules fire in', () => {
    it('names the malformed name before it reaches the owner comparison', () => {
      // A name with no separator has no owner segment to compare, so the
      // grammar has to answer first or the message is about the wrong thing.
      expect(() =>
        manifest({ id: 'catalog', blocks: [{ ...productGrid, name: 'ProductGrid' }] }),
      ).toThrow(/is not a namespaced block name/);
    });

    it('names the empty `contexts` before the category, which cannot be judged without them', () => {
      expect(() =>
        manifest({
          id: 'catalog',
          blocks: [{ ...productGrid, contexts: [], category: 'showcase' }],
        }),
      ).toThrow(/with an empty `contexts`/);
    });

    it('names the duplicated section before it judges any block against the set', () => {
      // A block is judged against `blockCategories`; judging it against a set
      // that contradicts itself would report the wrong defect, so rule 4 fires
      // first.
      expect(() =>
        manifest({
          id: 'catalog',
          blocks: [{ ...productGrid, category: 'showcase' }],
          blockCategories: [catalogCategory, { ...catalogCategory, weight: 10 }],
        }),
      ).toThrow(/declares the palette section "catalog" twice/);
    });
  });
});
