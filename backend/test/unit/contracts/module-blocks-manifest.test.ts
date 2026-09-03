import { describe, expect, it } from 'vitest';
import {
  defineModuleManifest,
  type BlockCategory,
  type BlockDefinition,
  type ModuleManifest,
} from '@endora-commerce/contracts';

/**
 * Feature 096, Phase 1 — `contracts/block-definition.md` §1, the three rules
 * refused where a manifest is built.
 *
 * They sit beside `assertActivationRules` for the reason that family always
 * does: each is cross-field — one reads `name` against the outer `id`, one
 * reads a block's `category` against the manifest's own `blockCategories` —
 * and every message has to name the module the author is looking at. All of
 * them fire on import, on the author's machine, with no instance and no
 * database.
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

    it('accepts a category that covers only one of the block’s contexts', () => {
      // The rule is "declared for at least one of the block's contexts", not
      // "for all of them": a block offered in two surfaces whose category
      // exists in one of them is legible, and the palette simply does not
      // render it in the other.
      const m = manifest({
        id: 'catalog',
        blocks: [{ ...productGrid, contexts: ['cms', 'email'] }],
        blockCategories: [catalogCategory],
      });
      expect(m.blocks?.[0]?.contexts).toEqual(['cms', 'email']);
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
        /manifest "catalog" declares block "catalog\.ProductGrid" in category "catalog", which this manifest does not declare/,
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
  });
});
