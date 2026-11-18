import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import {
  ASSET_CHANGED_EVENT,
  ERROR_CODES,
  type AssetDetail,
  type AssetsLibraryPort,
  type AssetUploadStream,
} from '@endora-commerce/contracts';
import { AuditLogEntry, enterSystemScope, ModuleDisabledError } from '@endora-commerce/platform/kernel';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  cleanupEntriesOf,
  forgetAssets,
  pdfBytes,
  runName,
  TINY_JPEG,
} from '../../helpers/asset-replace-fixtures.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * Issue #694 — `assetsLibraryPort.replace`: a module replaces an asset's file in
 * place through the published port, with everything `specs/156-asset-stable-url/`
 * promises the admin route — same id, same storage key and URLs, a new content
 * version, the old file kept as the previous version, one `asset.replace` audit
 * row — and the same refusals.
 *
 * The bytes are mostly handed as a plain async iterable, never a Node stream:
 * that is the contract's `AssetUploadStream`, and the shape a module that never
 * imports `node:stream` sends. One case runs the other shapes a module may hand
 * (a Node `Readable`, a web `ReadableStream`, string chunks) and compares the
 * stored bytes. Further cases pin what the admin route's tests pin for the
 * route: the soft-deleted and legacy refusals, the one `asset_changed`
 * announcement on the container's bus, a source that breaks midway leaving
 * nothing behind, and two concurrent replaces of which exactly one wins.
 *
 * **Owner off.** `assets_library` declares `nonDeactivatable`, so the operator
 * axis has no off state; the platform axis — a deployment without the module —
 * does, and resolving the port there throws `ModuleDisabledError` before
 * anything is replaced.
 */
describe('assetsLibraryPort.replace (issue #694)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const created: string[] = [];

  const port = (): AssetsLibraryPort => h.container.resolve<AssetsLibraryPort>('assetsLibraryPort');
  const asSystem = <T>(label: string, run: () => Promise<T>): Promise<T> =>
    enterSystemScope(`test: assetsLibraryPort.replace — ${label}`, run);

  async function* bytesOf(value: Buffer): AsyncGenerator<Uint8Array> {
    yield new Uint8Array(value);
  }

  async function uploadPdf(marker: string): Promise<AssetDetail> {
    const value = pdfBytes(marker);
    const detail = await asSystem('upload', () =>
      port().upload({
        filename: `${runName()}-${marker}.pdf`,
        declaredMime: 'application/pdf',
        stream: bytesOf(value),
        declaredSize: value.length,
        folderId: null,
        label: null,
        visibility: 'public',
      }),
    );
    created.push(detail.id);
    return detail;
  }

  /** Every `asset_changed` announcement for `assetId` seen while `run` runs, on the container's bus. */
  async function announcementsDuring(assetId: string, run: () => Promise<unknown>): Promise<number> {
    const bus = h.container.resolve<{ on(name: string, handler: (payload: unknown) => void): () => void }>(
      'eventBus',
    );
    let seen = 0;
    const off = bus.on(ASSET_CHANGED_EVENT, (payload) => {
      if ((payload as { assetIds?: readonly string[] }).assetIds?.includes(assetId)) seen += 1;
    });
    try {
      await run();
    } finally {
      off();
    }
    return seen;
  }

  /** The staging and previous-version keys left beside an asset's stable key. */
  async function siblingsOf(assetId: string): Promise<string[]> {
    const entries = (await readdir(store.baseDir, { recursive: true })).map(String);
    return entries.filter(
      (name) => name.includes(assetId) && (name.includes('.stage-') || name.includes('.prev-')),
    );
  }

  const auditCount = (assetId: string): Promise<number> =>
    h.em().fork().count(AuditLogEntry, { action: 'asset.replace', objectId: assetId });

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
  }, 120_000);

  afterAll(async () => {
    await forgetAssets(h, created);
    await store.undo();
    await teardownBackendServer(h);
  });

  it('keeps the id and every URL, changes the content version and keeps the previous file', async () => {
    const original = await uploadPdf('original');
    const before = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    const replacement = pdfBytes('replacement from a PIM');
    const filename = `${runName()}-replacement.pdf`;

    const detail = await asSystem('replace', () =>
      port().replace({
        assetId: original.id,
        filename,
        declaredMime: 'application/pdf',
        stream: bytesOf(replacement),
        declaredSize: replacement.length,
        expectedContentVersion: original.contentVersion,
      }),
    );

    expect(detail.id).toBe(original.id);
    expect(detail.fileUrl).toBe(original.fileUrl);
    expect(detail.contentVersion).not.toBe(original.contentVersion);
    expect(detail.filename).toBe(filename);

    const row = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(row.storageLocator).toBe(before.storageLocator);
    expect(row.previousContentVersion).toBe(original.contentVersion);
    expect(row.previousFilename).toBe(original.filename);
    expect((await readFile(join(store.baseDir, row.storageLocator))).equals(replacement)).toBe(true);
    const served = await h.app.inject({ method: 'GET', url: `/assets/file/${original.id}` });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(replacement)).toBe(true);

    const audit = await h.em().fork().find(AuditLogEntry, { action: 'asset.replace', objectId: original.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.stateAfter).toMatchObject({ filename });
    // In system scope the audit row names no acting administrator, and nothing
    // on it records which module called the port.
    expect(audit[0]!.actorAdminUserId ?? null).toBeNull();
  });

  it('refuses a stale expected content version with ASSET_REPLACE_CONFLICT and changes nothing', async () => {
    const original = await uploadPdf('conflict');
    const replacement = pdfBytes('too late');

    await expect(
      asSystem('stale replace', () =>
        port().replace({
          assetId: original.id,
          filename: `${runName()}-late.pdf`,
          declaredMime: 'application/pdf',
          stream: bytesOf(replacement),
          declaredSize: replacement.length,
          expectedContentVersion: 'ffffffffffff',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.ASSET_REPLACE_CONFLICT });

    const row = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(row.contentVersion).toBe(original.contentVersion);
    expect(row.filename).toBe(original.filename);
  });

  it('refuses a file of another kind with ASSET_REPLACE_KIND_MISMATCH', async () => {
    const original = await uploadPdf('kind');

    await expect(
      asSystem('kind mismatch', () =>
        port().replace({
          assetId: original.id,
          filename: `${runName()}-photo.jpg`,
          declaredMime: 'image/jpeg',
          stream: bytesOf(TINY_JPEG),
          declaredSize: TINY_JPEG.length,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 415, code: ERROR_CODES.ASSET_REPLACE_KIND_MISMATCH });

    const row = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(row.contentVersion).toBe(original.contentVersion);
  });

  it('refuses an unknown asset with ASSET_NOT_FOUND', async () => {
    const replacement = pdfBytes('nobody');
    await expect(
      asSystem('unknown asset', () =>
        port().replace({
          assetId: randomUUID(),
          filename: `${runName()}-nobody.pdf`,
          declaredMime: 'application/pdf',
          stream: bytesOf(replacement),
          declaredSize: replacement.length,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: ERROR_CODES.ASSET_NOT_FOUND });
  });

  it('refuses a soft-deleted asset with ASSET_GONE and changes nothing', async () => {
    const original = await uploadPdf('gone');
    await asSystem('soft delete', () => port().softDelete(original.id));
    const replacement = pdfBytes('after delete');

    await expect(
      asSystem('replace soft-deleted', () =>
        port().replace({
          assetId: original.id,
          filename: `${runName()}-gone.pdf`,
          declaredMime: 'application/pdf',
          stream: bytesOf(replacement),
          declaredSize: replacement.length,
          expectedContentVersion: original.contentVersion,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 410, code: ERROR_CODES.ASSET_GONE });

    const row = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(row.contentVersion).toBe(original.contentVersion);
    expect(await auditCount(original.id)).toBe(0);
  });

  it('refuses a legacy asset (no storage key this platform wrote) with ASSET_LEGACY_CANNOT_REPLACE', async () => {
    const em = h.em().fork();
    const legacy = em.create(Asset, {
      kind: 'pdf',
      filename: `${runName()}-legacy.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: '0',
      storageUrl: `https://example.com/${runName()}.pdf`,
      storageLocator: `https://example.com/${runName()}.pdf`,
      storageBackend: 'legacy',
      visibility: 'public',
    });
    await em.persistAndFlush(legacy);
    created.push(legacy.id);
    const replacement = pdfBytes('over legacy');

    await expect(
      asSystem('replace legacy', () =>
        port().replace({
          assetId: legacy.id,
          filename: `${runName()}-legacy-2.pdf`,
          declaredMime: 'application/pdf',
          stream: bytesOf(replacement),
          declaredSize: replacement.length,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.ASSET_LEGACY_CANNOT_REPLACE });

    const row = await h.em().fork().findOneOrFail(Asset, { id: legacy.id });
    expect(row.contentVersion).toBe(legacy.contentVersion);
    expect(row.storageLocator).toBe(legacy.storageLocator);
  });

  it('announces ASSET_CHANGED_EVENT exactly once for a successful replace, and not for a refused one', async () => {
    const original = await uploadPdf('announce');
    let detail: AssetDetail | undefined;
    const replacement = pdfBytes('announced');

    const onSuccess = await announcementsDuring(original.id, async () => {
      detail = await asSystem('announced replace', () =>
        port().replace({
          assetId: original.id,
          filename: `${runName()}-announced.pdf`,
          declaredMime: 'application/pdf',
          stream: bytesOf(replacement),
          declaredSize: replacement.length,
          expectedContentVersion: original.contentVersion,
        }),
      );
    });
    expect(onSuccess).toBe(1);
    expect(detail!.contentVersion).not.toBe(original.contentVersion);

    // The version the first replace superseded is stale now.
    const onConflict = await announcementsDuring(original.id, async () => {
      await expect(
        asSystem('stale announced replace', () =>
          port().replace({
            assetId: original.id,
            filename: `${runName()}-stale.pdf`,
            declaredMime: 'application/pdf',
            stream: bytesOf(pdfBytes('stale')),
            declaredSize: 0,
            expectedContentVersion: original.contentVersion,
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.ASSET_REPLACE_CONFLICT });
    });
    expect(onConflict).toBe(0);
  });

  // A source that breaks after a few bytes: the rejection is the source's own
  // error, a plain `Error` with no `HttpError` status or code (the admin route
  // would answer it as a 500). The bytes stay under the 4100-byte MIME sniff
  // head on purpose — a source that fails *after* the head is a separate,
  // pre-existing UploadPipeline defect shared with upload and the route (the
  // counting stream is attached with `.pipe`, which does not forward the
  // source's error, so the write never settles), tracked outside issue #694
  // as issue #1423 (UploadPipeline.stage hangs after the sniff head).
  it('rejects with the source error (plain Error "source broke", no HttpError code) and leaves nothing behind', async () => {
    const original = await uploadPdf('broken-source');
    const before = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    const originalBytes = await readFile(join(store.baseDir, before.storageLocator));

    async function* breaksMidway(): AsyncGenerator<Uint8Array> {
      yield new Uint8Array(Buffer.from('%PDF-1.4\n% the first bytes of a file the source never finishes\n'));
      throw new Error('source broke');
    }

    let rejection: unknown;
    const announced = await announcementsDuring(original.id, async () => {
      await asSystem('broken source', () =>
        port().replace({
          assetId: original.id,
          filename: `${runName()}-broken.pdf`,
          declaredMime: 'application/pdf',
          stream: breaksMidway(),
          declaredSize: 0,
          expectedContentVersion: original.contentVersion,
        }),
      ).catch((err: unknown) => {
        rejection = err;
      });
    });

    expect(rejection).toBeInstanceOf(Error);
    expect((rejection as Error).message).toBe('source broke');
    expect((rejection as { statusCode?: number }).statusCode).toBeUndefined();
    expect(announced).toBe(0);

    const row = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(row.contentVersion).toBe(original.contentVersion);
    expect(row.filename).toBe(original.filename);
    expect(row.previousStorageLocator ?? null).toBeNull();
    expect((await readFile(join(store.baseDir, before.storageLocator))).equals(originalBytes)).toBe(true);
    const served = await h.app.inject({ method: 'GET', url: `/assets/file/${original.id}` });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(originalBytes)).toBe(true);
    expect(await auditCount(original.id)).toBe(0);
    expect(await siblingsOf(original.id)).toEqual([]);
    expect(await cleanupEntriesOf(h, original.id)).toEqual([]);
  });

  const inputShapes: Array<[string, (value: Buffer) => AssetUploadStream]> = [
    ['a Node Readable', (value) => Readable.from([value])],
    [
      'a web ReadableStream',
      (value) =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(value));
            controller.close();
          },
        }),
    ],
    [
      'an async generator yielding a string chunk',
      (value) =>
        (async function* (): AsyncGenerator<string> {
          yield value.toString('utf8');
        })(),
    ],
  ];

  it.each(inputShapes)('stores exactly the bytes of %s', async (label, toStream) => {
    const original = await uploadPdf(`shape-${label.replace(/\W+/g, '-')}`);
    const replacement = pdfBytes(`replacement as ${label}`);

    const detail = await asSystem(`replace from ${label}`, () =>
      port().replace({
        assetId: original.id,
        filename: `${runName()}-shape.pdf`,
        declaredMime: 'application/pdf',
        stream: toStream(replacement),
        declaredSize: replacement.length,
        expectedContentVersion: original.contentVersion,
      }),
    );

    expect(detail.contentVersion).not.toBe(original.contentVersion);
    const row = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(Number(row.sizeBytes)).toBe(replacement.length);
    expect((await readFile(join(store.baseDir, row.storageLocator))).equals(replacement)).toBe(true);
  });

  it('lets exactly one of two concurrent port replaces with the same expected version win', async () => {
    const original = await uploadPdf('concurrent');
    const replaceWith = (marker: string): Promise<AssetDetail> => {
      const value = pdfBytes(marker);
      return asSystem(`concurrent ${marker}`, () =>
        port().replace({
          assetId: original.id,
          filename: `${runName()}-${marker}.pdf`,
          declaredMime: 'application/pdf',
          stream: bytesOf(value),
          declaredSize: value.length,
          expectedContentVersion: original.contentVersion,
        }),
      );
    };

    const results = await Promise.allSettled([replaceWith('candidate-a'), replaceWith('candidate-b')]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ statusCode: 409, code: ERROR_CODES.ASSET_REPLACE_CONFLICT });
    expect(await auditCount(original.id)).toBe(1);
  });

  it('fails closed while assets_library is platform-unavailable, and answers again once it is back', async () => {
    const original = await uploadPdf('owner-off');
    const replacement = pdfBytes('while off');
    const replace = (): Promise<AssetDetail> =>
      asSystem('owner off', () =>
        port().replace({
          assetId: original.id,
          filename: `${runName()}-off.pdf`,
          declaredMime: 'application/pdf',
          stream: bytesOf(replacement),
          declaredSize: replacement.length,
          expectedContentVersion: original.contentVersion,
        }),
      );

    await withModuleOff('assets_library', 'platform-unavailable', async () => {
      await expect(replace()).rejects.toBeInstanceOf(ModuleDisabledError);
    });

    const untouched = await h.em().fork().findOneOrFail(Asset, { id: original.id });
    expect(untouched.contentVersion).toBe(original.contentVersion);
    expect(
      await h.em().fork().count(AuditLogEntry, { action: 'asset.replace', objectId: original.id }),
    ).toBe(0);

    // The positive control: the same call, the module back, goes through.
    const detail = await replace();
    expect(detail.id).toBe(original.id);
    expect(detail.contentVersion).not.toBe(original.contentVersion);
  });
});
