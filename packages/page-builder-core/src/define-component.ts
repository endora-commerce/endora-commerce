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
export function filterConfigByContext(config: Config, context: PageBuilderContext): Config {
  const components: Config['components'] = {};
  for (const [name, component] of Object.entries(config.components ?? {})) {
    const contexts = getComponentContexts(component);
    const allowed =
      contexts.includes(context) ||
      (context === 'newsletter' && contexts.includes('email'));
    if (allowed) {
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
    const contexts = getComponentContexts(component);
    if (context === 'newsletter') {
      return !contexts.includes('email') && !contexts.includes('newsletter');
    }
    return !contexts.includes(context);
  });
}
