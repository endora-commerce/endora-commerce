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
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { LanguageReferenceRegistry } from '../../../../packages/modules/languages/src/backend/services/language-reference-registry.js';

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

  /** Compose `blog` on its own and run its boot hooks, whatever its state. */
  async function bootBlogInto(
    registry: AssetReferenceRegistry,
    emFactory: () => EntityManager = () => h.em(),
  ): Promise<void> {
    const { registerModule } = await import('../../../../packages/modules/blog/src/backend/index.js');
    const container = createRootContainer();
    registerValues(container, {
      emFactory,
      redis: undefined,
      assetReferenceRegistry: registry,
      // `languages` owns `languageReferenceRegistry` and is not composed here,
      // so the root supplies it exactly as it supplies `assets_library`'. Same
      // shape of contribution and same reason it must survive deactivation: a
      // deactivated post still carries a language code, so `languages` must
      // still refuse to delete one out from under it (feature 077, D-87).
      languageReferenceRegistry: new LanguageReferenceRegistry(),
      // Feature 171 — the blog URL prefix's two contributions: the setting's write
      // rule and the first segments it claims from CMS pages.
      settingWriteValidatorRegistry: { register: () => {}, forCode: () => [] },
      cmsReservedSegmentRegistry: { register: () => {} },
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

    await withModuleOff('blog', 'deactivated', async () => {
      await bootBlogInto(registry, counting);
      const out = await registry.findReferencesMany([assetId, unused]);

      expect(statements, 'one statement per descriptor for the whole batch').toBe(2);
      expect(out.get(assetId)).toEqual([expect.objectContaining({ kind: 'blog_category_main_image', assetId })]);
      expect(out.get(unused)).toEqual([]);
    });
  });

  it('would delete the same asset with no scanner registered — the control', async () => {
    // Negative control (issue #141): without this, a delete that fails for an
    // unrelated reason reads as the protection working.
    const deleted = await libraryOver(new AssetReferenceRegistry()).softDelete(assetId);
    expect(deleted.deletedAt).toBeInstanceOf(Date);
  });
});
