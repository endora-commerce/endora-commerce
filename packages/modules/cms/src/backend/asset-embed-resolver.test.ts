import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { AssetDetail, AssetsLibraryPort } from '@endora-commerce/contracts';
import { EventBus } from '@endora-commerce/platform/events';
import {
  composeModules,
  createRootContainer,
  registerValues,
} from '@endora-commerce/platform/composition';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import type { CmsAssetResolver } from './services/storefront-resolver.js';

/**
 * `specs/110-instance-repository/` T118c — `cmsAssetResolver` is the module's
 * own registration over `assetsLibraryPort`, not a composition root's closure.
 *
 * It was a contribution point: `composition.ts` built the closure out of
 * `assetsLibrary.handle.service` and `cms` defaulted the name to `undefined`.
 * **`test-server.ts` contributed nothing**, so every CMS storefront response in
 * the whole test suite resolved its asset embeds to `{}` — the failure mode this
 * module's own barrel already records for its four late-bound setters ("the
 * endpoint that only worked in production"), one seam further on and never
 * caught, because an empty asset map is a plausible answer rather than a wrong
 * one.
 *
 * The three cases below are the whole of what the drained registration owes: the
 * mapping, the tolerance, and the one error the tolerance may not absorb.
 *
 * Co-located beside its subject (`specs/106-module-owned-tests/` §2): it names one
 * module, boots no server, and reaches nothing outside this package but
 * `@endora-commerce/contracts` and the platform (§3).
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

describe('T118c — cms resolves its own asset embeds through assetsLibraryPort', () => {
  it('maps the port’s AssetDetail onto the embed shape', async () => {
    const resolver = await composedResolver({
      getAsset: async () => DETAIL,
    });

    expect(await resolver(DETAIL.id)).toEqual({
      url: '/media/hero.png',
      mimeType: 'image/png',
      filename: 'hero.png',
      label: 'Hero image',
      visibility: 'public',
    });
  });

  it('answers null for an asset the library no longer has', async () => {
    // The narrow tolerance the root's closure already carried: a page embedding
    // a deleted asset renders without it. `getAsset` throws 404 for a row that
    // is gone, and a CMS page is not the place that failure is reported.
    const resolver = await composedResolver({
      getAsset: async () => {
        throw new HttpError(404, 'ASSET_NOT_FOUND', 'Asset not found.');
      },
    });

    expect(await resolver(DETAIL.id)).toBeNull();
  });

  it('re-throws ModuleDisabledError rather than reading it as “no asset”', async () => {
    // Composition checklist item 7. `assets_library` is `nonDeactivatable`, so
    // this cannot happen on a running platform today — which is exactly why the
    // assertion is here: the day that manifest changes, a bare `catch` turns
    // fail-closed into an asset silently missing from every page.
    const resolver = await composedResolver({
      getAsset: async () => {
        throw new ModuleDisabledError('assets_library');
      },
    });

    await expect(resolver(DETAIL.id)).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});

/** Builds the resolver over a stub port carrying only the method it calls. */
async function composedResolver(port: Pick<AssetsLibraryPort, 'getAsset'>): Promise<CmsAssetResolver> {
  const { registerModule } = await import('./index.js');
  const container = createRootContainer();
  registerValues(container, {
    emFactory: (): EntityManager => ({}) as EntityManager,
    redis: {} as Redis,
    resolvedModuleRegistry: [],
    assetsLibraryPort: port,
  });
  composeModules([{ id: 'cms', version: '1.0.0', registerModule }], {
    container,
    eventBus: new EventBus(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  return (container.cradle as unknown as { cmsAssetResolver: CmsAssetResolver }).cmsAssetResolver;
}
