import { Asset } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { randomUUID } from 'node:crypto';

import { ERROR_CODES } from '@endora-commerce/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { withModuleOff } from '../../helpers/off-state.js';

import { EventBus } from '@endora-commerce/platform/events';

import { createRootContainer, registerValues } from '@endora-commerce/platform/composition';

import { composeModules } from '@endora-commerce/platform/composition';

import type { EntityManager } from '@mikro-orm/postgresql';
import { AssetReferenceRegistry } from '../../../../packages/modules/assets_library/src/backend/services/reference-registry.js';

import { AssetsLibraryService } from '../../../../packages/modules/assets_library/src/backend/services/assets-library.service.js';
import { AssetVisibility } from '../../../../packages/modules/assets_library/src/backend/services/asset-visibility.js';

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
    await em.persist(asset).flush();
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
    await em.persist(page).flush();
    pageId = page.id;
  });

  afterAll(async () => {
    const fresh = h.em().fork({ clear: true });
    await fresh.remove(await fresh.findOneOrFail(CmsPage, { id: pageId })).flush();
    await fresh.remove(await fresh.findOneOrFail(Asset, { id: assetId })).flush();
    await teardownBackendServer(h);
  });

  /** The Library, wired to a registry this test controls. */
  function libraryOver(registry: AssetReferenceRegistry): AssetsLibraryService {
    return new AssetsLibraryService({
      emFactory: () => h.em(),
      adapters: h.assetsLibrary.adapters,
      referenceRegistry: registry,
      // Feature 166: the library's visibility rule over the same registry, for the
      // system actor — this test is about enumeration, which no reader narrows.
      visibility: new AssetVisibility({
        registry: registry,
        isPresent: () => true,
        permissions: () => ({ listPermissions: async () => [] }),
        tenantContext: () => ({ actor: { kind: 'system' } }),
      }),
      loadUploadPolicy: async () => ({ allowedTypes: ['*'], maxFileSizeMb: 0 }),
    });
  }

  /** Compose `cms` on its own and run its boot hooks, whatever its state. */
  async function bootCmsInto(
    registry: AssetReferenceRegistry,
    emFactory: () => EntityManager = () => h.em(),
  ): Promise<void> {
    const { registerModule } = await import('../../../../packages/modules/cms/src/backend/index.js');
    const container = createRootContainer();
    registerValues(container, {
      emFactory,
      redis: h.redis,
      assetReferenceRegistry: registry,
      // `languages` owns `languageReferenceRegistry` and is not composed here,
      // so the root supplies it exactly as it supplies `assets_library`'. Same
      // shape of contribution and same reason it must survive deactivation: a
      // deactivated page still lists language codes, so `languages` must still
      // refuse to delete one out from under it (feature 077, D-87).
      languageReferenceRegistry: new LanguageReferenceRegistry(),
      // Feature 120 (FR-015) — the kernel's channel-bridge registry, on the
      // same terms: `cms` declares `sales_channel_cms_pages` from a third
      // contribution hook, and this composition has no platform to hand it one.
      // A plain collector, because the subject here is the asset scanner.
      salesChannelBridgeRegistry: { register: () => undefined },
      // Feature 151 — `settings`' write-validator registry, which `cms` pushes
      // its translation size-limit rule into from a fourth contribution hook.
      // `settings` is not composed here either, so a plain collector again.
      settingWriteValidatorRegistry: { register: () => undefined, forCode: () => [] },
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

  // Feature 166, research R-6 — attribution holds while the owner is off:
  // the registry honours the scanner, and a batch is answered in one statement
  // per descriptor, each hit tagged with the asset it points at.
  it('attributes a two-asset batch while the module is deactivated', async () => {
    let statements = 0;
    const counting = (): EntityManager =>
      new Proxy(h.em(), {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== 'function') return value;
          const fn = value as (...args: unknown[]) => unknown;
          if (prop === 'execute') {
            return (...args: unknown[]) => {
              statements += 1;
              return fn.apply(target, args);
            };
          }
          return fn.bind(target);
        },
      });
    const registry = new AssetReferenceRegistry();
    const unused = randomUUID();

    await withModuleOff('cms', 'deactivated', async () => {
      await bootCmsInto(registry, counting);
      const out = await registry.findReferencesMany([assetId, unused]);

      expect(statements, 'one statement per descriptor for the whole batch').toBe(1);
      expect(out.get(assetId)).toEqual([expect.objectContaining({ kind: 'cms_body_embed', assetId })]);
      expect(out.get(unused)).toEqual([]);
    });
  });

  it('would delete the same asset with no scanner registered — the control', async () => {
    // Negative control (issue #141): a delete failing for an unrelated reason
    // must not read as the protection working.
    const deleted = await libraryOver(new AssetReferenceRegistry()).softDelete(assetId);
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });
});
