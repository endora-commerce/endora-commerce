import { describe, expect, it } from 'vitest';
import type { AssetRecord, AssetStoredKind } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { resolveMenuAsset, resolveMenuBlock } from './cross-module-ports.js';

/**
 * The judgements that used to sit inside `megamenuStorefrontDeps`, a
 * composition root's contribution written twice and not identically
 * (`specs/110-instance-repository/` T118c).
 *
 * **It composes nothing, deliberately**, for the reason
 * `packages/modules/cms/src/backend/services/asset-embed-resolver.test.ts`
 * records: a module package's test naming `@endora-commerce/platform/composition`
 * is a host-internal reach `check:platform-surface` cannot refuse in a `.test.ts`,
 * and that silence is a registered blind spot rather than a permission. Each
 * function is a function of its ports, so a stub is the whole harness.
 *
 * The category and page URL judgements left this file with feature 168: a
 * menu's category links read one catalogue index (`category-tree.test.ts`) and
 * its page links the page's address in the served language (`cms`'
 * `pageStorefrontLinks`, `page-paths.test.ts`).
 *
 * **What this file cannot see** is that `backend/index.ts` resolves the five
 * ports at all, or that a menu payload carries what these return. That is
 * `backend/test/integration/megamenu/cross-module-targets.test.ts`, over the
 * composed harness, and it is the one that would have caught the two root
 * divergences this drain found.
 */

const asset = (kind: AssetStoredKind, label: string | null = 'Hero'): AssetRecord =>
  ({ id: 'a1', kind, label }) as AssetRecord;

/** The URL read, answering `url` for every id it is asked about and counting the asks. */
function urls(url: string | null) {
  const asked: string[][] = [];
  return {
    asked,
    resolveUrls: async (ids: readonly string[]) => {
      asked.push([...ids]);
      return new Map(url === null ? [] : ids.map((id) => [id, url] as const));
    },
  };
}

/** The menu reads one asset by id; visibility of a list is not what these cases test. */
const everyAssetVisible = async (ids: readonly string[]): Promise<ReadonlySet<string>> => new Set(ids);

describe('resolveMenuAsset (T118c)', () => {
  it('takes the kind and label from the record and the URL from the batched read', async () => {
    // Two reads for one asset, and this is why: `AssetRecord` carries the stored
    // kind and no resolved URL. The URL is `resolveUrls`, not `getAsset`, whose
    // detail walks every page, block and menu for its "used by" list (issue #685).
    const read = urls('https://cdn.example.com/hero.png');
    const resolved = await resolveMenuAsset(
      { assets: { findById: async () => asset('image', 'Hero image'), visibleToCaller: everyAssetVisible, ...read } },
      'a1',
    );
    expect(read.asked).toEqual([['a1']]);

    expect(resolved).toEqual({
      url: 'https://cdn.example.com/hero.png',
      label: 'Hero image',
      kind: 'image',
    });
  });

  it('refuses a stored kind a menu cannot render, without asking for a URL', async () => {
    // The library holds `pdf`, `certificate` and `other` too, and
    // `MegamenuAssetKind` is the narrower pair.
    const read = urls('/never');
    const resolved = await resolveMenuAsset(
      { assets: { findById: async () => asset('pdf'), visibleToCaller: everyAssetVisible, ...read } },
      'a1',
    );

    expect(resolved).toBeNull();
    expect(read.asked).toEqual([]);
  });

  it('answers null for an asset that is not there, without asking for a URL', async () => {
    const read = urls('/never');
    const resolved = await resolveMenuAsset(
      { assets: { findById: async () => null, visibleToCaller: everyAssetVisible, ...read } },
      'gone',
    );

    expect(resolved).toBeNull();
    expect(read.asked).toEqual([]);
  });

  it('answers null when the library has no URL for the asset', async () => {
    const resolved = await resolveMenuAsset(
      { assets: { findById: async () => asset('image'), visibleToCaller: everyAssetVisible, ...urls(null) } },
      'a1',
    );

    expect(resolved).toBeNull();
  });

  it('lets the library’s own refusal through rather than reading it as "no asset"', async () => {
    // No `catch`, deliberately (composition checklist item 7). A tolerance here
    // would absorb `ModuleDisabledError` as well as a 404 and turn an owner's
    // fail-closed refusal into a menu that renders without the tile — and
    // neither composition root caught here either.
    await expect(
      resolveMenuAsset(
        {
          assets: {
            findById: async () => asset('image'),
            visibleToCaller: everyAssetVisible,
            resolveUrls: async () => {
              throw new ModuleDisabledError('assets_library');
            },
          },
        },
        'a1',
      ),
    ).rejects.toBeInstanceOf(HttpError);
  });
});

describe('resolveMenuBlock (T118c)', () => {
  it('wraps the tree in this module’s own wire envelope', async () => {
    // `schemaVersion` is `megamenuResolvedBlockSchema`'s and not the CMS
    // envelope's deprecated `schema_version`, which is normalized away on read.
    const resolved = await resolveMenuBlock(
      {
        findById: async () => null,
        findLocalizedById: async (id, language) => ({
          id,
          code: 'hero',
          language,
          data: { content: [{ type: 'cms.Heading' }] },
        }),
      },
      'b1',
      'pl-PL',
    );

    expect(resolved).toEqual({
      id: 'b1',
      code: 'hero',
      language: 'pl-PL',
      content: { schemaVersion: 1, data: { content: [{ type: 'cms.Heading' }] } },
    });
  });

  it('answers null when the CMS has nothing to inline', async () => {
    // One null for three states — no block, a deactivated one, a language it
    // carries nothing for — because the caller drops the item in all three.
    const resolved = await resolveMenuBlock(
      { findById: async () => null, findLocalizedById: async () => null },
      'b1',
      'en-US',
    );
    expect(resolved).toBeNull();
  });
});
