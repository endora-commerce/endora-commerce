import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { LightMyRequestResponse } from 'fastify';

import { multipartBody, TINY_PNG, type MultipartPart } from './crm-attachment-upload.js';
import type { BackendServerHandle } from './test-server.js';
import { AdminRole, AdminUser } from './package-entities.js';
import { ADMIN_COOKIES } from './test-actors.js';
import {
  createAssetRetentionSweeper,
  type AssetRetentionSweeper,
} from '../../../packages/modules/assets_library/src/backend/jobs/retention-sweeper.js';
import type { RetentionSweepDeps } from '../../../packages/modules/assets_library/src/backend/jobs/retention-sweep-deps.js';

/**
 * Fixtures for replacing a library asset's file in place
 * (`specs/156-asset-stable-url/`): files whose content the upload pipeline
 * recognises, the upload and replace requests, and the per-run cleanup
 * (`tasks.md` standing rule 6 — every name carries `as156-<run>`).
 */

export const ADMIN = { b2b_session: 'stub-admin-session' };

export { TINY_PNG };

/** A fresh per-run name: `as156-<8 hex>`. */
export function runName(): string {
  return `as156-${randomUUID().slice(0, 8)}`;
}

/** A PDF the sniffer recognises; `marker` makes two of them differ. */
export function pdfBytes(marker: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${marker}\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n`);
}

/** The smallest JPEG header the sniffer recognises. */
export const TINY_JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

export const TINY_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
);

/** An uncompressed ZIP archive of the given text entries. */
function storedZip(entries: ReadonlyArray<readonly [string, string]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text);
    const nameBytes = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function officeDocument(mainContentType: string, part: string): Buffer {
  return storedZip([
    [
      '[Content_Types].xml',
      `<?xml version="1.0"?><Types><Override PartName="/${part}" ContentType="${mainContentType}.main+xml"/></Types>`,
    ],
    [part, '<?xml version="1.0"?><root/>'],
  ]);
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function docxBytes(): Buffer {
  return officeDocument(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'word/document.xml',
  );
}

export function xlsxBytes(): Buffer {
  return officeDocument(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xl/workbook.xml',
  );
}

export interface AssetBody {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  visibility: 'public' | 'private';
  storageBackend: string;
  folderId: string | null;
  label: string | null;
  altText: Record<string, string> | null;
  contentVersion: string;
  references: Array<{ kind: string; entityId: string }>;
  /** Absent on an upload's 201 body before feature 156's detail fields were read; set on every detail. */
  replaceable?: boolean;
}

export interface FilePart {
  filename: string;
  mime: string;
  value: Buffer;
}

/** `POST /api/v1/admin/assets`; fails the test on anything but 201. */
export async function uploadAsset(
  h: BackendServerHandle,
  file: FilePart,
  fields: Record<string, string> = {},
): Promise<AssetBody> {
  const parts: MultipartPart[] = [
    ...Object.entries(fields).map(([name, value]) => ({ name, value })),
    { name: 'file', ...file },
  ];
  const { body, contentType } = multipartBody(parts);
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/assets',
    headers: { 'content-type': contentType },
    cookies: ADMIN,
    payload: body,
  });
  if (res.statusCode !== 201) throw new Error(`uploadAsset: ${res.statusCode} ${res.body}`);
  return (res.json() as { data: AssetBody }).data;
}

/** `POST /api/v1/admin/assets/:id/replace` with an optional expected version and one file. */
export function replaceAsset(
  h: BackendServerHandle,
  assetId: string,
  file: FilePart | null,
  options: { expectedContentVersion?: string; cookies?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  const parts: MultipartPart[] = [];
  if (options.expectedContentVersion !== undefined) {
    parts.push({ name: 'expectedContentVersion', value: options.expectedContentVersion });
  }
  if (file) parts.push({ name: 'file', ...file });
  else parts.push({ name: 'note', value: 'no file here' });
  const { body, contentType } = multipartBody(parts);
  return h.app.inject({
    method: 'POST',
    url: `/api/v1/admin/assets/${assetId}/replace`,
    headers: { 'content-type': contentType },
    cookies: options.cookies ?? ADMIN,
    payload: body,
  });
}

/** Hard-deletes the given assets' rows, their attachments, gallery items and cleanup entries. */
export async function forgetAssets(h: BackendServerHandle, assetIds: readonly string[]): Promise<void> {
  if (assetIds.length === 0) return;
  const conn = h.em().getConnection();
  const ids = [...assetIds];
  const list = ids.map(() => '?').join(', ');
  await conn.execute(`delete from asset_object_cleanups where asset_id in (${list})`, ids);
  await conn.execute(`delete from product_attachments where asset_id in (${list})`, ids);
  await conn.execute(`delete from gallery_items where asset_id in (${list})`, ids);
  await conn.execute(`delete from assets where id in (${list})`, ids);
}

/** The cleanup entries left for an asset. */
export async function cleanupEntriesOf(
  h: BackendServerHandle,
  assetId: string,
): Promise<Array<{ locator: string; reason: string }>> {
  return h
    .em()
    .getConnection()
    .execute<Array<{ locator: string; reason: string }>>(
      `select locator, reason from asset_object_cleanups where asset_id = ?`,
      [assetId],
    );
}

/**
 * An administrator holding only `assets.read`, with a stub session of its own
 * (`tasks.md` standing rule 7): its role and user are created here and removed
 * by `undo`.
 */
export async function createAssetsReader(
  h: BackendServerHandle,
): Promise<{ cookies: { b2b_session: string }; undo: () => Promise<void> }> {
  const em = h.em();
  const role = em.create(AdminRole, {
    code: `${runName()}_assets_reader`,
    name: 'Assets reader (feature 156)',
    permissions: ['assets.read'],
  });
  await em.persist(role).flush();
  const user = em.create(AdminUser, {
    email: `${runName()}@assets.local`,
    passwordHash: 'x'.repeat(60),
    adminRoleId: role.id,
    firstName: 'Assets',
    lastName: 'Reader',
    status: 'active',
  });
  await em.persist(user).flush();
  const cookie = `stub-${runName()}-assets-reader`;
  ADMIN_COOKIES[cookie] = { adminUserId: user.id };
  return {
    cookies: { b2b_session: cookie },
    undo: async () => {
      delete ADMIN_COOKIES[cookie];
      const fresh = h.em();
      await fresh.nativeDelete(AdminUser, { id: user.id });
      await fresh.nativeDelete(AdminRole, { id: role.id });
    },
  };
}

/**
 * A retention sweeper over the composed module with some seams replaced — a
 * narrower batch, a captured log line, a hook between select and claim — built
 * from the module's own handle, as `hard-delete-worker.test.ts` builds its
 * worker (block review D: the production handle carries no test factory).
 */
export function testRetentionSweeper(
  h: BackendServerHandle,
  overrides: Partial<Pick<RetentionSweepDeps, 'batchSize' | 'log' | 'beforeClaim'>> = {},
): AssetRetentionSweeper {
  return createAssetRetentionSweeper({
    emFactory: h.em,
    adapters: h.assetsLibrary.adapters,
    referenceRegistry: h.assetsLibrary.referenceRegistry,
    loadRetentionDays: () => h.assetsLibrary.loadRetentionDays(),
    ...overrides,
  });
}
