/**
 * How the CMS editor composes the blocks the descriptor declares
 * (`specs/141-module-block-renderers/contracts/block-renderers.md` §4, R4.2;
 * plan D8).
 *
 * Three populations meet in the editor's Puck config, and this file is the
 * second of them:
 *
 *  1. the renderers this bundle carries (`defaultPageBuilderConfig`);
 *  2. **the blocks the descriptor declares for this context that the bundle
 *     does not render** — a module package's, an overlay module's. A present
 *     module that contributes an editor renderer gets it, wrapped so that its
 *     failure costs one block; a block nothing renders gets an editor built
 *     from its declared fields with a neutral preview, where it used to get a
 *     placeholder nobody could edit;
 *  3. the names a stored document carries that neither covers — a switched-off
 *     module's — which `withMissingBlockPlaceholders` degrades, unchanged.
 *
 * Presence is not decided here. The descriptor is presence-filtered by the
 * registry that serves it and `useBlockContributions` filters the
 * contributions, so by the time a name reaches this file both of its halves
 * belong to a module that is on.
 *
 * Pure apart from the one `Promise.all`, and React-free, so the merge is
 * testable without an editor — Puck paints its canvas into an iframe.
 */
import type { ComponentConfig, Config } from '@puckeditor/core';
import type { CmsPageBuilderDescriptor } from '@endora-commerce/contracts';
import type { OwnedBlockContribution } from '@endora-commerce/admin-kit/zones';
import { makeMissingComponentConfig } from '@endora-commerce/cms-components';
import {
  editorConfigFromDescriptor,
  neutralBlockPreview,
  withBlockBoundary,
  withContributedBlocks,
  type PageBuilderBlockEditorConfig,
} from '@endora-commerce/page-builder-core/contributions';

/** One served descriptor entry. */
export type DeclaredBlock = CmsPageBuilderDescriptor['components'][number];

/** Where an ignored or failed contribution is said; the editor logs it. */
export type BlockContributionReport = (message: string) => void;

/** The declared names the bundle does not render — the ones worth a factory. */
export function namesToLoad(
  declared: readonly DeclaredBlock[],
  bundled: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  return new Set(
    declared.map((entry) => entry.name).filter((name) => !Object.hasOwn(bundled, name)),
  );
}

function isEditorConfig(value: unknown): value is PageBuilderBlockEditorConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { render?: unknown }).render === 'function'
  );
}

export interface LoadedBlockEditors {
  /** The editor configs that loaded, keyed by block name. */
  readonly editors: Readonly<Record<string, PageBuilderBlockEditorConfig>>;
  /** The contributing module of each loaded name. */
  readonly owners: Readonly<Record<string, string>>;
  /** Names whose factory rejected or exported something that is not an editor config. */
  readonly failed: readonly string[];
}

/**
 * Evaluate the factories of the wanted names, together.
 *
 * A factory that rejects — a chunk that failed to load, a module that threw on
 * evaluation — leaves its block on the declared-fields editor and is reported;
 * it never rejects the whole load, because one module's broken chunk must not
 * cost the operator the editor.
 */
export async function loadBlockEditors(
  contributions: readonly OwnedBlockContribution[],
  wanted: ReadonlySet<string>,
  report: BlockContributionReport = () => undefined,
): Promise<LoadedBlockEditors> {
  const editors: Record<string, PageBuilderBlockEditorConfig> = {};
  const owners: Record<string, string> = {};
  const failed: string[] = [];
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
    if (error !== null || !isEditorConfig(loaded)) {
      failed.push(name);
      report(
        `[page-builder] the editor renderer module "${module}" contributes for "${name}" ` +
          (error !== null
            ? `failed to load (${error instanceof Error ? error.message : String(error)})`
            : 'does not export a Page Builder editor config as its default export') +
          '; the block is editable from its declared fields.',
      );
      continue;
    }
    if (Object.hasOwn(editors, name)) continue;
    editors[name] = loaded;
    owners[name] = module;
  }
  return { editors, owners, failed };
}

export interface ComposeDeclaredBlocksInput {
  /** The renderers the bundle carries, with the editor's own field customisations. */
  readonly components: Readonly<Record<string, ComponentConfig>>;
  /** The descriptor's entries for this editor's context. */
  readonly declared: readonly DeclaredBlock[];
  readonly editors: Readonly<Record<string, PageBuilderBlockEditorConfig>>;
  /** The contributing module of each entry of `editors`. */
  readonly owners: Readonly<Record<string, string>>;
  /** The neutral preview's one sentence, already translated. */
  readonly previewSentence: string;
  readonly report?: BlockContributionReport;
}

/**
 * The editor's component map, with every declared block in it.
 *
 * A name the bundle already renders is kept exactly as it is — a contribution
 * never replaces a renderer (FR-010) — and so is a contribution from a module
 * the name does not belong to. Both are reported.
 */
export function composeDeclaredBlocks(
  input: ComposeDeclaredBlocksInput,
): Record<string, ComponentConfig> {
  const report = input.report ?? ((): void => undefined);
  const declaredByName = new Map(input.declared.map((entry) => [entry.name, entry]));

  // One entry per contributing module, so the owner rule is the shared one.
  const byModule = new Map<string, Record<string, ComponentConfig>>();
  for (const [name, editor] of Object.entries(input.editors)) {
    const entry = declaredByName.get(name);
    const moduleId = input.owners[name];
    if (entry === undefined || moduleId === undefined) continue;
    const blocks = byModule.get(moduleId) ?? {};
    blocks[name] = withBlockBoundary(
      editorConfigFromDescriptor(entry, editor),
      makeMissingComponentConfig(name, entry.ownerModule, { visible: true }),
      {
        onError: (error) =>
          report(
            `[page-builder] the editor renderer of "${name}" (module "${moduleId}") threw: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          ),
      },
    );
    byModule.set(moduleId, blocks);
  }

  const contributed = withContributedBlocks(
    { components: input.components } as Config,
    [...byModule].map(([moduleId, blocks]) => ({ moduleId, blocks })),
  );
  for (const { name, moduleId } of contributed.collisions) {
    report(
      `[page-builder] module "${String(moduleId)}" contributes an editor renderer for "${name}", ` +
        'which this admin already renders; the existing renderer was kept.',
    );
  }
  for (const { name, moduleId } of contributed.foreign) {
    report(
      `[page-builder] module "${String(moduleId)}" contributes an editor renderer for "${name}", ` +
        'a block it does not own; the contribution was ignored.',
    );
  }

  const components = { ...(contributed.config.components as Record<string, ComponentConfig>) };
  for (const entry of input.declared) {
    if (Object.hasOwn(components, entry.name)) continue;
    components[entry.name] = editorConfigFromDescriptor(entry, {
      render: neutralBlockPreview(entry.name, input.previewSentence) as never,
    });
  }
  return components;
}
