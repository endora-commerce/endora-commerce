import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { resolve } from 'node:path';
import { StrictMode, type ReactElement } from 'react';
import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react';
import type { Data } from '@puckeditor/core';
import { manifest as blogManifest } from '@endora-commerce/mod-blog';
import { manifest as catalogManifest } from '@endora-commerce/mod-catalog';
import { manifest as cmsManifest } from '@endora-commerce/mod-cms';
import { manifest as newsletterManifest } from '@endora-commerce/mod-newsletter';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { PageBuilderEditor } from '../../../../packages/modules/cms/src/admin/components/PageBuilderEditor';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163, Phase 13a — the **real** CMS page-builder editor, mounted in
 * jsdom: `PageBuilderEditor` itself, its Puck, its drawer and field overrides,
 * over a descriptor read off the four modules' own manifests (the blocks this
 * feature added or reshaped live in `cms`, `catalog`, `blog` and
 * `newsletter`). Not a test file: the three editor tests share it.
 *
 * Puck paints its canvas into an iframe jsdom does not lay out, so a block is
 * selected through the editor's own outline, which is outside the iframe.
 * The test file mocks `apiClient` (a `vi.mock` is per file) and hands it to
 * {@link stubEditorApi}.
 */

type ManifestBlock = { name: string; contexts?: readonly string[] } & Record<string, unknown>;
type ManifestCategory = Record<string, unknown>;
interface BlockManifest {
  blocks?: readonly ManifestBlock[];
  blockCategories?: readonly ManifestCategory[];
}

const OWNERS: ReadonlyArray<readonly [string, BlockManifest]> = [
  ['cms', cmsManifest as unknown as BlockManifest],
  ['catalog', catalogManifest as unknown as BlockManifest],
  ['blog', blogManifest as unknown as BlockManifest],
  ['newsletter', newsletterManifest as unknown as BlockManifest],
];

/** What `GET /api/v1/admin/cms/page-builder/config` answers for a platform composing these four modules. */
export function editorDescriptor(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    components: OWNERS.flatMap(([ownerModule, manifest]) =>
      (manifest.blocks ?? []).map((block) => ({ fields: {}, ...block, ownerModule })),
    ),
    categories: OWNERS.flatMap(([ownerModule, manifest]) =>
      (manifest.blockCategories ?? []).map((category) => ({ ...category, ownerModule })),
    ),
  };
}

/** The shipped bundles of the scopes the editor reads, in one language. */
export function shippedBundles(language: 'en' | 'pl'): Bundle {
  const read = (moduleDir: string): Record<string, string> =>
    JSON.parse(
      readFileSync(resolve(process.cwd(), `../packages/modules/${moduleDir}/i18n/${language}.json`), 'utf8'),
    ) as Record<string, string>;
  return {
    core: read('_i18n'),
    cms: read('cms'),
    catalog: read('catalog'),
    blog: read('blog'),
    newsletter: read('newsletter'),
  } as Bundle;
}

interface ApiStub {
  get: { mockImplementation: (fn: (url: string) => Promise<unknown>) => unknown };
}

/** Answers the editor's reads: the descriptor, and empty block and template lists. */
export function stubEditorApi(apiClient: ApiStub): void {
  apiClient.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/admin/cms/page-builder/config')) return { data: editorDescriptor() };
    return { data: [] };
  });
}

export interface MountedEditor extends RenderResult {
  /** The latest document the editor reported through `onChange`. */
  latest: () => Data | null;
}

/** Mounts `PageBuilderEditor` over `data`, in `<StrictMode>`, signed in, in `language`. */
export async function mountPageBuilderEditor(
  data: Data,
  { language = 'en' }: { language?: 'en' | 'pl' } = {},
): Promise<MountedEditor> {
  let latest: Data | null = null;
  const ui: ReactElement = (
    <StrictMode>
      <TranslationProvider language={language} initialBundle={shippedBundles(language)}>
        {withSession(
          <PageBuilderEditor
            data={data}
            contentKey="pb163-harness"
            onChange={(next): void => {
              latest = next;
            }}
          />,
          {
            session: adminSession({ permissions: ['*'], preferredLanguage: language }),
            presence: modulePresence({ present: ['cms', 'catalog', 'blog', 'newsletter'] }),
          },
        )}
      </TranslationProvider>
    </StrictMode>
  );
  const view = render(ui);
  await waitFor(() => expect(outlineButtons().length).toBeGreaterThan(0), { timeout: 10_000 });
  return Object.assign(view, { latest: () => latest });
}

/** The outline's item buttons, in document order (the first outline only). */
export function outlineButtons(): HTMLButtonElement[] {
  const root = document.querySelector('.pb-outline-list--root');
  return root ? [...root.querySelectorAll<HTMLButtonElement>('button.pb-outline-item__label')] : [];
}

/** Selects the `index`-th outline item and waits for its field panel. */
export async function selectOutlineItem(index: number): Promise<void> {
  const button = outlineButtons()[index];
  if (!button) throw new Error(`no outline item at ${index}`);
  await act(async () => {
    fireEvent.click(button);
  });
  await waitFor(() => expect(fieldsPanel()).not.toBeNull());
  // `resolveFields` is asynchronous in Puck; let it settle.
  await act(async () => {
    await new Promise((settle) => setTimeout(settle, 50));
  });
}

/**
 * The selected block's field panel: every tab's fields (the inactive tabs are
 * only hidden). A block with no responsive, data or items field has no tab
 * bar, so Puck's own fields container is the fallback.
 */
export function fieldsPanel(): HTMLElement | null {
  const tablist = document.querySelector('[role="tablist"][aria-label="Component settings"]');
  if (tablist?.parentElement) return tablist.parentElement;
  return document.querySelector<HTMLElement>('[class*="_PuckFields_"]');
}

