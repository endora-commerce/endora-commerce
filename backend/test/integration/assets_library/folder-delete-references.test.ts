import { Asset, AssetFolder, CmsPage } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { OTHER_TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { removeCrmAssets, seedCrmAdmin, seedCrmAsset, seedCrmSalesRep } from '../../helpers/seed-crm.js';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #535 — a recursive folder delete ("delete everything") must refuse,
 * all-or-nothing, when any asset in the subtree is still in use. It consults
 * `findReferencesMany`, which used to key its result on an id no descriptor
 * set, so every list came back empty and in-use assets were soft-deleted.
 *
 * Two descriptors from two modules are exercised on purpose — a catalog
 * column reference (product gallery) and a CMS content scan — one asset in
 * the folder itself and one in a sub-folder.
 */

describe('recursive folder delete refuses in-use assets (#535)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'us1-catalog' });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('returns 409 ASSET_REFERENCED and deletes nothing while a subtree asset is in use', async () => {
    const stamp = randomUUID().slice(0, 8);
    const createFolder = async (parentId: string | null, name: string) => {
      const r = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/assets/folders',
        cookies: adminCookie,
        payload: { parentId, name },
      });
      expect(r.statusCode, r.body).toBe(201);
      return (r.json() as { data: { id: string } }).data.id;
    };
    const parent = await createFolder(null, `i535-parent-${stamp}`);
    const child = await createFolder(parent, `i535-child-${stamp}`);

    const em = h.em();
    const forge = (folderId: string, filename: string) =>
      em.create(Asset, {
        kind: 'image',
        filename,
        mimeType: 'image/png',
        sizeBytes: '0',
        storageUrl: `https://example.com/${filename}`,
        storageLocator: `https://example.com/${filename}`,
        storageBackend: 'legacy',
        visibility: 'public',
        folderId,
      });
    const inGallery = forge(parent, `i535-gallery-${stamp}.png`);
    const inPage = forge(child, `i535-page-${stamp}.png`);
    const unused = forge(parent, `i535-unused-${stamp}.png`);
    await em.flush();
    const assetIds = [inGallery.id, inPage.id, unused.id];

    const conn = em.getConnection();
    const productRows = (await conn.execute(
      `select id::text as id from products where deleted_at is null limit 1`,
    )) as Array<{ id: string }>;
    expect(productRows.length, 'the us1-catalog seed must hold a product').toBeGreaterThan(0);
    await conn.execute(
      `insert into gallery_items (id, product_id, asset_id, position, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, 0, now(), now())`,
      [productRows[0]!.id, inGallery.id],
    );

    const slug = `i535-page-${stamp}`;
    const page = em.create(CmsPage, {
      path: slug,
      title: { 'en-US': `I535 ${slug}` },
      body: {} as Record<string, string>,
      name: `I535 ${slug}`,
      slug,
      status: 'published',
      active: true,
      content: {
        schema_version: 1,
        languages: {
          'en-US': {
            root: { props: {} },
            content: [{ type: 'LibraryImage', props: { assetId: inPage.id, alt: 'embedded' } }],
          },
        },
      },
      languages: ['en-US'],
    });
    await em.persistAndFlush(page);

    try {
      const del = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/assets/folders/${parent}`,
        cookies: adminCookie,
        payload: { ifNonEmpty: 'deleteRecursively' },
      });
      expect(del.statusCode, del.body).toBe(409);
      const body = del.json() as {
        error: { code: string; details?: Array<{ path: string; issue: string }> };
      };
      expect(body.error.code).toBe('ASSET_REFERENCED');
      const blocking = (body.error.details ?? []).map((d) => d.issue).sort();
      expect(blocking).toEqual([inGallery.id, inPage.id].sort());

      // All-or-nothing: no asset soft-deleted, both folders still there.
      const fresh = h.em().fork({ clear: true });
      const rows = await fresh.find(Asset, { id: { $in: assetIds } });
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(row.deletedAt ?? null).toBeNull();
      expect(await fresh.count(AssetFolder, { id: { $in: [parent, child] } })).toBe(2);

      // With the references gone the same delete goes through.
      await conn.execute(`delete from gallery_items where asset_id = ?`, [inGallery.id]);
      const pageEm = h.em().fork({ clear: true });
      await pageEm.nativeDelete(CmsPage, { id: page.id });

      const again = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/assets/folders/${parent}`,
        cookies: adminCookie,
        payload: { ifNonEmpty: 'deleteRecursively' },
      });
      expect(again.statusCode, again.body).toBe(200);
      const out = (again.json() as { data: { softDeletedAssetIds?: string[] } }).data;
      expect([...(out.softDeletedAssetIds ?? [])].sort()).toEqual([...assetIds].sort());
    } finally {
      const cleanup = h.em().fork({ clear: true });
      await cleanup.getConnection().execute(
        `delete from gallery_items where asset_id in (?, ?, ?)`,
        assetIds,
      );
      await cleanup.nativeDelete(CmsPage, { id: page.id });
      await cleanup.nativeDelete(Asset, { id: { $in: assetIds } });
      await cleanup.nativeDelete(AssetFolder, { id: { $in: [child, parent] } });
    }
  });

  /**
   * User Story 4 (`specs/166-asset-reference-visibility/`, research R-8, R-10;
   * `contracts/admin-api.md` §1 rows 9, 19, 20 and §1.1): deleting a file in
   * use is still refused, whoever asks, and no refusal, count or folder delete
   * names or counts a file the reader may not see.
   *
   * **The reader matrix** (quickstart.md), built here for this block:
   * - **A** — the library and every Tasks permission with `tasks:see_private`;
   *   creates the private Task, so sees its files;
   * - **B** — the library, `tasks:read/write`, without `tasks:see_private`,
   *   confined to Organization O2: the subject;
   * - **S** — B's permissions plus `tasks:see_private`;
   * - **N** — `assets.read` / `assets.write` only;
   * - **W** — the Platform administrator (`*`): the control, never the subject.
   *
   * A file is hidden from B and N by A's private Task alone; a product's
   * gallery rescues it (FR-001 b) and is the one record B is told about.
   */
  describe('US4 — deleting a file in use is still refused', () => {
    type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
    let A: Person;
    let B: Person;
    let S: Person;
    let N: Person;
    const W = adminCookie;
    const run = randomUUID().slice(0, 8);
    const privateTask = randomUUID();
    let product: string;
    const assetIds: string[] = [];
    const folderIds: string[] = [];
    const galleryItems: string[] = [];

    const inject = (
      method: 'GET' | 'POST' | 'DELETE',
      url: string,
      cookies: Record<string, string>,
      payload?: unknown,
    ): Promise<LightMyRequestResponse> =>
      h.app.inject({
        method,
        url,
        cookies,
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      });

    async function folder(parentId: string | null, name: string): Promise<string> {
      const response = await inject('POST', '/api/v1/admin/assets/folders', W, { parentId, name: `rvd-${run}-${name}` });
      expect(response.statusCode, response.body).toBe(201);
      const id = (response.json() as { data: { id: string } }).data.id;
      folderIds.push(id);
      return id;
    }

    /** A file in `folderId`, optionally with a permalink. */
    async function file(folderId: string | null, name: string, permalink?: string): Promise<string> {
      const { id } = await seedCrmAsset(h.em(), { filename: `rvd-${run}-${name}.pdf` });
      assetIds.push(id);
      await h
        .em()
        .getConnection()
        .execute(`update "assets" set "folder_id" = ?, "permalink" = ? where "id" = ?`, [
          folderId,
          permalink ?? null,
          id,
        ]);
      return id;
    }

    /** Hidden from B and N: used by A's private Task and nothing else. */
    async function hide(assetId: string): Promise<void> {
      await h
        .em()
        .getConnection()
        .execute(`insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`, [
          privateTask,
          assetId,
          A.adminUserId,
        ]);
    }

    /** Used by a product: visible to every library reader. */
    async function useInGallery(assetId: string): Promise<string> {
      const id = randomUUID();
      await h
        .em()
        .getConnection()
        .execute(
          `insert into gallery_items (id, product_id, asset_id, position, created_at, updated_at) values (?, ?, ?, 0, now(), now())`,
          [id, product, assetId],
        );
      galleryItems.push(id);
      return id;
    }

    async function row(id: string): Promise<{ folderId: string | null; deletedAt: Date | null }> {
      const rows = await h
        .em()
        .getConnection()
        .execute<Array<{ folder_id: string | null; deleted_at: Date | null }>>(
          `select folder_id::text as folder_id, deleted_at from assets where id = ?`,
          [id],
        );
      const [found] = rows;
      if (!found) throw new Error(`asset ${id} has no row`);
      return { folderId: found.folder_id, deletedAt: found.deleted_at };
    }

    async function folderExists(id: string): Promise<boolean> {
      const rows = await h
        .em()
        .getConnection()
        .execute<Array<{ id: string }>>(`select id::text as id from asset_folders where id = ?`, [id]);
      return rows.length === 1;
    }

    const deleteFolder = (id: string, ifNonEmpty: string, cookies: Record<string, string>) =>
      inject('DELETE', `/api/v1/admin/assets/folders/${id}`, cookies, { ifNonEmpty });

    type Refusal = { error: { code: string; message: string; details?: Array<{ path: string; issue: string }> } };

    /** The answer with the asked id and the request id taken out: what must be equal byte for byte. */
    function normalised(response: LightMyRequestResponse, id: string): unknown {
      const body = JSON.parse(response.body.split(id).join('<id>')) as { error?: Record<string, unknown> };
      if (body.error) delete body.error.requestId;
      return { status: response.statusCode, body };
    }

    async function folderDeleteAudit(folderId: string): Promise<Record<string, unknown>> {
      const audit = await h.auditLogService.query({ action: 'asset_folder.delete', objectId: folderId });
      expect(audit, 'one asset_folder.delete row').toHaveLength(1);
      return audit[0]!.stateBefore as Record<string, unknown>;
    }

    beforeAll(async () => {
      const PERMISSIONS = ['tasks:read', 'tasks:write', 'assets.read', 'assets.write'];
      A = await seedCrmAdmin(h.em(), 'rvd-a', [...PERMISSIONS, 'tasks:see_private']);
      B = await seedCrmSalesRep(h.em(), [OTHER_TEST_ORGANIZATION_ID], PERMISSIONS);
      S = await seedCrmAdmin(h.em(), 'rvd-s', [...PERMISSIONS, 'tasks:see_private']);
      N = await seedCrmAdmin(h.em(), 'rvd-n', ['assets.read', 'assets.write']);
      const conn = h.em().getConnection();
      await conn.execute(
        `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_private") values (?, ?, ?, ?, true)`,
        [privateTask, `T-RVD-${run}`, `RVD ${run}`, A.adminUserId],
      );
      const products = await conn.execute<Array<{ id: string }>>(
        `select id::text as id from products where deleted_at is null limit 1`,
      );
      expect(products.length, 'the us1-catalog seed must hold a product').toBeGreaterThan(0);
      product = products[0]!.id;
    });

    afterAll(async () => {
      const conn = h.em().getConnection();
      if (galleryItems.length > 0) {
        await conn.execute(`delete from gallery_items where id = any(?::uuid[])`, [`{${galleryItems.join(',')}}`]);
      }
      await conn.execute(`delete from "tasks" where "id" = ?`, [privateTask]);
      await removeCrmAssets(h.em(), assetIds);
      if (folderIds.length > 0) {
        await conn.execute(`delete from asset_folders where id = any(?::uuid[])`, [`{${folderIds.join(',')}}`]);
      }
      for (const person of [A, B, S, N]) person?.undo();
    });

    it('DELETE /assets/:id on a file of a product and A’s private Task: refused for everyone, naming only what each may see', async () => {
      const F = await file(null, 'product-task');
      await useInGallery(F);
      await hide(F);

      const answers: Record<string, Refusal> = {};
      for (const [who, cookies] of [
        ['A', A.cookies],
        ['B', B.cookies],
        ['S', S.cookies],
        ['N', N.cookies],
        ['W', W],
      ] as const) {
        const response = await inject('DELETE', `/api/v1/admin/assets/${F}`, cookies);
        expect(response.statusCode, `${who}: ${response.body}`).toBe(409);
        answers[who] = response.json() as Refusal;
        expect(answers[who]!.error.code, who).toBe(ERROR_CODES.ASSET_REFERENCED);
      }
      // W, A and S see both records; the Task is named to them.
      const all = answers.W!.error.details ?? [];
      expect(all.map((d) => d.path).sort()).toEqual(['product_gallery', 'task_attachment']);
      expect(answers.A!.error.details).toEqual(all);
      expect(answers.S!.error.details).toEqual(all);
      // B and N are told about the product only: the Task is neither named nor counted.
      const productOnly = all.filter((d) => d.path === 'product_gallery');
      expect(productOnly).toHaveLength(1);
      expect(answers.B!.error.details).toEqual(productOnly);
      expect(answers.N!.error.details).toEqual(productOnly);
      // The wire sentence is the translated one, which carries no count, so it
      // is the Platform administrator's word for word; the count in the
      // untranslated fallback is measured in `assets-library-reader.test.ts`.
      expect(answers.B!.error.message).toBe(answers.W!.error.message);
      expect((await row(F)).deletedAt).toBeNull();
    });

    it('DELETE /assets/:id on a hidden file: B gets the not-found of a missing file; W is still refused (FR-010 keeps FR-008)', async () => {
      const H = await file(null, 'hidden');
      await hide(H);
      const missing = randomUUID();
      for (const [who, cookies] of [
        ['B', B.cookies],
        ['N', N.cookies],
      ] as const) {
        const hidden = await inject('DELETE', `/api/v1/admin/assets/${H}`, cookies);
        const none = await inject('DELETE', `/api/v1/admin/assets/${missing}`, cookies);
        expect(none.statusCode, who).toBe(404);
        expect(normalised(hidden, H), who).toEqual(normalised(none, missing));
      }
      const forW = await inject('DELETE', `/api/v1/admin/assets/${H}`, W);
      expect(forW.statusCode, forW.body).toBe(409);
      expect((forW.json() as Refusal).error.details?.map((d) => d.path)).toEqual(['task_attachment']);
      expect((await row(H)).deletedAt).toBeNull();
    });

    it('deleteRecursively: a referenced visible file refuses the whole delete, naming visible ids only; hidden files are untouched', async () => {
      const top = await folder(null, 'rec-top');
      const parent = await folder(top, 'rec-parent');
      const child = await folder(parent, 'rec-child');
      const used = await file(parent, 'rec-used');
      const gallery = await useInGallery(used);
      const unused = await file(parent, 'rec-unused');
      const hidden = await file(child, 'rec-hidden');
      await hide(hidden);

      const forB = await deleteFolder(parent, 'deleteRecursively', B.cookies);
      expect(forB.statusCode, forB.body).toBe(409);
      expect((forB.json() as Refusal).error.code).toBe(ERROR_CODES.ASSET_REFERENCED);
      expect((forB.json() as Refusal).error.details).toEqual([{ path: 'assetId', issue: used }]);
      // The control: W sees the hidden file, which a Task uses, so it is named too.
      const forW = await deleteFolder(parent, 'deleteRecursively', W);
      expect(forW.statusCode, forW.body).toBe(409);
      expect(((forW.json() as Refusal).error.details ?? []).map((d) => d.issue).sort()).toEqual([used, hidden].sort());
      // All-or-nothing: nothing deleted, nothing moved.
      for (const id of [used, unused, hidden]) expect((await row(id)).deletedAt, id).toBeNull();
      expect((await row(hidden)).folderId).toBe(child);
      expect(await folderExists(parent)).toBe(true);
      expect(await folderExists(child)).toBe(true);

      // With the visible reference gone, B's delete goes through: the visible
      // files are soft-deleted, the hidden one is re-homed to the deleted
      // root's parent, and the audit row says so.
      await h.em().getConnection().execute(`delete from gallery_items where id = ?`, [gallery]);
      const again = await deleteFolder(parent, 'deleteRecursively', B.cookies);
      expect(again.statusCode, again.body).toBe(200);
      const out = (again.json() as { data: { deletedFolderId: string; softDeletedAssetIds?: string[] } }).data;
      expect(out.deletedFolderId).toBe(parent);
      expect([...(out.softDeletedAssetIds ?? [])].sort()).toEqual([used, unused].sort());
      expect(await row(hidden)).toEqual({ folderId: top, deletedAt: null });
      expect(await folderExists(parent)).toBe(false);
      expect(await folderExists(child)).toBe(false);
      expect(await folderDeleteAudit(parent)).toMatchObject({ strategy: 'deleteRecursively', rehomedAssetIds: [hidden] });
    });

    it('deleteRecursively at the root: a hidden file is re-homed to the root, not soft-deleted', async () => {
      const parent = await folder(null, 'rec-root');
      const hidden = await file(parent, 'rec-root-hidden');
      await hide(hidden);
      const unused = await file(parent, 'rec-root-unused');
      const response = await deleteFolder(parent, 'deleteRecursively', B.cookies);
      expect(response.statusCode, response.body).toBe(200);
      expect((response.json() as { data: { softDeletedAssetIds?: string[] } }).data.softDeletedAssetIds).toEqual([unused]);
      expect(await row(hidden)).toEqual({ folderId: null, deletedAt: null });
      expect((await row(unused)).deletedAt).not.toBeNull();
      expect(await folderDeleteAudit(parent)).toMatchObject({ rehomedAssetIds: [hidden] });
    });

    it('cancel: a folder holding only hidden files deletes as empty for B, its files moved to the parent; W is refused', async () => {
      const top = await folder(null, 'cancel-top');
      const onlyHidden = await folder(top, 'cancel-only-hidden');
      const first = await file(onlyHidden, 'cancel-hidden-1');
      const second = await file(onlyHidden, 'cancel-hidden-2');
      await hide(first);
      await hide(second);

      // The control: W sees both files, so the folder is not empty for W.
      const forW = await deleteFolder(onlyHidden, 'cancel', W);
      expect(forW.statusCode, forW.body).toBe(409);
      expect((forW.json() as Refusal).error.code).toBe(ERROR_CODES.ASSET_FOLDER_NOT_EMPTY);

      const forB = await deleteFolder(onlyHidden, 'cancel', B.cookies);
      expect(forB.statusCode, forB.body).toBe(200);
      expect(forB.json()).toEqual({ data: { deletedFolderId: onlyHidden } });
      expect(await folderExists(onlyHidden)).toBe(false);
      expect(await row(first)).toEqual({ folderId: top, deletedAt: null });
      expect(await row(second)).toEqual({ folderId: top, deletedAt: null });
      const before = await folderDeleteAudit(onlyHidden);
      expect(before).toMatchObject({ strategy: 'cancel' });
      expect([...(before.rehomedAssetIds as string[])].sort()).toEqual([first, second].sort());
    });

    it('cancel: a folder with a visible file among hidden ones is still refused for B', async () => {
      const mixed = await folder(null, 'cancel-mixed');
      await file(mixed, 'cancel-visible');
      for (const name of ['cancel-mixed-hidden-1', 'cancel-mixed-hidden-2']) await hide(await file(mixed, name));

      const forB = await deleteFolder(mixed, 'cancel', B.cookies);
      const forW = await deleteFolder(mixed, 'cancel', W);
      for (const [who, response] of [
        ['B', forB],
        ['W', forW],
      ] as const) {
        expect(response.statusCode, `${who}: ${response.body}`).toBe(409);
        expect((response.json() as Refusal).error.code, who).toBe(ERROR_CODES.ASSET_FOLDER_NOT_EMPTY);
      }
      // The counts are on the wire (issue #86): `details` and both bundle
      // sentences name them, so B is told of the one file B sees and W of all
      // three.
      expect((forB.json() as Refusal).error.details).toEqual({ subfolderCount: 0, assetCount: 1 });
      expect((forW.json() as Refusal).error.details).toEqual({ subfolderCount: 0, assetCount: 3 });
      expect((forB.json() as Refusal).error.message).not.toBe((forW.json() as Refusal).error.message);
      expect(await folderExists(mixed)).toBe(true);
    });

    it('moveContentsToParent: unchanged — every file, hidden or not, goes to the parent', async () => {
      const top = await folder(null, 'move-top');
      const moving = await folder(top, 'move-me');
      const visible = await file(moving, 'move-visible');
      const hidden = await file(moving, 'move-hidden');
      await hide(hidden);
      const response = await deleteFolder(moving, 'moveContentsToParent', B.cookies);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({ data: { deletedFolderId: moving } });
      expect(await row(visible)).toEqual({ folderId: top, deletedAt: null });
      expect(await row(hidden)).toEqual({ folderId: top, deletedAt: null });
      expect(await folderDeleteAudit(moving)).toMatchObject({ strategy: 'moveContentsToParent', rehomedAssetIds: [hidden] });
    });

    it('GET /assets/folders/:folderId/permalink-count leaves out the files each reader may not see', async () => {
      const counted = await folder(null, 'count');
      const nested = await folder(counted, 'count-nested');
      await file(counted, 'count-visible', `rvd-${run}/visible.pdf`);
      await hide(await file(nested, 'count-hidden', `rvd-${run}/hidden.pdf`));
      await file(counted, 'count-plain');
      const count = async (cookies: Record<string, string>): Promise<number> => {
        const response = await inject('GET', `/api/v1/admin/assets/folders/${counted}/permalink-count`, cookies);
        expect(response.statusCode, response.body).toBe(200);
        return (response.json() as { data: { permalinkedAssets: number } }).data.permalinkedAssets;
      };
      expect(await count(W)).toBe(2);
      expect(await count(A.cookies)).toBe(2);
      expect(await count(S.cookies)).toBe(2);
      expect(await count(B.cookies)).toBe(1);
      expect(await count(N.cookies)).toBe(1);
    });
  });
});
