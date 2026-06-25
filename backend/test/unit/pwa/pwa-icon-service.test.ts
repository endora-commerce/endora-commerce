import { beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { PwaIconInvalid, PwaIconService, type AssetUploadPort } from '../../../src/modules/pwa/services/pwa-icon-service.js';

/** Fake EM: find returns [], create echoes, persist/flush/removeAndFlush no-op. */
function fakeEmFactory() {
  return () =>
    ({
      async find() {
        return [];
      },
      create(_entity: unknown, data: Record<string, unknown>) {
        return { ...data };
      },
      persist() {},
      async flush() {},
      async removeAndFlush() {},
    }) as never;
}

/** Asset upload port that records each upload and hands back a fresh id. */
function recordingUploader(): AssetUploadPort & { count: number } {
  let count = 0;
  return {
    get count() {
      return count;
    },
    async upload() {
      count += 1;
      return { id: `00000000-0000-4000-8000-00000000000${count}` };
    },
  } as AssetUploadPort & { count: number };
}

async function squarePng(size: number): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe('PwaIconService.ingest (feature 046, FR-005/010)', () => {
  let valid512: Buffer;
  let tooSmall: Buffer;
  let nonSquare: Buffer;

  beforeAll(async () => {
    valid512 = await squarePng(512);
    tooSmall = await squarePng(256);
    nonSquare = await sharp({
      create: { width: 600, height: 400, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
    })
      .png()
      .toBuffer();
  });

  it('rejects a non-PNG/WebP mime', async () => {
    const svc = new PwaIconService(fakeEmFactory(), recordingUploader());
    await expect(
      svc.ingest({ salesChannelId: null, declaredMime: 'image/gif', buffer: valid512 }),
    ).rejects.toBeInstanceOf(PwaIconInvalid);
  });

  it('rejects an image smaller than 512×512', async () => {
    const svc = new PwaIconService(fakeEmFactory(), recordingUploader());
    await expect(
      svc.ingest({ salesChannelId: null, declaredMime: 'image/png', buffer: tooSmall }),
    ).rejects.toBeInstanceOf(PwaIconInvalid);
  });

  it('rejects a non-square image', async () => {
    const svc = new PwaIconService(fakeEmFactory(), recordingUploader());
    await expect(
      svc.ingest({ salesChannelId: null, declaredMime: 'image/png', buffer: nonSquare }),
    ).rejects.toBeInstanceOf(PwaIconInvalid);
  });

  it('derives 180/192/512 + 512-maskable renditions from a valid source', async () => {
    const uploader = recordingUploader();
    const svc = new PwaIconService(fakeEmFactory(), uploader);
    const result = await svc.ingest({ salesChannelId: null, declaredMime: 'image/png', buffer: valid512 });

    expect(result.sourceAssetId).toBeTruthy();
    // 4 renditions: 180/any, 192/any, 512/any, 512/maskable.
    const pairs = result.renditions.map((r) => `${r.size}-${r.purpose}`).sort();
    expect(pairs).toEqual(['180-any', '192-any', '512-any', '512-maskable']);
    // Each rendition carries a content hash.
    expect(result.renditions.every((r) => r.contentHash.length === 64)).toBe(true);
    // 1 source + 4 renditions = 5 uploads.
    expect(uploader.count).toBe(5);
  });
});
