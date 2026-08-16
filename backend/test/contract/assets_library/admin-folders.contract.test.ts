import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AssetFolder } from '../../../src/modules/assets_library/entities/asset-folder.entity.js';

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
});
