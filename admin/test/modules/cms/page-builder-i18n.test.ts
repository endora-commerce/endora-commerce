import { describe, expect, it } from 'vitest';
import type { Config } from '@measured/puck';
import { applyPageBuilderTranslations } from '../../../../packages/modules/cms/src/admin/components/page-builder-i18n';

describe('applyPageBuilderTranslations', () => {
  it('translates component and category labels', () => {
    const config = {
      components: {
        Row: { label: 'Row', fields: {}, defaultProps: {}, render: () => null },
      },
      categories: {
        layout: { title: 'Layout', components: ['Row'] },
      },
    } as unknown as Config;

    const t = (key: string): string => {
      if (key === 'pageBuilder.components.Row') return 'Wiersz';
      if (key === 'pageBuilder.categories.layout') return 'Układ';
      return `cms.${key}`;
    };

    const next = applyPageBuilderTranslations(config, t);
    expect(next.components?.Row?.label).toBe('Wiersz');
    expect(next.categories?.layout?.title).toBe('Układ');
  });

  it('keeps English fallback when translation is missing', () => {
    const config = {
      components: {
        Hero: { label: 'Hero / CTA banner', fields: {}, defaultProps: {}, render: () => null },
      },
      categories: {},
    } as unknown as Config;

    const next = applyPageBuilderTranslations(config, (key) => `cms.${key}`);
    expect(next.components?.Hero?.label).toBe('Hero / CTA banner');
  });
});
