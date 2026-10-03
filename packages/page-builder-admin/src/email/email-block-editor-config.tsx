/**
 * How the e-mail editor composes the blocks modules contribute
 * (`specs/141-module-block-renderers/contracts/block-renderers.md` R4.3;
 * plan D8).
 *
 * A module's `./admin` layer contributes, for the `email` context, the
 * `EmailBlockRenderer` of its `./email` layer — **the same function the send
 * path runs**. The host wraps it into a canvas component here, so there is no
 * second, React drawing of an e-mail block that could drift from what is sent,
 * and hands the loaded renderers to the HTML preview.
 *
 * Pure apart from the one `Promise.all`, so the merge is testable without an
 * editor — Puck paints its canvas into an iframe.
 */
import type { ComponentConfig, Config } from '@puckeditor/core';
import { createContext, useContext, type ReactNode } from 'react';
import type { CmsPageBuilderDescriptor } from '@endora-commerce/contracts';
import type { OwnedBlockContribution } from '@endora-commerce/admin-kit/zones';
import { makeMissingComponentConfig } from '@endora-commerce/cms-components';
import {
  renderEmailHtml,
  type EmailBlockRenderer,
  type EmailBlockRenderers,
} from '@endora-commerce/email-components';
import {
  editorConfigFromDescriptor,
  neutralBlockPreview,
  withContributedBlocks,
  type DescriptorBlockSource,
} from '@endora-commerce/page-builder-core/contributions';

/** One served descriptor entry. */
export type DeclaredEmailBlock = CmsPageBuilderDescriptor['components'][number];

/** Where an ignored or failed contribution is said; the pane logs it. */
export type EmailBlockContributionReport = (message: string) => void;

const NO_RENDERERS: EmailBlockRenderers = {};

/**
 * Every contributed renderer the pane loaded, for the two places that draw a
 * tree rather than one node: a block's own slots, and an embedded block or
 * template on the canvas.
 */
const EmailBlockRenderersContext = createContext<EmailBlockRenderers>(NO_RENDERERS);

export const EmailBlockRenderersProvider = EmailBlockRenderersContext.Provider;

export function useEmailBlockRenderers(): EmailBlockRenderers {
  return useContext(EmailBlockRenderersContext);
}

function isRenderer(value: unknown): value is EmailBlockRenderer {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { html?: unknown }).html === 'function'
  );
}

/**
 * The canvas component of one contributed block.
 *
 * It renders through `renderEmailHtml` — one node, this renderer — rather than
 * calling `renderer.html` itself, so the canvas gets exactly the host behaviour
 * the send path has: the renderer's defaults under the stored props, its slots
 * drawn by the host, a throw contained. A throw shows the missing-renderer
 * note instead of an empty row, because on an editing surface an operator has
 * to be able to see that a block is there.
 *
 * `{{…}}` directives are left as written, as the first-party text blocks leave
 * them on the canvas; the HTML preview resolves them against sample values.
 */
export function emailBlockEditorConfig(
  name: string,
  renderer: EmailBlockRenderer,
  entry: DescriptorBlockSource | undefined,
  options: { readonly language: string; readonly accentColor?: string },
): ComponentConfig {
  const separator = name.indexOf('.');
  const failed = makeMissingComponentConfig(name, separator > 0 ? name.slice(0, separator) : '', {
    visible: true,
  });
  const Failed = failed.render as unknown as (props: Record<string, unknown>) => ReactNode;

  function EmailBlockCanvas(props: Record<string, unknown>): ReactNode {
    const loaded = useEmailBlockRenderers();
    let threw = false;
    // Puck's own props are the editor's, not the block's.
    const { puck: _puck, editMode: _editMode, ...stored } = props;
    const html = renderEmailHtml(
      { root: { props: {} }, content: [{ type: name, props: stored }], zones: {} },
      {
        document: false,
        language: options.language,
        ...(options.accentColor !== undefined ? { accentColor: options.accentColor } : {}),
        blockRenderers: { ...loaded, [name]: renderer },
        onBlockError: (failedName) => {
          if (failedName === name) threw = true;
        },
      },
    );
    if (threw) return <Failed {...((failed.defaultProps ?? {}) as Record<string, unknown>)} />;
    return (
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{ borderCollapse: 'collapse' }}
      >
        <tbody dangerouslySetInnerHTML={{ __html: html }} />
      </table>
    );
  }

  return editorConfigFromDescriptor(entry ?? { fields: {} }, {
    render: EmailBlockCanvas as never,
  });
}

export interface LoadedEmailBlockRenderers {
  readonly renderers: EmailBlockRenderers;
  /** The contributing module of each loaded name. */
  readonly owners: Readonly<Record<string, string>>;
}

/**
 * Evaluate the factories of the wanted names, together. One that rejects, or
 * whose default export is not an e-mail renderer, is reported and leaves its
 * block on the declared-fields editor; it never rejects the whole load.
 */
export async function loadEmailBlockRenderers(
  contributions: readonly OwnedBlockContribution[],
  wanted: ReadonlySet<string>,
  report: EmailBlockContributionReport = () => undefined,
): Promise<LoadedEmailBlockRenderers> {
  const renderers: Record<string, EmailBlockRenderer> = {};
  const owners: Record<string, string> = {};
  const selected = contributions.filter((contribution) => wanted.has(contribution.name));

  const settled = await Promise.all(
    selected.map(async (contribution) => {
      try {
        return { contribution, loaded: (await contribution.component()).default, error: null };
      } catch (error) {
        return { contribution, loaded: undefined, error: error ?? new Error('rejected') };
      }
    }),
  );

  for (const { contribution, loaded, error } of settled) {
    const { name, module } = contribution;
    if (error !== null || !isRenderer(loaded)) {
      report(
        `[page-builder] the e-mail renderer module "${module}" contributes for "${name}" ` +
          (error !== null
            ? `failed to load (${error instanceof Error ? error.message : String(error)})`
            : 'does not export an e-mail block renderer as its default export') +
          '; the block is editable from its declared fields and is not previewed.',
      );
      continue;
    }
    if (Object.hasOwn(renderers, name)) continue;
    renderers[name] = loaded;
    owners[name] = module;
  }
  return { renderers, owners };
}

export interface ComposeEmailBlocksInput {
  /** The first-party e-mail components, with the pane's own field customisations. */
  readonly components: Readonly<Record<string, ComponentConfig>>;
  /** The descriptor's entries the pane's context admits. */
  readonly declared: readonly DeclaredEmailBlock[];
  readonly renderers: EmailBlockRenderers;
  readonly owners: Readonly<Record<string, string>>;
  /** The neutral preview's one sentence, already translated. */
  readonly previewSentence: string;
  readonly language: string;
  readonly accentColor?: string;
  readonly report?: EmailBlockContributionReport;
}

export interface ComposedEmailBlocks {
  readonly components: Record<string, ComponentConfig>;
  /**
   * The contributed renderers that were composed — what the HTML preview and
   * the canvas embeds are handed. A renderer that collided with a first-party
   * block, or came from a module the block does not belong to, is not in it.
   */
  readonly blockRenderers: EmailBlockRenderers;
}

/**
 * The pane's component map, with every declared block in it: a contributed one
 * drawn by its renderer, and one nothing contributes a renderer for — an
 * overlay module's, whose renderer exists only in its backend — editable from
 * its declared fields behind a neutral preview.
 */
export function composeEmailBlocks(input: ComposeEmailBlocksInput): ComposedEmailBlocks {
  const report = input.report ?? ((): void => undefined);
  const declaredByName = new Map(input.declared.map((entry) => [entry.name, entry]));

  const byModule = new Map<string, Record<string, ComponentConfig>>();
  for (const [name, renderer] of Object.entries(input.renderers)) {
    const entry = declaredByName.get(name);
    const moduleId = input.owners[name];
    if (entry === undefined || moduleId === undefined) continue;
    const blocks = byModule.get(moduleId) ?? {};
    blocks[name] = emailBlockEditorConfig(name, renderer, entry, {
      language: input.language,
      ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
    });
    byModule.set(moduleId, blocks);
  }

  const contributed = withContributedBlocks(
    { components: input.components } as Config,
    [...byModule].map(([moduleId, blocks]) => ({ moduleId, blocks })),
  );
  for (const { name, moduleId } of contributed.collisions) {
    report(
      `[page-builder] module "${String(moduleId)}" contributes an e-mail renderer for "${name}", ` +
        'which the e-mail editor already renders; the existing renderer was kept.',
    );
  }
  for (const { name, moduleId } of contributed.foreign) {
    report(
      `[page-builder] module "${String(moduleId)}" contributes an e-mail renderer for "${name}", ` +
        'a block it does not own; the contribution was ignored.',
    );
  }

  const blockRenderers: Record<string, EmailBlockRenderer> = {};
  for (const name of contributed.added) {
    blockRenderers[name] = input.renderers[name] as EmailBlockRenderer;
  }

  const components = { ...(contributed.config.components as Record<string, ComponentConfig>) };
  for (const entry of input.declared) {
    if (Object.hasOwn(components, entry.name)) continue;
    components[entry.name] = editorConfigFromDescriptor(entry, {
      render: neutralBlockPreview(entry.name, input.previewSentence) as never,
    });
  }
  return { components, blockRenderers };
}
