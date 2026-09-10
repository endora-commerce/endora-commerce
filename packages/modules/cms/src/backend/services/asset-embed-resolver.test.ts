import { describe, expect, it } from 'vitest';
import type { AssetDetail, AssetsLibraryPort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { createAssetEmbedResolver } from './asset-embed-resolver.js';

/**
 * `specs/110-instance-repository/` T118c — the mapping `cms` registers over
 * `assetsLibraryPort`, drained out of a composition root.
 *
 * Three cases, which are the whole of what the function owes: the mapping, the
 * tolerance, and the one error the tolerance may not absorb.
 *
 * **It composes nothing, deliberately.** An earlier draft built a real container
 * to reach the registration, which meant a module package's test naming
 * `@endora-commerce/platform/composition` — a host-internal subpath no module may
 * name, and one `check:platform-surface` cannot refuse here because
 * `collectPlatformSurfaceSources` drops `.test.ts` outright. That exclusion was
 * written when module packages had no tests; `specs/106-module-owned-tests/` has
 * since put 211 of them here, so the silence is a blind spot rather than a
 * permission, and this would have been the tree's first precedent for it. Making
 * the resolver a function of the port removes the need instead of working around
 * the check.
 *
 * **What this file cannot see** is that `backend/index.ts` wires the registration
 * at all — which is the half the defect lived in. That is
 * `backend/test/contract/cms/storefront-asset-embed.contract.test.ts`, over the
 * composed harness, and it is the one to keep.
 */

const DETAIL: AssetDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  folderId: null,
  filename: 'hero.png',
  label: 'Hero image',
  mimeType: 'image/png',
  sizeBytes: 2048,
  visibility: 'public',
  storageBackend: 'local',
  url: '/media/hero.png',
  createdAt: '2026-09-09T10:00:00.000Z',
  updatedAt: '2026-09-09T10:00:00.000Z',
  deletedAt: null,
  pendingCleanup: false,
  altText: null,
  references: [],
};

function resolverOver(getAsset: AssetsLibraryPort['getAsset']) {
  return createAssetEmbedResolver({ getAsset });
}

describe('T118c — the CMS asset embed resolver', () => {
  it('maps the port’s AssetDetail onto the embed shape', async () => {
    const resolve = resolverOver(async () => DETAIL);

    expect(await resolve(DETAIL.id)).toEqual({
      url: '/media/hero.png',
      mimeType: 'image/png',
      filename: 'hero.png',
      label: 'Hero image',
      visibility: 'public',
    });
  });

  it('answers null for an asset the library no longer has', async () => {
    // The narrow tolerance the root's closure already carried: a page embedding a
    // deleted asset renders without it. `getAsset` throws 404 for a row that is
    // gone, and a CMS page is not the place that failure is reported.
    const resolve = resolverOver(async () => {
      throw new HttpError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
    });

    expect(await resolve(DETAIL.id)).toBeNull();
  });

  it('re-throws ModuleDisabledError rather than reading it as “no asset”', async () => {
    // Composition checklist item 7. `assets_library` is `nonDeactivatable`, so this
    // cannot happen on a running platform today — which is exactly why the assertion
    // is here: the day that manifest changes, a bare `catch` turns fail-closed into
    // an asset silently missing from every page.
    const resolve = resolverOver(async () => {
      throw new ModuleDisabledError('assets_library');
    });

    await expect(resolve(DETAIL.id)).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});
