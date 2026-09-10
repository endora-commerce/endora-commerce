import { describe, expect, it } from 'vitest';
import type {
  AssetDetail,
  AssetRecord,
  AssetStoredKind,
  CatalogCategoryRecord,
  CmsPageRecord,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import {
  resolveCategoryUrl,
  resolveCmsPageUrl,
  resolveMenuAsset,
  resolveMenuBlock,
} from './cross-module-ports.js';

/**
 * The four judgements that used to sit inside `megamenuStorefrontDeps`, a
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
 * **What this file cannot see** is that `backend/index.ts` resolves the five
 * ports at all, or that a menu payload carries what these return. That is
 * `backend/test/integration/megamenu/cross-module-targets.test.ts`, over the
 * composed harness, and it is the one that would have caught the two root
 * divergences this drain found.
 */

const category = (over: Partial<CatalogCategoryRecord> = {}): CatalogCategoryRecord =>
  ({ id: 'c1', slug: 'pumps', isActive: true, deletedAt: null, ...over }) as CatalogCategoryRecord;

const page = (over: Partial<CmsPageRecord> = {}): CmsPageRecord =>
  ({ id: 'p1', slug: 'about-us', ...over }) as CmsPageRecord;

const asset = (kind: AssetStoredKind, label: string | null = 'Hero'): AssetRecord =>
  ({ id: 'a1', kind, label }) as AssetRecord;

const detail = (url: string): AssetDetail => ({ url }) as AssetDetail;

describe('resolveCategoryUrl (T118c)', () => {
  it('builds the storefront category route, which is `/c/<slug>`', async () => {
    // `storefront/app/(catalog)/c/[slug]`. The harness root built
    // `/catalog/<slug>`, which no route serves, and no test read the value —
    // this assertion is what makes the disagreement impossible to have again.
    const url = await resolveCategoryUrl({ findById: async () => category() }, 'c1');
    expect(url).toBe('/c/pumps');
  });

  it('asks for live rows only, and drops a deactivated category', async () => {
    // Two narrowings, one per storage state, and the production root had both:
    // `is_active = true and deleted_at is null`. `liveOnly` is the port's word
    // for the second; the first is this caller's judgement because the record
    // carries the flag.
    const asked: Array<{ liveOnly?: boolean } | undefined> = [];
    const url = await resolveCategoryUrl(
      {
        findById: async (_id, options) => {
          asked.push(options);
          return category({ isActive: false });
        },
      },
      'c1',
    );

    expect(url).toBeNull();
    expect(asked[0]).toEqual({ liveOnly: true });
  });

  it('answers null for a category that is not there', async () => {
    expect(await resolveCategoryUrl({ findById: async () => null }, 'gone')).toBeNull();
  });
});

describe('resolveCmsPageUrl (T118c)', () => {
  it('builds a page URL from the slug at the root of the site', async () => {
    expect(await resolveCmsPageUrl({ findById: async () => page() }, 'p1')).toBe('/about-us');
  });

  it('does not narrow on status or `active`, which is what both roots did', async () => {
    // The asymmetry with the category case is deliberate and pre-existing: a
    // draft or deactivated page keeps its menu item and answers for itself when
    // the shopper follows the link. Changing it is a product decision.
    const url = await resolveCmsPageUrl(
      { findById: async () => page({ status: 'draft', active: false }) },
      'p1',
    );
    expect(url).toBe('/about-us');
  });

  it('answers null for a page that is not there', async () => {
    expect(await resolveCmsPageUrl({ findById: async () => null }, 'gone')).toBeNull();
  });
});

describe('resolveMenuAsset (T118c)', () => {
  it('takes the kind and label from the record and the URL from the library', async () => {
    // Two ports for one asset, and this is why: `AssetRecord` carries the stored
    // kind and no resolved URL, `AssetDetail` carries the URL and no kind.
    const resolved = await resolveMenuAsset(
      {
        assets: { findById: async () => asset('image', 'Hero image') },
        assetLibrary: { getAsset: async () => detail('https://cdn.example.com/hero.png') },
      },
      'a1',
    );

    expect(resolved).toEqual({
      url: 'https://cdn.example.com/hero.png',
      label: 'Hero image',
      kind: 'image',
    });
  });

  it('refuses a stored kind a menu cannot render, without asking for a URL', async () => {
    // The library holds `pdf`, `certificate` and `other` too, and
    // `MegamenuAssetKind` is the narrower pair.
    let urlAsked = 0;
    const resolved = await resolveMenuAsset(
      {
        assets: { findById: async () => asset('pdf') },
        assetLibrary: {
          getAsset: async () => {
            urlAsked += 1;
            return detail('/never');
          },
        },
      },
      'a1',
    );

    expect(resolved).toBeNull();
    expect(urlAsked).toBe(0);
  });

  it('answers null for an asset that is not there, without asking for a URL', async () => {
    let urlAsked = 0;
    const resolved = await resolveMenuAsset(
      {
        assets: { findById: async () => null },
        assetLibrary: {
          getAsset: async () => {
            urlAsked += 1;
            return detail('/never');
          },
        },
      },
      'gone',
    );

    expect(resolved).toBeNull();
    expect(urlAsked).toBe(0);
  });

  it('lets the library’s own refusal through rather than reading it as "no asset"', async () => {
    // No `catch`, deliberately (composition checklist item 7). A tolerance here
    // would absorb `ModuleDisabledError` as well as a 404 and turn an owner's
    // fail-closed refusal into a menu that renders without the tile — and
    // neither composition root caught here either.
    await expect(
      resolveMenuAsset(
        {
          assets: { findById: async () => asset('image') },
          assetLibrary: {
            getAsset: async () => {
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
