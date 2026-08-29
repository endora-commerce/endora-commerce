import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { MegamenuReferenceRegistry } from '../../../../packages/modules/megamenu/src/backend/services/megamenu-reference-registry.js';

/**
 * T013 — MegamenuReferenceRegistry. Verifies the four scanners against a
 * real Postgres so the JSONB queries compile against the migrated shape.
 */
describe('MegamenuReferenceRegistry (T013)', () => {
  let h: BackendServerHandle;
  let registry: MegamenuReferenceRegistry;

  const menuId = randomUUID();
  const linkItemId = randomUUID();
  const blockEmbedItemId = randomUUID();
  const assetItemId = randomUUID();
  const linkWithIconItemId = randomUUID();

  const categoryId = randomUUID();
  const pageId = randomUUID();
  const blockId = randomUUID();
  const assetId = randomUUID();
  const iconAssetId = randomUUID();

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    registry = new MegamenuReferenceRegistry(h.em);

    const conn = h.em().getConnection();
    const now = new Date();
    await conn.execute(
      `insert into megamenus (id, name, version, created_at, updated_at)
       values (?, 'Test menu', 1, ?, ?)`,
      [menuId, now, now],
    );

    const insertItem = async (
      id: string,
      kind: string,
      target: Record<string, unknown>,
    ): Promise<void> => {
      await conn.execute(
        `insert into megamenu_items
          (id, megamenu_id, parent_id, position, kind, labels, descriptions, target, created_at, updated_at)
         values (?, ?, null, 0, ?, '{}'::jsonb, null, ?::jsonb, ?, ?)`,
        [id, menuId, kind, JSON.stringify(target), now, now],
      );
    };

    await insertItem(linkItemId, 'category-link', { categoryId });
    await insertItem(blockEmbedItemId, 'cms-block-embed', { blockId, embedSide: 'right' });
    await insertItem(assetItemId, 'asset', { assetId, kind: 'image' });
    await insertItem(linkWithIconItemId, 'cms-page-link', {
      pageId,
      iconAssetId,
      iconPosition: 'left',
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('findCategoryReferences returns the menu+item rows whose target uses the category', async () => {
    const refs = await registry.findCategoryReferences(categoryId);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ menuId, itemId: linkItemId, menuName: 'Test menu' });
  });

  it('findCmsPageReferences returns the matching cms-page-link items', async () => {
    const refs = await registry.findCmsPageReferences(pageId);
    expect(refs.map((r) => r.itemId)).toEqual([linkWithIconItemId]);
  });

  it('findCmsBlockReferences returns the matching cms-block-embed items', async () => {
    const refs = await registry.findCmsBlockReferences(blockId);
    expect(refs.map((r) => r.itemId)).toEqual([blockEmbedItemId]);
  });

  it('findAssetReferences matches both target.assetId and target.iconAssetId', async () => {
    const refsByAssetId = await registry.findAssetReferences([assetId]);
    expect(refsByAssetId.map((r) => r.itemId)).toEqual([assetItemId]);

    const refsByIconAssetId = await registry.findAssetReferences([iconAssetId]);
    expect(refsByIconAssetId.map((r) => r.itemId)).toEqual([linkWithIconItemId]);

    const merged = await registry.findAssetReferences([assetId, iconAssetId]);
    expect(merged.map((r) => r.itemId).sort()).toEqual([assetItemId, linkWithIconItemId].sort());
  });

  it('returns an empty array when nothing references the supplied ids', async () => {
    const refs = await registry.findCategoryReferences(randomUUID());
    expect(refs).toEqual([]);
  });
});
