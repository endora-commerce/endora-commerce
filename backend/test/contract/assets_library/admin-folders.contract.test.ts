import { Asset, AssetFolder } from '../../helpers/package-entities.js';
import { overrideAssetSetting } from '../../helpers/crm-attachment-upload.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { removeCrmAssets, seedCrmAdmin, seedCrmAsset } from '../../helpers/seed-crm.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';


/**
 * T053 — Contract test: folder CRUD endpoints under /api/v1/admin/assets/folders.
 */

describe('admin folder CRUD (T053)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    // Clean up any leaked rows.
    const em = h.em();
    const all = await em.find(AssetFolder, {});
    for (const f of all) em.remove(f);
    await em.flush();
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('creates a top-level folder', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ parentId: null, name: `T053-folder-${Date.now()}` }),
    });
    expect(r.statusCode).toBe(201);
    const json = r.json() as { data: { id: string; name: string; childIds: string[] } };
    expect(json.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.data.childIds).toEqual([]);
  });

  it('lists folders and includes the freshly-created one', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ parentId: null, name: `T053-list-${Date.now()}` }),
    });
    const id = (created.json() as { data: { id: string } }).data.id;

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/assets/folders',
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const tree = (list.json() as { data: Array<{ id: string }> }).data;
    expect(tree.some((f) => f.id === id)).toBe(true);
  });

  it('rejects a duplicate name in the same parent (case-insensitive) with 409', async () => {
    const name = `T053-dup-${Date.now()}`;
    const a = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ parentId: null, name }),
    });
    expect(a.statusCode).toBe(201);
    const b = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ parentId: null, name: name.toUpperCase() }),
    });
    expect(b.statusCode).toBe(409);
    expect(b.json()).toMatchObject({ error: { code: 'ASSET_FOLDER_NAME_CONFLICT' } });
  });

  it('rejects moving a folder into its own subtree with 422', async () => {
    const parentR = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ parentId: null, name: `T053-cycle-parent-${Date.now()}` }),
    });
    const parent = (parentR.json() as { data: { id: string } }).data.id;
    const childR = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ parentId: parent, name: `T053-cycle-child-${Date.now()}` }),
    });
    const child = (childR.json() as { data: { id: string } }).data.id;

    // Try to move parent under its own child → should error.
    const r = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/assets/folders/${parent}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ parentId: child }),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ error: { code: 'ASSET_FOLDER_CYCLE' } });
  });

  it('refuses to delete a non-empty folder with strategy=cancel', async () => {
    const parentR = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ parentId: null, name: `T053-nonempty-${Date.now()}` }),
    });
    const parent = (parentR.json() as { data: { id: string } }).data.id;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ parentId: parent, name: `T053-child-${Date.now()}` }),
    });
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/assets/folders/${parent}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ ifNonEmpty: 'cancel' }),
    });
    expect(del.statusCode).toBe(409);
    expect(del.json()).toMatchObject({ error: { code: 'ASSET_FOLDER_NOT_EMPTY' } });
  });

  it('moves contents to parent and deletes when strategy=moveContentsToParent', async () => {
    const parentR = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ parentId: null, name: `T053-move-parent-${Date.now()}` }),
    });
    const parent = (parentR.json() as { data: { id: string } }).data.id;
    const childR = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ parentId: parent, name: `T053-move-child-${Date.now()}` }),
    });
    const child = (childR.json() as { data: { id: string } }).data.id;

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/assets/folders/${parent}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ ifNonEmpty: 'moveContentsToParent' }),
    });
    expect(del.statusCode).toBe(200);

    // child should now be top-level (parentId: null). Use a forked EM with
    // an empty identity map so we read from the DB rather than from the
    // composition-root EM's cache (which may still hold the old parentId
    // from when the row was created).
    const fresh = h.em().fork({ clear: true });
    const childRow = await fresh.findOne(AssetFolder, { id: child });
    expect(childRow).toBeTruthy();
    expect(childRow!.parentId ?? null).toBeNull();
  });

  // specs/156-asset-stable-url/ owner ruling S4 — the folder delete confirmation
  // names how many files in the subtree have a permalink: live ones, any depth.
  it('counts the permalinked, non-deleted assets of a folder subtree', async () => {
    const stamp = Date.now();
    const create = async (parentId: string | null, name: string) => {
      const r = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/assets/folders',
        cookies: adminCookie,
        payload: { parentId, name },
      });
      return (r.json() as { data: { id: string } }).data.id;
    };
    const parent = await create(null, `as156-count-${stamp}`);
    const child = await create(parent, `as156-count-leaf-${stamp}`);
    const grandchild = await create(child, `as156-count-deep-${stamp}`);
    const sibling = await create(null, `as156-count-other-${stamp}`);
    const em = h.em();
    const forge = (folderId: string, permalink: string | null, deleted = false) =>
      em.create(Asset, {
        kind: 'pdf',
        filename: 'as156-count.pdf',
        mimeType: 'application/pdf',
        sizeBytes: '0',
        storageUrl: 'https://example.com/as156-count.pdf',
        storageLocator: 'https://example.com/as156-count.pdf',
        storageBackend: 'legacy',
        visibility: 'public',
        folderId,
        permalink,
        ...(deleted ? { deletedAt: new Date() } : {}),
      });
    const rows = [
      forge(parent, `as156-${stamp}/direct.pdf`),
      forge(parent, null),
      forge(grandchild, `as156-${stamp}/deep.pdf`),
      forge(child, `as156-${stamp}/deleted.pdf`, true),
      forge(sibling, `as156-${stamp}/elsewhere.pdf`),
    ];
    await em.flush();
    try {
      const count = async (folderId: string) => {
        const r = await h.app.inject({
          method: 'GET',
          url: `/api/v1/admin/assets/folders/${folderId}/permalink-count`,
          cookies: adminCookie,
        });
        expect(r.statusCode, r.body).toBe(200);
        return (r.json() as { data: { permalinkedAssets: number } }).data.permalinkedAssets;
      };
      expect(await count(parent)).toBe(2);
      expect(await count(child)).toBe(1);
      expect(await count(sibling)).toBe(1);
      const missing = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/assets/folders/0b8f3c1e-2d4a-4b6c-8e9f-000000000000/permalink-count',
        cookies: adminCookie,
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await h.em().fork().nativeDelete(Asset, { id: { $in: rows.map((r) => r.id) } });
    }
  });

  // specs/156-asset-stable-url/ T042 — a recursive delete gives every asset in
  // the subtree the same window (SC-007).
  it('gives every asset in a recursively deleted subtree the same deletion time and window', async () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const create = async (parentId: string | null, name: string) => {
      const r = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/assets/folders',
        cookies: adminCookie,
        payload: { parentId, name },
      });
      return (r.json() as { data: { id: string } }).data.id;
    };
    const parent = await create(null, `as156-tree-${Date.now()}`);
    const child = await create(parent, `as156-leaf-${Date.now()}`);
    const em = h.em();
    const forge = (folderId: string) =>
      em.create(Asset, {
        kind: 'image',
        filename: 'as156-tree.png',
        mimeType: 'image/png',
        sizeBytes: '0',
        storageUrl: 'https://example.com/as156-tree.png',
        storageLocator: 'https://example.com/as156-tree.png',
        storageBackend: 'legacy',
        visibility: 'public',
        folderId,
      });
    const direct = forge(parent);
    const nested = forge(child);
    await em.flush();
    const restore = await overrideAssetSetting(h, 'assets.soft_delete_retention_days', 7);
    try {
      const del = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/assets/folders/${parent}`,
        cookies: adminCookie,
        payload: { ifNonEmpty: 'deleteRecursively' },
      });
      expect(del.statusCode, del.body).toBe(200);
      const fresh = h.em().fork({ clear: true });
      const rows = await fresh.find(Asset, { id: { $in: [direct.id, nested.id] } });
      expect(rows).toHaveLength(2);
      const [a, b] = rows;
      expect(a!.deletedAt?.toISOString()).toBe(b!.deletedAt?.toISOString());
      for (const row of rows) {
        expect(row.purgeAfterAt!.getTime() - row.deletedAt!.getTime()).toBe(7 * DAY_MS);
      }
    } finally {
      await restore();
      await h.em().nativeDelete(Asset, { id: { $in: [direct.id, nested.id] } });
    }
  });

  // specs/166-asset-reference-visibility/ T042 (R-10): the permalink count
  // follows the reader, a folder with a visible file is still not empty for
  // them, and the folder tree, which carries no asset data, is the same for
  // everyone.
  it('counts only the files a restricted reader may see; the tree is unchanged', async () => {
    // Reads the library only: a Task's file is hidden from this reader.
    const reader = await seedCrmAdmin(h.em(), 'fold166', ['assets.read', 'assets.write']);
    const stamp = randomUUID().slice(0, 8);
    const conn = h.em().getConnection();
    const task = randomUUID();
    const assetIds: string[] = [];
    try {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/assets/folders',
        cookies: adminCookie,
        payload: { parentId: null, name: `fold166-${stamp}` },
      });
      expect(created.statusCode, created.body).toBe(201);
      const folderId = (created.json() as { data: { id: string } }).data.id;
      await conn.execute(
        `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id") values (?, ?, 'fold166', ?)`,
        [task, `T-F166-${stamp}`, TEST_ADMIN_ID],
      );
      for (const [name, used] of [
        ['visible', false],
        ['hidden', true],
      ] as const) {
        const { id } = await seedCrmAsset(h.em(), { filename: `fold166-${stamp}-${name}.pdf` });
        assetIds.push(id);
        await conn.execute(`update "assets" set "folder_id" = ?, "permalink" = ? where "id" = ?`, [
          folderId,
          `fold166-${stamp}/${name}.pdf`,
          id,
        ]);
        if (used) {
          await conn.execute(
            `insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`,
            [task, id, TEST_ADMIN_ID],
          );
        }
      }

      const count = async (cookies: Record<string, string>) => {
        const r = await h.app.inject({
          method: 'GET',
          url: `/api/v1/admin/assets/folders/${folderId}/permalink-count`,
          cookies,
        });
        expect(r.statusCode, r.body).toBe(200);
        return (r.json() as { data: { permalinkedAssets: number } }).data.permalinkedAssets;
      };
      expect(await count(adminCookie)).toBe(2);
      expect(await count(reader.cookies)).toBe(1);

      const refuse = async (cookies: Record<string, string>) => {
        const r = await h.app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/assets/folders/${folderId}`,
          cookies,
          payload: { ifNonEmpty: 'cancel' },
        });
        expect(r.statusCode, r.body).toBe(409);
        const body = r.json() as { error: { code: string; message: string; details?: unknown } };
        expect(body.error.code).toBe('ASSET_FOLDER_NOT_EMPTY');
        return body.error;
      };
      // The counts are on the wire (issue #86): `details` and the sentence
      // name them, and the reader is counted only the file it may see.
      const forReader = await refuse(reader.cookies);
      const forAdmin = await refuse(adminCookie);
      expect(forReader.details).toEqual({ subfolderCount: 0, assetCount: 1 });
      expect(forAdmin.details).toEqual({ subfolderCount: 0, assetCount: 2 });
      expect(forReader.message).toContain('assets: 1');
      expect(forAdmin.message).toContain('assets: 2');

      const tree = async (cookies: Record<string, string>) => {
        const r = await h.app.inject({ method: 'GET', url: '/api/v1/admin/assets/folders', cookies });
        expect(r.statusCode, r.body).toBe(200);
        return r.json() as unknown;
      };
      expect(await tree(reader.cookies)).toEqual(await tree(adminCookie));
    } finally {
      await conn.execute(`delete from "tasks" where "id" = ?`, [task]);
      await removeCrmAssets(h.em(), assetIds);
      reader.undo();
    }
  });
});
