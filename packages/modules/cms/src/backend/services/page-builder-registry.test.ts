import { describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { PageBuilderRegistry } from './page-builder-registry.js';

/**
 * Feature 096, T209/T210 — the registry is populated from the composed modules'
 * manifests and folds the declared categories at enumeration.
 *
 * The hand-written `register('cms', …)` call these tests used to exercise is
 * gone (`contracts/block-definition.md` §4.1): it registered all 35 CMS names
 * with `ownerModule: 'cms'`, five of which are `catalog`'s.
 */

function manifest(id: string, over: Partial<ModuleManifest> = {}): { manifest: ModuleManifest } {
  return {
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      description: id,
      ...over,
    } as ModuleManifest,
  };
}

const CMS = manifest('cms', {
  blocks: [
    {
      name: 'cms.Row',
      labelKey: 'blocks.row.label',
      category: 'layout',
      contexts: ['cms'],
      fields: { gap: { type: 'number' } },
      weight: 10,
    },
  ],
  blockCategories: [
    { key: 'layout', titleKey: 'blocks.category.layout', contexts: ['cms'], weight: 10 },
  ],
} as Partial<ModuleManifest>);

const CATALOG = manifest('catalog', {
  blocks: [
    {
      name: 'catalog.ProductCard',
      labelKey: 'blocks.productCard.label',
      descriptionKey: 'blocks.productCard.description',
      category: 'catalog',
      contexts: ['cms'],
      fields: { productId: { type: 'text' } },
      defaultProps: { productSlug: '' },
      responsiveFields: ['margin'],
      previewIcon: 'ShoppingCart',
      weight: 20,
    },
  ],
  blockCategories: [
    { key: 'catalog', titleKey: 'blocks.category.catalog', contexts: ['cms'], weight: 40 },
  ],
} as Partial<ModuleManifest>);

describe('PageBuilderRegistry — declarations', () => {
  it('serves every declared block with its owner derived from the name (B1)', async () => {
    const reg = new PageBuilderRegistry({ manifests: [CMS, CATALOG] });
    const desc = await reg.describe();
    expect(desc.components.map((c) => c.name)).toEqual(['catalog.ProductCard', 'cms.Row']);
    const card = desc.components.find((c) => c.name === 'catalog.ProductCard')!;
    expect(card.ownerModule).toBe('catalog');
    expect(card.labelKey).toBe('blocks.productCard.label');
    expect(card.descriptionKey).toBe('blocks.productCard.description');
    expect(card.category).toBe('catalog');
    expect(card.defaultProps).toEqual({ productSlug: '' });
    expect(card.responsiveFields).toEqual(['margin']);
    expect(card.previewIcon).toBe('ShoppingCart');
    expect(card.weight).toBe(20);
    expect(card.contexts).toEqual(['cms']);
  });

  it('refuses two modules declaring one name, naming both (B4, defect D-d)', () => {
    const other = manifest('blog', {
      blocks: [
        {
          name: 'cms.Row',
          labelKey: 'blocks.row.label',
          category: 'layout',
          contexts: ['cms'],
          fields: {},
        },
      ],
      blockCategories: [{ key: 'layout', titleKey: 'blocks.category.layout', contexts: ['cms'] }],
    } as Partial<ModuleManifest>);
    expect(() => new PageBuilderRegistry({ manifests: [CMS, other] })).toThrow(
      /cms.*blog|blog.*cms/s,
    );
  });

  it('is idempotent over one module re-declaring its own manifest', () => {
    // The refusal's subject is **two contributors**, which is what D-31 asks for
    // and what defect D-d got wrong by warning and overwriting. One module
    // registered twice — an idempotent re-composition, a test harness calling a
    // fixture once per case — is not a collision, and refusing it produced the
    // sentence `declared by both "test_ext" and "test_ext"`, which is
    // self-evidently not one. Measured: it took the extension SPI's integration
    // test down, and that test is the only exercise the registration seam has.
    const reg = new PageBuilderRegistry({ manifests: [CMS] });
    expect(() => reg.registerManifest(CMS.manifest)).not.toThrow();
    expect([...reg.knownNames()]).toEqual(['cms.Row']);
  });

  it('omits a switched-off module’s blocks and restores them (B5, B6)', async () => {
    const present = new Set(['cms', 'catalog']);
    const reg = new PageBuilderRegistry({
      manifests: [CMS, CATALOG],
      isModulePresent: (id) => present.has(id),
    });
    expect((await reg.describe()).components).toHaveLength(2);
    present.delete('catalog');
    expect((await reg.describe()).components.map((c) => c.name)).toEqual(['cms.Row']);
    present.add('catalog');
    expect((await reg.describe()).components).toHaveLength(2);
  });

  it('keeps knownNames() unfiltered — it answers "is this a block name at all"', () => {
    const reg = new PageBuilderRegistry({
      manifests: [CMS, CATALOG],
      isModulePresent: (id) => id === 'cms',
    });
    expect([...reg.knownNames()].sort()).toEqual(['catalog.ProductCard', 'cms.Row']);
    expect(reg.isComponentRegistered('catalog.ProductCard')).toBe(true);
  });
});

describe('PageBuilderRegistry — the category fold', () => {
  const INVOICES = manifest('invoices', {
    blocks: [
      {
        name: 'invoices.InvoiceHeader',
        labelKey: 'blocks.invoiceHeader.label',
        category: 'invoice',
        contexts: ['invoice'],
        fields: {},
      },
    ],
    blockCategories: [
      { key: 'invoice', titleKey: 'invoices.title', contexts: ['invoice'], weight: 10 },
    ],
  } as Partial<ModuleManifest>);

  const KSEF = manifest('ksef', {
    blocks: [
      {
        name: 'ksef.InvoiceSection',
        labelKey: 'blocks.invoiceSection.label',
        category: 'invoice',
        contexts: ['invoice'],
        fields: {},
      },
    ],
    blockCategories: [{ key: 'invoice', titleKey: 'ksef.title', contexts: ['invoice'] }],
  } as Partial<ModuleManifest>);

  it('merges two declarations of one (key, context) into one served record (B11)', async () => {
    const reg = new PageBuilderRegistry({ manifests: [INVOICES, KSEF] });
    const cats = (await reg.describe()).categories!;
    const invoice = cats.filter((c) => c.key === 'invoice');
    expect(invoice).toHaveLength(1);
    // One record, resolved as one record: the title and the weight both come
    // from `invoices`, which wins on weight.
    expect(invoice[0]!.titleKey).toBe('invoices.title');
    expect(invoice[0]!.weight).toBe(10);
    expect(invoice[0]!.ownerModule).toBe('invoices');
    expect(invoice[0]!.contexts).toEqual(['invoice']);
  });

  it('promotes the surviving declaration when the namer is switched off, and back (B12)', async () => {
    const present = new Set(['invoices', 'ksef']);
    const reg = new PageBuilderRegistry({
      manifests: [INVOICES, KSEF],
      isModulePresent: (id) => present.has(id),
    });
    expect((await reg.describe()).categories![0]!.titleKey).toBe('invoices.title');

    present.delete('invoices');
    const off = await reg.describe();
    const section = off.categories!.find((c) => c.key === 'invoice')!;
    expect(section.titleKey).toBe('ksef.title');
    expect(section.ownerModule).toBe('ksef');
    expect(section.weight).toBeUndefined();
    expect(off.components.map((c) => c.name)).toEqual(['ksef.InvoiceSection']);

    present.add('invoices');
    expect((await reg.describe()).categories![0]!.titleKey).toBe('invoices.title');
  });

  it('is byte-identical under a reversed module list (B13 — the D-45 assertion)', async () => {
    const forward = await new PageBuilderRegistry({ manifests: [INVOICES, KSEF, CMS] }).describe();
    const reverse = await new PageBuilderRegistry({ manifests: [CMS, KSEF, INVOICES] }).describe();
    expect(JSON.stringify(reverse.categories)).toBe(JSON.stringify(forward.categories));
    expect(JSON.stringify(reverse.components)).toBe(JSON.stringify(forward.components));
  });

  it('breaks a weight tie by declaring module id, ascending', async () => {
    const zeta = manifest('zeta', {
      blocks: [
        { name: 'zeta.Thing', labelKey: 'x', category: 'shared', contexts: ['cms'], fields: {} },
      ],
      blockCategories: [{ key: 'shared', titleKey: 'zeta.title', contexts: ['cms'], weight: 5 }],
    } as Partial<ModuleManifest>);
    const alpha = manifest('alpha', {
      blocks: [
        { name: 'alpha.Thing', labelKey: 'x', category: 'shared', contexts: ['cms'], fields: {} },
      ],
      blockCategories: [{ key: 'shared', titleKey: 'alpha.title', contexts: ['cms'], weight: 5 }],
    } as Partial<ModuleManifest>);
    const cats = (await new PageBuilderRegistry({ manifests: [zeta, alpha] }).describe())
      .categories!;
    expect(cats.find((c) => c.key === 'shared')!.titleKey).toBe('alpha.title');
  });

  it('serves one entry per (key, context) — one key in two contexts is two records', async () => {
    const both = manifest('cms', {
      blocks: [
        {
          name: 'cms.Row',
          labelKey: 'x',
          category: 'layout',
          contexts: ['cms', 'email'],
          fields: {},
        },
      ],
      blockCategories: [
        { key: 'layout', titleKey: 'cms.layout', contexts: ['cms', 'email'], weight: 10 },
      ],
    } as Partial<ModuleManifest>);
    const cats = (await new PageBuilderRegistry({ manifests: [both] }).describe()).categories!;
    expect(cats.map((c) => `${c.key}/${c.contexts.join()}`)).toEqual(['layout/cms', 'layout/email']);
  });

  it('serves declarations faithfully and synthesises no newsletter section', async () => {
    // Admission is the palette derivation's, applied once through
    // `contextAdmits` (`contracts/block-definition.md` §4.1.1). The wire shape
    // keeps saying what the manifests say.
    const emailOnly = manifest('transactional_emails', {
      blocks: [
        {
          name: 'transactional_emails.EmailText',
          labelKey: 'x',
          category: 'content',
          contexts: ['email'],
          fields: {},
        },
      ],
      blockCategories: [{ key: 'content', titleKey: 'te.content', contexts: ['email'], weight: 10 }],
    } as Partial<ModuleManifest>);
    const desc = await new PageBuilderRegistry({ manifests: [emailOnly] }).describe();
    expect(desc.categories!.every((c) => !c.contexts.includes('newsletter'))).toBe(true);
    expect(desc.components[0]!.contexts).toEqual(['email']);
  });

  it('keeps visible:false on the hidden drawer', async () => {
    const hidden = manifest('cms', {
      blocks: [
        { name: 'cms.Column', labelKey: 'x', category: 'internal', contexts: ['cms'], fields: {} },
      ],
      blockCategories: [
        {
          key: 'internal',
          titleKey: 'blocks.category.internal',
          contexts: ['cms'],
          weight: 60,
          visible: false,
        },
      ],
    } as Partial<ModuleManifest>);
    const cats = (await new PageBuilderRegistry({ manifests: [hidden] }).describe()).categories!;
    expect(cats[0]!.visible).toBe(false);
  });
});

describe('PageBuilderRegistry — the rest of the descriptor', () => {
  it('serves breakpoints and the colour palette', async () => {
    const reg = new PageBuilderRegistry({ manifests: [CMS] });
    reg.setColorPaletteResolver(async () => [
      { id: '00000000-0000-0000-0000-000000000001', name: 'Brand', hex: '#112233' },
    ]);
    const desc = await reg.describe();
    expect(desc.breakpoints).toEqual({ tabletMin: 768, desktopMin: 1024 });
    expect(desc.colorPalette).toEqual([
      { id: '00000000-0000-0000-0000-000000000001', name: 'Brand', hex: '#112233' },
    ]);
  });

  it('is empty and does not throw when no module declares a block', async () => {
    const desc = await new PageBuilderRegistry({ manifests: [manifest('auth')] }).describe();
    expect(desc.components).toEqual([]);
    expect(desc.categories).toEqual([]);
  });
});
