import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { EventBus } from '../../../src/events/bus.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { Asset } from '../../../src/modules/assets_library/entities/asset.entity.js';
import { AssetReferenceRegistry } from '../../../src/modules/assets_library/services/reference-registry.js';
import { AssetsLibraryService } from '../../../src/modules/assets_library/services/assets-library.service.js';
import { LanguageReferenceRegistry } from '../../../../packages/modules/languages/src/backend/services/language-reference-registry.js';
import { CmsPage } from '../../helpers/package-entities.js';

/**
 * D-68 — an asset a **switched-off** `cms` still references cannot be deleted.
 *
 * `cms`' boot hook reconciled its seeded Hooks (work) and registered the CMS
 * asset-reference scanner (an integrity contribution) in one body. Probing that
 * body — the repair a ratchet whose only advice is "add a presence check at the
 * top" would teach — makes a deployment that boots with `cms` deactivated come
 * up with no CMS scanner, and the Library then soft-deletes an asset a page
 * still embeds. The operator sees a broken page when they switch `cms` back on,
 * which is exactly what Constitution XVII's "off is non-destructive and
 * reversible" forbids.
 *
 * The test composes `cms` **while the module is off**, into a registry of its
 * own, so it enters above the split. A test that only checked the reconcile
 * would pass on the wrong split.
 */
describe('an asset a deactivated cms still references cannot be deleted (D-68)', () => {
  let h: BackendServerHandle;
  let assetId: string;
  let pageId: string;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();

    const asset = em.create(Asset, {
      kind: 'image',
      filename: 'while-off.png',
      mimeType: 'image/png',
      sizeBytes: '0',
      storageUrl: 'https://example.com/while-off.png',
      storageLocator: 'https://example.com/while-off.png',
      storageBackend: 'legacy',
      visibility: 'public',
    });
    await em.persistAndFlush(asset);
    assetId = asset.id;

    const slug = `d68-page-${randomUUID().slice(0, 8)}`;
    const page = em.create(CmsPage, {
      path: slug,
      title: { 'en-US': `D68 page ${slug}` },
      body: {} as Record<string, string>,
      name: `D68 page ${slug}`,
      slug,
      status: 'published',
      active: true,
      content: {
        schema_version: 1,
        languages: {
          'en-US': {
            root: { props: {} },
            content: [{ type: 'LibraryImage', props: { assetId, alt: 'embedded' } }],
          },
        },
      },
      languages: ['en-US'],
    });
    await em.persistAndFlush(page);
    pageId = page.id;
  });

  afterAll(async () => {
    const fresh = h.em().fork({ clear: true });
    await fresh.removeAndFlush(await fresh.findOneOrFail(CmsPage, { id: pageId }));
    await fresh.removeAndFlush(await fresh.findOneOrFail(Asset, { id: assetId }));
    await teardownBackendServer(h);
  });

  /** The Library, wired to a registry this test controls. */
  function libraryOver(registry: AssetReferenceRegistry): AssetsLibraryService {
    return new AssetsLibraryService({
      emFactory: () => h.em(),
      adapters: h.assetsLibrary.adapters,
      referenceRegistry: registry,
      loadUploadPolicy: async () => ({ allowedTypes: ['*'], maxFileSizeMb: 0 }),
    });
  }

  /** Compose `cms` on its own and run its boot hooks, whatever its state. */
  async function bootCmsInto(registry: AssetReferenceRegistry): Promise<void> {
    const { registerModule } = await import('../../../../packages/modules/cms/src/backend/index.js');
    const container = createRootContainer();
    registerValues(container, {
      emFactory: () => h.em(),
      redis: h.redis,
      assetReferenceRegistry: registry,
      // `languages` owns `languageReferenceRegistry` and is not composed here,
      // so the root supplies it exactly as it supplies `assets_library`'. Same
      // shape of contribution and same reason it must survive deactivation: a
      // deactivated page still lists language codes, so `languages` must still
      // refuse to delete one out from under it (feature 077, D-87).
      languageReferenceRegistry: new LanguageReferenceRegistry(),
    });
    const composed = composeModules([{ id: 'cms', version: '1.0.0', registerModule }], {
      container,
      eventBus: new EventBus(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    await composed.runBootHooks();
  }

  it('refuses the delete after booting with the module deactivated', async () => {
    const registry = new AssetReferenceRegistry();

    await withModuleOff('cms', 'deactivated', async () => {
      await bootCmsInto(registry);

      expect(
        registry.owners(),
        'a deployment that boots with `cms` off registered no CMS scanner, so nothing ' +
          'stands between an operator and an asset a deactivated page still embeds',
      ).toContain('cms');

      await expect(libraryOver(registry).softDelete(assetId)).rejects.toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.ASSET_REFERENCED,
      });

      const references = await registry.findReferences(assetId);
      expect(
        references.map((reference) => reference.kind),
        'the refusal must be attributable to the CMS edge, not to some other holder',
      ).toContain('cms_body_embed');
    });
  });

  it('would delete the same asset with no scanner registered — the control', async () => {
    // Negative control (issue #141): a delete failing for an unrelated reason
    // must not read as the protection working.
    const deleted = await libraryOver(new AssetReferenceRegistry()).softDelete(assetId);
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });
});
