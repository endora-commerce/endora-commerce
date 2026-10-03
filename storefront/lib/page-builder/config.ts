import type { ComponentConfig, Config } from '@puckeditor/core';
import {
  defaultPageBuilderConfig,
  makeMissingComponentConfig,
  withCmsPageRoot,
} from '@endora-commerce/cms-components';
import {
  withBlockBoundary,
  withContributedBlocks,
  withPresence,
  type BlockPresence,
  type IgnoredBlockContribution,
  type StorefrontContributions,
} from '@endora-commerce/page-builder-core/contributions';

import { STOREFRONT_BLOCK_CONTRIBUTIONS } from './blocks.generated';
import { localBlocks } from './local-blocks';

/**
 * The Page Builder configuration this storefront renders with — the one place
 * its blocks are composed (`specs/141-module-block-renderers/contracts/block-renderers.md`
 * §5.2.1), and the only file here that names `defaultPageBuilderConfig`.
 *
 * The order is the design, and each step is a pure function with its own test
 * in `@endora-commerce/page-builder-core`:
 *
 *  1. the platform's renderers;
 *  2. the storefront layers of the module packages this storefront installed
 *     (`blocks.generated.ts`). A name already rendered is **kept**; a name
 *     whose owner segment is not the contributing module is **dropped**;
 *  3. this storefront's own `local-blocks.tsx`, under the first of those rules;
 *  4. every contributed and local block is wrapped so that a failure costs the
 *     page that one block, and so it receives its `defaultProps` under the
 *     stored props;
 *  5. **presence** — every block whose owner module the backend reports as not
 *     present becomes the missing-renderer placeholder, first-party blocks
 *     included: an empty span for a customer, the note in preview.
 *
 * This file is storefront-owned: the scaffold copies it and it belongs to the
 * storefront's owner afterwards.
 */

export interface ComposeStorefrontConfigInput {
  readonly base: Config;
  readonly packages: readonly {
    readonly moduleId: string;
    readonly contributions: StorefrontContributions;
  }[];
  readonly local: StorefrontContributions['blocks'];
  readonly presence: BlockPresence;
  /** `true` shows the missing-renderer note in place of a block nothing draws. */
  readonly preview: boolean;
}

export interface ComposedStorefrontConfig {
  readonly config: Config;
  /** Contributions that were not composed, for the caller to say so. */
  readonly ignored: readonly (IgnoredBlockContribution & { readonly reason: 'collision' | 'foreign' })[];
}

/** Steps 1–5, as a pure function of what is installed and who is present. */
export function composeStorefrontConfig(
  input: ComposeStorefrontConfigInput,
): ComposedStorefrontConfig {
  const placeholder = (name: string, owner: string): ComponentConfig =>
    makeMissingComponentConfig(name, owner, input.preview ? { visible: true } : {});

  const contributed = withContributedBlocks(input.base, [
    ...input.packages.map((entry) => ({
      moduleId: entry.moduleId,
      blocks: entry.contributions.blocks as Record<string, ComponentConfig> | undefined,
    })),
    { moduleId: null, blocks: input.local as Record<string, ComponentConfig> | undefined },
  ]);

  const components = {
    ...((contributed.config.components ?? {}) as Record<string, ComponentConfig>),
  };
  for (const name of contributed.added) {
    const separator = name.indexOf('.');
    const owner = separator > 0 ? name.slice(0, separator) : '';
    components[name] = withBlockBoundary(components[name] as ComponentConfig, placeholder(name, owner), {
      onError: (error) => reportOnce(`[page-builder] block "${name}" failed to render: ${describe(error)}`),
    });
  }

  return {
    config: withPresence({ ...contributed.config, components } as Config, input.presence, placeholder),
    ignored: [
      ...contributed.collisions.map((entry) => ({ ...entry, reason: 'collision' as const })),
      ...contributed.foreign.map((entry) => ({ ...entry, reason: 'foreign' as const })),
    ],
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One line per distinct problem per process: this runs on every render. */
const reported = new Set<string>();
function reportOnce(message: string): void {
  if (reported.has(message)) return;
  reported.add(message);
  console.warn(message);
}

export interface StorefrontPageBuilderOptions {
  readonly presence: BlockPresence;
  /** Wrap content in the CMS page max-width shell (storefront pages only). */
  readonly pageContainer?: boolean;
  readonly preview?: boolean;
}

/** The configuration a render site hands to Puck's `<Render>`. */
export function storefrontPageBuilderConfig(options: StorefrontPageBuilderOptions): Config {
  const composed = composeStorefrontConfig({
    base: defaultPageBuilderConfig,
    packages: STOREFRONT_BLOCK_CONTRIBUTIONS,
    local: localBlocks,
    presence: options.presence,
    preview: options.preview ?? false,
  });
  for (const { name, moduleId, reason } of composed.ignored) {
    const who = moduleId === null ? 'lib/page-builder/local-blocks.tsx' : `module "${moduleId}"`;
    reportOnce(
      reason === 'collision'
        ? `[page-builder] ${who} offers a renderer for "${name}", which this storefront already renders; the existing renderer was kept.`
        : `[page-builder] ${who} offers a renderer for "${name}", a block it does not own; it was ignored.`,
    );
  }
  return options.pageContainer === true ? withCmsPageRoot(composed.config) : composed.config;
}
