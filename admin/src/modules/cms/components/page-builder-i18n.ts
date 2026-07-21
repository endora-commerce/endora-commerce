import type { Config, ComponentConfig } from '@measured/puck';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

function translateOrFallback(t: TranslateFn, key: string, fallback: string): string {
  const value = t(key);
  // Missing keys resolve to `cms.<key>` placeholders — keep the English label.
  if (value === `cms.${key}`) return fallback;
  return value;
}

/** Apply CMS i18n labels to Puck component + category titles (drawer / outline). */
export function applyPageBuilderTranslations(config: Config, t: TranslateFn): Config {
  const components = Object.fromEntries(
    Object.entries(config.components ?? {}).map(([name, cfg]) => {
      const fallback =
        typeof (cfg as ComponentConfig | undefined)?.label === 'string'
          ? ((cfg as ComponentConfig).label as string)
          : name;
      return [
        name,
        {
          ...cfg,
          label: translateOrFallback(t, `pageBuilder.components.${name}`, fallback),
        },
      ];
    }),
  );

  const categories = Object.fromEntries(
    Object.entries(config.categories ?? {}).map(([key, category]) => {
      const fallback =
        typeof category?.title === 'string' && category.title.length > 0 ? category.title : key;
      return [
        key,
        {
          ...category,
          title: translateOrFallback(t, `pageBuilder.categories.${key}`, fallback),
        },
      ];
    }),
  );

  return { ...config, components, categories } as Config;
}
