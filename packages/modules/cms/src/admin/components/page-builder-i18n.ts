import type { Config, ComponentConfig } from '@measured/puck';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Resolve one block's palette label, or `undefined` when this resolver has
 * nothing to say about that name.
 *
 * Feature 096, T306. A block's `labelKey` is **module-relative and declared by
 * its owner** (`contracts/block-definition.md` §2), so `cms`' bundle is the
 * wrong place to look for `catalog.ProductGrid`'s label — and the key scheme
 * this file used, `pageBuilder.components.<name>`, cannot express the scope at
 * all. The caller builds this from the descriptor, which carries both the owner
 * and the key.
 */
export type BlockLabelResolver = (name: string) => string | undefined;

function translateOrFallback(t: TranslateFn, key: string, fallback: string): string {
  const value = t(key);
  // Missing keys resolve to `cms.<key>` placeholders — keep the English label.
  if (value === `cms.${key}`) return fallback;
  return value;
}

/**
 * Apply i18n labels to Puck component titles (drawer / outline).
 *
 * **Categories are no longer touched here.** Their titles are resolved where the
 * palette is derived, in the owning module's scope, because a section's
 * `titleKey` belongs to whichever module's declaration won the merge
 * (`contracts/block-definition.md` §1.1). Translating them a second time in
 * `cms`' scope would either be a no-op or would overwrite the right answer with
 * a placeholder.
 */
export function applyPageBuilderTranslations(
  config: Config,
  t: TranslateFn,
  labelFor?: BlockLabelResolver,
): Config {
  const components = Object.fromEntries(
    Object.entries(config.components ?? {}).map(([name, cfg]) => {
      const fallback =
        typeof (cfg as ComponentConfig | undefined)?.label === 'string'
          ? ((cfg as ComponentConfig).label as string)
          : name;
      const declared = labelFor?.(name);
      return [
        name,
        {
          ...cfg,
          label: declared ?? translateOrFallback(t, `pageBuilder.components.${name}`, fallback),
        },
      ];
    }),
  );

  return { ...config, components } as Config;
}
