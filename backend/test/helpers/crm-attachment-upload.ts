import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import { CRM_ADMIN, CRM_API } from './seed-crm.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * Fixtures for the Opportunity attachment **upload**
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §7a): a multipart
 * body, the request itself, and the media library's storage and upload policy
 * pointed where a test wants them.
 */

/** The smallest valid PNG — one transparent pixel. Its content says `image/png`. */
export const TINY_PNG = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C636400010000000500010D0A2DB40000000049454E44AE426082',
  'hex',
);

export interface MultipartPart {
  name: string;
  filename?: string;
  mime?: string;
  value: Buffer | string;
}

export function multipartBody(parts: readonly MultipartPart[]): { body: Buffer; contentType: string } {
  const boundary = `----crmAttachmentBoundary${Date.now()}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename !== undefined) {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`),
      );
      chunks.push(Buffer.from(`Content-Type: ${part.mime ?? 'application/octet-stream'}\r\n\r\n`));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n`));
    }
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** `POST /opportunities/:id/attachments/upload` with one `file` part. */
export function uploadCrmAttachment(
  h: BackendServerHandle,
  opportunityId: string,
  file: { filename: string; mime?: string; value: Buffer | string },
  cookies: Record<string, string> = CRM_ADMIN,
) {
  const { body, contentType } = multipartBody([{ name: 'file', ...file }]);
  return h.app.inject({
    method: 'POST',
    url: `${CRM_API}/opportunities/${opportunityId}/attachments/upload`,
    headers: { 'content-type': contentType },
    cookies,
    payload: body,
  });
}

/**
 * Give a media-library setting a value for the duration of a test, as a
 * per-channel override — the manifest's default stays untouched. Returns the
 * function that puts back what was there.
 */
export async function overrideAssetSetting(
  h: BackendServerHandle,
  code: string,
  value: unknown,
): Promise<() => Promise<void>> {
  const em = h.em();
  const setting = await em.findOneOrFail(Setting, { code });
  const existing = await em.findOne(SettingValue, { setting });
  const had = existing !== null;
  const before: unknown = existing?.value;
  if (existing) {
    existing.value = value;
  } else {
    const channel = await em.findOneOrFail(SalesChannel, { code: 'default' });
    em.create(SettingValue, { setting, salesChannel: channel, value });
  }
  await em.flush();
  return async () => {
    const restore = h.em();
    const row = await restore.findOne(SettingValue, { setting: { code } });
    if (!row) return;
    if (had) {
      row.value = before;
      await restore.flush();
    } else {
      await restore.removeAndFlush(row);
    }
  };
}

/**
 * Point the library's local store at a directory of this test's own, so an
 * upload writes nowhere else. Returns the directory and the undo.
 */
export async function useTemporaryAssetStore(
  h: BackendServerHandle,
): Promise<{ baseDir: string; undo: () => Promise<void> }> {
  const baseDir = await mkdtemp(join(tmpdir(), 'crm-attachment-upload-'));
  const restore = await overrideAssetSetting(h, 'assets.local.base_dir', baseDir);
  h.assetsLibrary.adapters.invalidate();
  return {
    baseDir,
    undo: async () => {
      await restore();
      h.assetsLibrary.adapters.invalidate();
      await rm(baseDir, { recursive: true, force: true });
    },
  };
}
