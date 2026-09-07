import { describe, expect, it } from 'vitest';
import {
  BlockCategorySchema,
  BlockDefinitionSchema,
  blockCategoryKeyRe,
  blockNameRe,
  cmsPageBuilderDescriptorSchema,
} from '../src/cms.js';

/**
 * Feature 096, Phase 1 — `data-model.md` §1–§2 and
 * `contracts/block-definition.md` §1.
 *
 * The vocabulary only. Nothing here declares a block, and nothing at runtime
 * reads these schemas yet; what they have to be right about is the grammar of
 * a **persisted** identifier, which is written into `jsonb` once and never
 * rewritten (§3). So the name regex gets one proof per shape it refuses rather
 * than one proof that it exists.
 */

function definition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'catalog.ProductGrid',
    labelKey: 'blocks.productGrid.label',
    category: 'catalog',
    contexts: ['cms'],
    fields: { columns: { type: 'number' } },
    ...overrides,
  };
}

describe('BlockDefinitionSchema (feature 096)', () => {
  describe('the name grammar', () => {
    it('accepts an owner segment and a PascalCase local name', () => {
      for (const name of [
        'cms.Row',
        'catalog.ProductGrid',
        'orders.EmailOrderSummary',
        'transactional_emails.EmailInsertTemplate',
        'pim_ergonode.Widget2',
      ]) {
        expect(blockNameRe.test(name), name).toBe(true);
      }
    });

    it('refuses a bare name — the whole vocabulary this feature replaces', () => {
      for (const name of ['Row', 'ProductGrid', 'EmailOrderSummary']) {
        expect(blockNameRe.test(name), name).toBe(false);
      }
    });

    it('refuses a second separator — one dot, exactly (D-3)', () => {
      expect(blockNameRe.test('catalog.email.ProductCard')).toBe(false);
    });

    it('refuses a local name that is not PascalCase', () => {
      for (const name of ['catalog.productGrid', 'catalog.product_grid', 'catalog.9Grid']) {
        expect(blockNameRe.test(name), name).toBe(false);
      }
    });

    it('refuses an owner segment that is not a module id', () => {
      for (const name of ['Catalog.ProductGrid', '_lifecycle.Thing', '9catalog.Thing']) {
        expect(blockNameRe.test(name), name).toBe(false);
      }
    });

    it('refuses an empty segment on either side of the separator', () => {
      for (const name of ['.ProductGrid', 'catalog.', '.']) {
        expect(blockNameRe.test(name), name).toBe(false);
      }
    });

    it('is what the schema enforces on `name`', () => {
      expect(BlockDefinitionSchema.safeParse(definition({ name: 'ProductGrid' })).success).toBe(
        false,
      );
      expect(BlockDefinitionSchema.safeParse(definition()).success).toBe(true);
    });
  });

  describe('the shape', () => {
    it('accepts the minimum: name, labelKey, category, contexts, fields', () => {
      const parsed = BlockDefinitionSchema.parse(definition());
      expect(parsed.name).toBe('catalog.ProductGrid');
      expect(parsed.contexts).toEqual(['cms']);
      expect(parsed.descriptionKey).toBeUndefined();
      expect(parsed.defaultProps).toBeUndefined();
      expect(parsed.responsiveFields).toBeUndefined();
      expect(parsed.previewIcon).toBeUndefined();
      expect(parsed.weight).toBeUndefined();
    });

    it('carries the six fields `ComponentRegistration` does not have today (§1.1)', () => {
      const parsed = BlockDefinitionSchema.parse(
        definition({
          descriptionKey: 'blocks.productGrid.description',
          defaultProps: { source: 'manual', columns: 4 },
          responsiveFields: ['columns', 'gap'],
          previewIcon: 'LayoutGrid',
          weight: 10,
        }),
      );
      expect(parsed.labelKey).toBe('blocks.productGrid.label');
      expect(parsed.descriptionKey).toBe('blocks.productGrid.description');
      expect(parsed.category).toBe('catalog');
      expect(parsed.defaultProps).toEqual({ source: 'manual', columns: 4 });
      expect(parsed.responsiveFields).toEqual(['columns', 'gap']);
      expect(parsed.weight).toBe(10);
    });

    it('has no `ownerModule` field — ownership is stated once, in the name', () => {
      const parsed = BlockDefinitionSchema.parse(definition());
      expect(Object.keys(parsed)).not.toContain('ownerModule');
    });

    it('refuses an empty `contexts` — a block offered nowhere has no reader', () => {
      expect(BlockDefinitionSchema.safeParse(definition({ contexts: [] })).success).toBe(false);
    });

    it('accepts every member of the four-member context enum', () => {
      const parsed = BlockDefinitionSchema.parse(
        definition({ contexts: ['cms', 'email', 'invoice', 'newsletter'] }),
      );
      expect(parsed.contexts).toHaveLength(4);
    });

    it('refuses a context the enum does not carry', () => {
      expect(BlockDefinitionSchema.safeParse(definition({ contexts: ['pdf'] })).success).toBe(
        false,
      );
    });

    it('refuses a category key that is not snake_case', () => {
      for (const category of ['Catalog', 'catalog-blocks', '_internal', '']) {
        expect(
          BlockDefinitionSchema.safeParse(definition({ category })).success,
          category,
        ).toBe(false);
      }
    });

    it('validates each field descriptor against the existing CMS field schema', () => {
      expect(
        BlockDefinitionSchema.safeParse(definition({ fields: { columns: { type: 'colour' } } }))
          .success,
      ).toBe(false);
    });
  });
});

describe('BlockCategorySchema (feature 096)', () => {
  it('accepts a declared palette section', () => {
    const parsed = BlockCategorySchema.parse({
      key: 'catalog',
      titleKey: 'blocks.category.catalog',
      contexts: ['cms'],
      weight: 40,
    });
    expect(parsed.key).toBe('catalog');
    expect(parsed.visible).toBeUndefined();
  });

  it('accepts `visible: false` — the declared replacement for the hidden drawer', () => {
    const parsed = BlockCategorySchema.parse({
      key: 'internal',
      titleKey: 'blocks.category.internal',
      contexts: ['cms'],
      visible: false,
    });
    expect(parsed.visible).toBe(false);
  });

  it('refuses a key that is not snake_case', () => {
    for (const key of ['Catalog', '_internal', 'catalog-blocks']) {
      expect(
        BlockCategorySchema.safeParse({ key, titleKey: 't', contexts: ['cms'] }).success,
        key,
      ).toBe(false);
    }
  });

  it('refuses a category offered in no context', () => {
    expect(
      BlockCategorySchema.safeParse({ key: 'catalog', titleKey: 't', contexts: [] }).success,
    ).toBe(false);
  });

  it('shares one key grammar with a block declaration', () => {
    expect(blockCategoryKeyRe.test('catalog')).toBe(true);
    expect(blockCategoryKeyRe.test('_internal')).toBe(false);
  });
});

describe('cmsPageBuilderDescriptorSchema — extended additively (T101)', () => {
  const legacy = {
    schemaVersion: 1,
    components: [
      {
        name: 'ProductGrid',
        ownerModule: 'cms',
        fields: { columns: { type: 'number' } },
        previewIcon: 'LayoutGrid',
        contexts: ['cms'],
      },
    ],
  };

  it('still accepts a descriptor carrying only today’s fields', () => {
    const parsed = cmsPageBuilderDescriptorSchema.parse(legacy);
    expect(parsed.components[0]?.name).toBe('ProductGrid');
    expect(parsed.categories).toBeUndefined();
  });

  it('accepts the six new per-component fields', () => {
    const parsed = cmsPageBuilderDescriptorSchema.parse({
      ...legacy,
      components: [
        {
          ...legacy.components[0],
          name: 'catalog.ProductGrid',
          ownerModule: 'catalog',
          labelKey: 'blocks.productGrid.label',
          descriptionKey: 'blocks.productGrid.description',
          category: 'catalog',
          defaultProps: { columns: 4 },
          responsiveFields: ['columns'],
          weight: 10,
        },
      ],
    });
    const component = parsed.components[0];
    expect(component?.labelKey).toBe('blocks.productGrid.label');
    expect(component?.descriptionKey).toBe('blocks.productGrid.description');
    expect(component?.category).toBe('catalog');
    expect(component?.defaultProps).toEqual({ columns: 4 });
    expect(component?.responsiveFields).toEqual(['columns']);
    expect(component?.weight).toBe(10);
  });

  it('accepts the declared category list', () => {
    const parsed = cmsPageBuilderDescriptorSchema.parse({
      ...legacy,
      categories: [{ key: 'catalog', titleKey: 'blocks.category.catalog', contexts: ['cms'] }],
    });
    expect(parsed.categories).toHaveLength(1);
  });

  it('keeps `name` free of the block grammar — a descriptor still serves bare names', () => {
    // Phase 1 changes no runtime behaviour: the registry serves the same 74
    // bare names it served yesterday, and it is Phase 3 that re-keys them.
    // A grammar on the descriptor here would make Phase 1 a breaking change.
    expect(cmsPageBuilderDescriptorSchema.safeParse(legacy).success).toBe(true);
  });
});
