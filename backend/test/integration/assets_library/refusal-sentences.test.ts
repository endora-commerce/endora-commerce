import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AssetFolder } from '../../helpers/package-entities.js';
import { overrideAssetSetting, useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  ADMIN,
  forgetAssets,
  pdfBytes,
  replaceAsset,
  runName,
  uploadAsset,
} from '../../helpers/asset-replace-fixtures.js';
import { multipartBody } from '../../helpers/crm-attachment-upload.js';

/**
 * Issue #86, family B — the `assets_library` refusals whose bundle sentence
 * said less than the English message the thrower wrote.
 *
 * - `ASSET_FOLDER_NAME_CONFLICT` dropped the folder name;
 * - `ASSET_FOLDER_NOT_EMPTY` dropped the sub-folder and asset counts;
 * - `ASSET_UPLOAD_TYPE_NOT_ALLOWED`, raised by the `assets.allowed_file_types`
 *   policy, dropped the refused type and the allowed list, and the
 *   active-document refusal dropped which document types are refused;
 * - `ASSET_NO_PREVIOUS_VERSION`, raised for a previous version past its
 *   retention, answered "This asset has no previous version" — which is not
 *   what happened.
 *
 * The values move into `details` (only its scalar members become `{name}`
 * values), and a refusal that means something else than the base sentence
 * carries a `details.code` token picking its own sentence. A sentence with a
 * placeholder nothing filled, or a token with no sentence, makes the envelope
 * answer the thrower's English — so every Polish case also asserts the
 * rendered message is not the English one.
 *
 * An administrator's language is the stored preference, not a header.
 */

interface Refusal {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('assets_library refusals carry their values into both sentences (issue #86)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const folderIds: string[] = [];
  const assetIds: string[] = [];

  async function setAdminLanguage(language: 'en' | 'pl' | null): Promise<void> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      cookies: ADMIN,
      payload: { preferredLanguage: language },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function createFolder(name: string, parentId: string | null = null) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      cookies: ADMIN,
      payload: { parentId, name },
    });
  }

  async function folder(name: string, parentId: string | null = null): Promise<string> {
    const res = await createFolder(name, parentId);
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    folderIds.push(id);
    return id;
  }

  function refusalOf(res: { statusCode: number; body: string; json: () => unknown }, status: number, code: string) {
    expect(res.statusCode, res.body).toBe(status);
    const { error } = res.json() as Refusal;
    expect(error.code).toBe(code);
    return error;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
  }, 120_000);

  afterAll(async () => {
    // The preference outlives this file in a single-fork run.
    await setAdminLanguage(null);
    await forgetAssets(h, assetIds);
    const em = h.em();
    for (const id of [...folderIds].reverse()) {
      const row = await em.findOne(AssetFolder, { id });
      if (row) await em.removeAndFlush(row);
    }
    await store.undo();
    await teardownBackendServer(h);
  });

  describe('ASSET_FOLDER_NAME_CONFLICT names the folder', () => {
    it('on create: details carry the name, and both sentences name it', async () => {
      const name = `i86-${runName()}`;
      await folder(name);

      await setAdminLanguage('en');
      const en = refusalOf(await createFolder(name), 409, ERROR_CODES.ASSET_FOLDER_NAME_CONFLICT);
      expect(en.details).toEqual({ name });
      expect(en.message).toBe(`A folder named "${name}" already exists here. Choose a different name.`);

      await setAdminLanguage('pl');
      const pl = refusalOf(await createFolder(name), 409, ERROR_CODES.ASSET_FOLDER_NAME_CONFLICT);
      expect(pl.message).toBe(`W tym miejscu istnieje już folder o nazwie „${name}”. Wybierz inną nazwę.`);
      expect(pl.message).not.toBe(en.message);
      expect(pl.message).not.toMatch(/already exists|\{/);
    });

    it('on rename: details carry the name asked for', async () => {
      const taken = `i86-${runName()}`;
      await folder(taken);
      const other = await folder(`i86-${runName()}`);

      await setAdminLanguage('pl');
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/assets/folders/${other}`,
        cookies: ADMIN,
        payload: { name: taken },
      });
      const pl = refusalOf(res, 409, ERROR_CODES.ASSET_FOLDER_NAME_CONFLICT);
      expect(pl.details).toEqual({ name: taken });
      expect(pl.message).toBe(`W tym miejscu istnieje już folder o nazwie „${taken}”. Wybierz inną nazwę.`);
    });
  });

  describe('ASSET_FOLDER_NOT_EMPTY counts what blocks the delete', () => {
    it('details carry both counts, and both sentences name them', async () => {
      const parent = await folder(`i86-${runName()}`);
      await folder(`i86-${runName()}`, parent);
      await folder(`i86-${runName()}`, parent);
      const asset = await uploadAsset(
        h,
        { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes('not-empty') },
        { folderId: parent },
      );
      assetIds.push(asset.id);

      const remove = () =>
        h.app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/assets/folders/${parent}`,
          cookies: ADMIN,
          payload: { ifNonEmpty: 'cancel' },
        });

      await setAdminLanguage('en');
      const en = refusalOf(await remove(), 409, ERROR_CODES.ASSET_FOLDER_NOT_EMPTY);
      expect(en.details).toEqual({ subfolderCount: 2, assetCount: 1 });
      expect(en.message).toBe(
        'This folder is not empty (subfolders: 2, assets: 1). Move or delete its subfolders and assets first.',
      );

      await setAdminLanguage('pl');
      const pl = refusalOf(await remove(), 409, ERROR_CODES.ASSET_FOLDER_NOT_EMPTY);
      expect(pl.message).toBe(
        'Ten folder nie jest pusty (podfoldery: 2, zasoby: 1). Najpierw przenieś lub usuń jego podfoldery i zasoby.',
      );
      expect(pl.message).not.toMatch(/not empty|\{/);
    });
  });

  describe('ASSET_UPLOAD_TYPE_NOT_ALLOWED says which type and what is allowed', () => {
    function upload(filename: string, mime: string, value: Buffer | string) {
      const { body, contentType } = multipartBody([{ name: 'file', filename, mime, value }]);
      return h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/assets',
        headers: { 'content-type': contentType },
        cookies: ADMIN,
        payload: body,
      });
    }

    it('refused by the policy: details carry the type and the allowed list', async () => {
      const restore = await overrideAssetSetting(h, 'assets.allowed_file_types', ['png', 'application/pdf']);
      try {
        await setAdminLanguage('en');
        const en = refusalOf(await upload('notes.txt', 'text/plain', 'hello'), 415, ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED);
        expect(en.details).toEqual({
          code: 'not_allowed_by_policy',
          fileType: 'text/plain',
          allowedTypes: 'png, application/pdf',
        });
        expect(en.message).toBe(
          'Files of type "text/plain" cannot be uploaded to the asset library. Allowed types: png, application/pdf.',
        );

        await setAdminLanguage('pl');
        const pl = refusalOf(await upload('notes.txt', 'text/plain', 'hello'), 415, ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED);
        expect(pl.message).toBe(
          'Plików typu „text/plain” nie można przesłać do biblioteki zasobów. Dozwolone typy: png, application/pdf.',
        );
        expect(pl.message).not.toMatch(/is not allowed|\{/);
      } finally {
        await restore();
      }
    });

    it('refused by the policy on the sniffed type: the type named is the content one', async () => {
      const restore = await overrideAssetSetting(h, 'assets.allowed_file_types', ['text/plain']);
      try {
        await setAdminLanguage('pl');
        const pl = refusalOf(
          await upload('notes.txt', 'text/plain', pdfBytes('spoofed')),
          415,
          ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED,
        );
        expect(pl.details).toEqual({
          code: 'not_allowed_by_policy',
          fileType: 'application/pdf',
          allowedTypes: 'text/plain',
        });
        expect(pl.message).toBe(
          'Plików typu „application/pdf” nie można przesłać do biblioteki zasobów. Dozwolone typy: text/plain.',
        );
      } finally {
        await restore();
      }
    });

    it('a document a browser would run: the sentence names the refused document types', async () => {
      await setAdminLanguage('en');
      const en = refusalOf(
        await upload('page.html', 'text/html', '<!doctype html><p>x</p>'),
        415,
        ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED,
      );
      expect(en.details).toEqual({ code: 'active_content' });
      expect(en.message).toBe('HTML, XHTML, XML and JavaScript files cannot be uploaded to the asset library.');

      await setAdminLanguage('pl');
      const pl = refusalOf(
        await upload('page.html', 'text/html', '<!doctype html><p>x</p>'),
        415,
        ERROR_CODES.ASSET_UPLOAD_TYPE_NOT_ALLOWED,
      );
      expect(pl.message).toBe('Plików HTML, XHTML, XML i JavaScript nie można przesłać do biblioteki zasobów.');
      expect(pl.message).not.toBe(en.message);
    });
  });

  describe('ASSET_NO_PREVIOUS_VERSION past its retention says so', () => {
    it('details carry the token beside restorableUntil, and both sentences say the retention passed', async () => {
      const restoreRetention = await overrideAssetSetting(h, 'assets.soft_delete_retention_days', 9);
      try {
        const asset = await uploadAsset(h, {
          filename: `${runName()}-v1.pdf`,
          mime: 'application/pdf',
          value: pdfBytes(`v1 ${runName()}`),
        });
        assetIds.push(asset.id);
        const replaced = await replaceAsset(h, asset.id, {
          filename: `${runName()}-v2.pdf`,
          mime: 'application/pdf',
          value: pdfBytes(`v2 ${runName()} — longer`),
        });
        expect(replaced.statusCode, replaced.body).toBe(200);
        const after = (replaced.json() as {
          data: { contentVersion: string; previousVersion: { contentVersion: string } };
        }).data;
        await h
          .em()
          .getConnection()
          .execute(`update assets set previous_replaced_at = now() - interval '10 days' where id = ?`, [asset.id]);
        const restore = () =>
          h.app.inject({
            method: 'POST',
            url: `/api/v1/admin/assets/${asset.id}/previous-version/restore`,
            cookies: ADMIN,
            payload: {
              expectedContentVersion: after.contentVersion,
              expectedPreviousContentVersion: after.previousVersion.contentVersion,
            },
          });

        await setAdminLanguage('en');
        const en = refusalOf(await restore(), 409, ERROR_CODES.ASSET_NO_PREVIOUS_VERSION);
        expect(en.details).toMatchObject({ code: 'retention_expired' });
        expect(Date.parse(String(en.details?.['restorableUntil']))).toBeLessThan(Date.now());
        expect(en.message).toBe(
          'The previous version is past its retention period and can no longer be restored.',
        );

        await setAdminLanguage('pl');
        const pl = refusalOf(await restore(), 409, ERROR_CODES.ASSET_NO_PREVIOUS_VERSION);
        expect(pl.message).toBe(
          'Poprzednia wersja przekroczyła okres przechowywania i nie można jej już przywrócić.',
        );
        expect(pl.message).not.toMatch(/past its retention|nie ma poprzedniej wersji/);
      } finally {
        await restoreRetention();
      }
    });
  });
});
