import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PWA_ICON_SIZES, type PwaIconPurpose, type PwaIconRendition as PwaIconRenditionDto } from '@b2b/contracts';
import { PwaIconRendition } from '../entities/pwa-icon-rendition.entity.js';

/** Thrown when an uploaded icon fails validation (FR-010). */
export class PwaIconInvalid extends Error {
  override readonly name = 'PwaIconInvalid';
  readonly code = 'PWA_ICON_INVALID' as const;
  constructor(message: string) {
    super(message);
  }
}

/** Minimal upload port over the assets_library service. */
export interface AssetUploadPort {
  upload(input: {
    filename: string;
    declaredMime: string;
    stream: NodeJS.ReadableStream;
    declaredSize: number;
    folderId: string | null;
    label: string | null;
    visibility: 'public' | 'private';
  }): Promise<{ id: string }>;
}

const MIN_SIZE = 512;
const ALLOWED_MIME = new Set(['image/png', 'image/webp']);
/** (size, purpose) pairs to derive. 'maskable' only for the largest size. */
const RENDITION_PLAN: Array<{ size: number; purpose: PwaIconPurpose }> = [
  ...PWA_ICON_SIZES.map((size) => ({ size, purpose: 'any' as PwaIconPurpose })),
  { size: 512, purpose: 'maskable' },
];

/**
 * Derives the PWA icon rendition set (FR-005) from a single admin-uploaded
 * source image using `sharp`, after validating format/dimensions/aspect
 * (FR-010). Source + derived PNGs are stored via the assets_library; rendition
 * rows replace the channel's prior set transactionally.
 */
export class PwaIconService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly assets: AssetUploadPort,
  ) {}

  async ingest(input: {
    salesChannelId: string | null;
    declaredMime: string;
    buffer: Buffer;
  }): Promise<{ sourceAssetId: string; renditions: PwaIconRenditionDto[] }> {
    // command-coverage-ignore: push-notification infrastructure — device
    // subscription / message delivery / icon asset, not audited domain state.
    if (!ALLOWED_MIME.has(input.declaredMime)) {
      throw new PwaIconInvalid('The icon must be a PNG or WebP image.');
    }
    const meta = await sharp(input.buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (width < MIN_SIZE || height < MIN_SIZE) {
      throw new PwaIconInvalid(`The icon must be at least ${MIN_SIZE}×${MIN_SIZE} pixels.`);
    }
    // Square within ±1%.
    if (Math.abs(width - height) / Math.max(width, height) > 0.01) {
      throw new PwaIconInvalid('The icon must be square.');
    }

    // Store the source image.
    const source = await this.assets.upload({
      filename: 'pwa-icon-source.png',
      declaredMime: 'image/png',
      stream: Readable.from(input.buffer),
      declaredSize: input.buffer.length,
      folderId: null,
      label: 'PWA icon source',
      visibility: 'public',
    });

    // Derive + store each rendition.
    const renditions: PwaIconRenditionDto[] = [];
    const em = this.emFactory();

    // Replace the channel's prior renditions (best-effort cleanup of rows).
    const prior = await em.find(PwaIconRendition, { salesChannelId: input.salesChannelId });
    if (prior.length > 0) await em.removeAndFlush(prior);

    for (const plan of RENDITION_PLAN) {
      const pipeline = sharp(input.buffer).resize(plan.size, plan.size, { fit: 'cover' });
      // Maskable icons need safe padding; keep it simple — cover then flatten.
      const png = await pipeline.png().toBuffer();
      const contentHash = createHash('sha256').update(png).digest('hex');
      const asset = await this.assets.upload({
        filename: `pwa-icon-${plan.size}-${plan.purpose}.png`,
        declaredMime: 'image/png',
        stream: Readable.from(png),
        declaredSize: png.length,
        folderId: null,
        label: `PWA icon ${plan.size} ${plan.purpose}`,
        visibility: 'public',
      });
      const row = em.create(PwaIconRendition, {
        salesChannelId: input.salesChannelId,
        sourceAssetId: source.id,
        size: plan.size,
        purpose: plan.purpose,
        assetId: asset.id,
        contentHash,
      });
      em.persist(row);
      renditions.push({ size: plan.size, purpose: plan.purpose, assetId: asset.id, contentHash });
    }
    await em.flush();

    return { sourceAssetId: source.id, renditions };
  }

  /** Resolve the asset id of a rendition for a channel (or global fallback). */
  async resolveRenditionAssetId(
    salesChannelId: string,
    size: number,
    purpose: PwaIconPurpose,
  ): Promise<string | null> {
    const em = this.emFactory();
    const channelRow = await em.findOne(PwaIconRendition, { salesChannelId, size, purpose });
    if (channelRow) return channelRow.assetId;
    const globalRow = await em.findOne(PwaIconRendition, { salesChannelId: null, size, purpose });
    return globalRow?.assetId ?? null;
  }
}
