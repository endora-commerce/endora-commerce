import type { ComponentConfig, Config } from '@measured/puck';
import type { PageBuilderContext } from './types/responsive.js';
import { enhancePageBuilderComponent } from './editor/enhance-component-config.js';

export type ComponentContextMeta = {
  /** Contexts where this component is available. Defaults to `['cms']`. */
  contexts?: readonly PageBuilderContext[];
  /** Prop keys that support per-breakpoint overrides in the CMS editor. */
  responsiveFields?: readonly string[];
};

export type PageBuilderComponentDefinition = ComponentConfig & ComponentContextMeta;

/**
 * Attach Page Builder metadata to a Puck component config. Metadata is stored
 * on the config object for palette filtering; it does not affect Puck runtime.
 */
export function definePageBuilderComponent(
  definition: PageBuilderComponentDefinition,
): PageBuilderComponentDefinition {
  return enhancePageBuilderComponent({
    contexts: ['cms'],
    ...definition,
  });
}

export function getComponentContexts(config: ComponentConfig): PageBuilderContext[] {
  const meta = config as ComponentContextMeta;
  return [...(meta.contexts ?? ['cms'])];
}

export function getResponsiveFields(config: ComponentConfig): string[] {
  const meta = config as ComponentContextMeta;
  return [...(meta.responsiveFields ?? [])];
}

/** Filter a Puck config palette to components allowed in the given context. */
/**
 * Does a block declared for `declared` appear in the `target` palette?
 *
 * **`contexts` states what a block is *authored for*; appearance is derived**
 * (feature 096, D-10, normative in
 * `specs/096-page-builder-block-ownership/contracts/block-definition.md` §4.1.1).
 * The one admission the platform grants is `email -> newsletter`: every e-mail
 * block is offered in the newsletter palette, and **no block in the tree
 * declares `newsletter`** — that member of `PageBuilderContext` has never had a
 * block of its own.
 *
 * Extracted because the rule was written **twice in this file** and T305's
 * derived palette would have been the third copy — the `text-normalization.ts`
 * discipline, where a rule with two implementations is a rule with two answers
 * waiting to disagree. The two spellings were proved equivalent before the
 * extraction rather than assumed to be: over all 16 subsets of
 * `PageBuilderContext` against all 4 contexts, 64 combinations, **zero
 * divergences** — including `['newsletter']` alone, which the task note
 * predicted would diverge and does not.
 *
 * It is load-bearing on four live editor surfaces — `newsletter`'s `BlocksPage`
 * (twice), `CampaignEditor` and `AutomationBuilder`, all reaching
 * `EmailEditorPane` — so removing the admission empties the palette every
 * campaign, block and automation step is authored against.
 */
export function contextAdmits(
  declared: readonly PageBuilderContext[],
  target: PageBuilderContext,
): boolean {
  if (declared.includes(target)) return true;
  return target === 'newsletter' && declared.includes('email');
}

export function filterConfigByContext(config: Config, context: PageBuilderContext): Config {
  const components: Config['components'] = {};
  for (const [name, component] of Object.entries(config.components ?? {})) {
    if (contextAdmits(getComponentContexts(component), context)) {
      components[name] = component;
    }
  }

  const categories: Config['categories'] = {};
  for (const [key, category] of Object.entries(config.categories ?? {})) {
    const filteredComponents = (category.components ?? []).filter((name) => name in components);
    if (filteredComponents.length > 0) {
      categories[key] = { ...category, components: filteredComponents };
    }
  }

  return { ...config, components, categories };
}

/** Component names disallowed in a context (for slot `disallow` props). */
export function getDisallowedComponentNames(config: Config, context: PageBuilderContext): string[] {
  return Object.keys(config.components ?? {}).filter((name) => {
    const component = config.components![name]!;
    return !contextAdmits(getComponentContexts(component), context);
  });
}
