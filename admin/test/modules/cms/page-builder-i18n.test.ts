import { describe, expect, it } from 'vitest';
import type { Config } from '@measured/puck';
import { applyPageBuilderTranslations } from '../../../../packages/modules/cms/src/admin/components/page-builder-i18n';

/**
 * Feature 096, T306 — **category titles are no longer this function's job.**
 *
 * A section's `titleKey` belongs to whichever module's declaration won the merge
 * (`contracts/block-definition.md` §1.1), so it is resolved in that module's
 * scope where the palette is derived. Translating it a second time in `cms`'
 * scope would either be a no-op or would overwrite the right answer with a
 * placeholder.
 */
describe('applyPageBuilderTranslations', () => {
  it('translates a component label through the legacy cms-scoped key', () => {
    const config = {
      components: {
        'cms.Row': { label: 'Row', fields: {}, defaultProps: {}, render: () => null },
      },
      categories: { layout: { title: 'Layout', components: ['cms.Row'] } },
    } as unknown as Config;

    const t = (key: string): string =>
      key === 'pageBuilder.components.cms.Row' ? 'Wiersz' : `cms.${key}`;

    const next = applyPageBuilderTranslations(config, t);
    expect(next.components?.['cms.Row']?.label).toBe('Wiersz');
    // Untouched — whatever the palette derivation resolved is what renders.
    expect(next.categories?.['layout']?.title).toBe('Layout');
  });

  it('prefers the declared label resolver over the legacy key', () => {
    // The declaring module's own `labelKey`, resolved in the declaring module's
    // scope. This is what makes `catalog.ProductGrid`'s label come out of
    // `catalog`'s bundle rather than out of `cms`'.
    const config = {
      components: {
        'catalog.ProductGrid': { label: 'Product grid', fields: {}, defaultProps: {}, render: () => null },
      },
    } as unknown as Config;

    const next = applyPageBuilderTranslations(
      config,
      (key) => `cms.${key}`,
      (name) => (name === 'catalog.ProductGrid' ? 'Siatka produktów' : undefined),
    );
    expect(next.components?.['catalog.ProductGrid']?.label).toBe('Siatka produktów');
  });

  it('keeps the English fallback when neither resolver has the key', () => {
    const config = {
      components: {
        'cms.Hero': { label: 'Hero / CTA banner', fields: {}, defaultProps: {}, render: () => null },
      },
      categories: {},
    } as unknown as Config;

    const next = applyPageBuilderTranslations(config, (key) => `cms.${key}`, () => undefined);
    expect(next.components?.['cms.Hero']?.label).toBe('Hero / CTA banner');
  });
});
