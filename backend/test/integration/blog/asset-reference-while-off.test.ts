import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { EventBus } from '../../../src/events/bus.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { AssetReferenceRegistry } from '../../../src/modules/assets_library/services/reference-registry.js';
import { AssetsLibraryService } from '../../../src/modules/assets_library/services/assets-library.service.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { LanguageReferenceRegistry } from '../../../src/modules/languages/services/language-reference-registry.js';

/**
 * D-68 — an asset a **switched-off** `blog` still references cannot be deleted.
 *
 * This is the assertion that decides whether `blog`'s mixed boot hook was split
 * the right way round. The hook did two things: it registered the module's two
 * asset-reference descriptors into `assets_library`' registry, and it seeded
 * rows. Only the second is work. Had the whole hook been probed — the reading of
 * "add a presence check at the top" that a ratchet without a *split first*
 * remedy teaches — a deployment that boots with `blog` deactivated would come up
 * with no blog scanner, and the Library would happily soft-delete an asset a
 * blog post still embeds. The damage shows up as a broken image when the
 * operator switches `blog` back on, which Constitution XVII promises cannot
 * happen: off is non-destructive and reversible.
 *
 * The composition below is the load-bearing part. It composes `blog` **while the
 * module is off**, against a registry of its own, and then asks the Library to
 * delete a referenced asset — so the test enters above the split rather than
 * below it. A test that only checked the seeds would pass on the wrong split.
 *
 * The negative control at the end deletes the same asset through an empty
 * registry, so a green cannot come from the delete failing for some other
 * reason.
 */
describe('an asset a deactivated blog still references cannot be deleted (D-68)', () => {
  let h: BackendServerHandle;
  let assetId: string;
  let categoryId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });

    assetId = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
         values (?, 'image', 'while-off.png', 'image/png', 1024, 'local:while-off-key', now(), now())`,
        [assetId],
      );

    const slug = `asset-ref-while-off-${Date.now()}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/categories',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        parentId: null,
        name: { 'en-US': slug },
        slug,
        salesChannelIds: [channel.id],
        languages: ['en-US'],
        enabled: true,
        mainImageAssetId: assetId,
      }),
    });
    expect(created.statusCode).toBe(201);
    categoryId = (created.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    const conn = h.orm.em.getConnection();
    await conn.execute(`update blog_categories set main_image_asset_id = null where id = ?`, [
      categoryId,
    ]);
    await conn.execute(`delete from assets where id = ?`, [assetId]);
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

  /** Compose `blog` on its own and run its boot hooks, whatever its state. */
  async function bootBlogInto(registry: AssetReferenceRegistry): Promise<void> {
    const { registerModule } = await import('../../../src/modules/blog/backend.js');
    const container = createRootContainer();
    registerValues(container, {
      emFactory: () => h.em(),
      redis: undefined,
      assetReferenceRegistry: registry,
      // `languages` owns `languageReferenceRegistry` and is not composed here,
      // so the root supplies it exactly as it supplies `assets_library`'. Same
      // shape of contribution and same reason it must survive deactivation: a
      // deactivated post still carries a language code, so `languages` must
      // still refuse to delete one out from under it (feature 077, D-87).
      languageReferenceRegistry: new LanguageReferenceRegistry(),
    });
    const composed = composeModules([{ id: 'blog', version: '1.0.0', registerModule }], {
      container,
      eventBus: new EventBus(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    await composed.runBootHooks();
  }

  it('refuses the delete after booting with the module deactivated', async () => {
    const registry = new AssetReferenceRegistry();

    await withModuleOff('blog', 'deactivated', async () => {
      await bootBlogInto(registry);

      expect(
        registry.owners(),
        'a deployment that boots with `blog` off registered no blog scanner, so nothing ' +
          'stands between an operator and an asset a deactivated post still embeds',
      ).toContain('blog');

      await expect(libraryOver(registry).softDelete(assetId)).rejects.toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.ASSET_REFERENCED,
      });

      const references = await registry.findReferences(assetId);
      expect(
        references.map((reference) => reference.kind),
        'the refusal must be attributable to the blog edge, not to some other holder',
      ).toContain('blog_category_main_image');
    });
  });

  it('would delete the same asset with no scanner registered — the control', async () => {
    // Negative control (issue #141): without this, a delete that fails for an
    // unrelated reason reads as the protection working.
    const deleted = await libraryOver(new AssetReferenceRegistry()).softDelete(assetId);
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });
});
