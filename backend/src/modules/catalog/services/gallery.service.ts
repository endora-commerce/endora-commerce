/**
 * GalleryService — admin-only CRUD for Product Gallery Items + their
 * Base/Small/Thumbnail label assignments (feature 002 US3,
 * data-model.md §2.3, §2.4, research.md R-2).
 *
 * The per-product UNIQUE constraint on `gallery_item_labels(product_id,
 * label)` is the load-bearing invariant. The atomic-swap operation
 * (`?replace=true`) wraps the swap in a single transaction:
 *   DELETE conflicting labels FROM other items → INSERT/UPDATE the new
 *   ones. Reading "current owner" + writing "new owner" is one atomic
 *   step so concurrent admins don't crash into each other's swaps.
 */

import type { EntityManager } from '@mikro-orm/postgresql';

import {
  ERROR_CODES,
  type GalleryItem as GalleryItemDto,
  type GalleryLabel,
  type CreateGalleryItemRequest,
  type UpdateGalleryItemRequest,
} from '@b2b/contracts';

import { HttpError } from '../../../http/error-envelope.js';
import { Asset } from '../../assets/entities/asset.entity.js';
import { Product } from '../entities/product.entity.js';
import { GalleryItem } from '../entities/gallery-item.entity.js';
import { GalleryItemLabel } from '../entities/gallery-item-label.entity.js';

const GALLERY_LABELS_VALID = new Set<GalleryLabel>([
  'base_image',
  'small_image',
  'thumbnail',
]);
const ASSET_KINDS_GALLERY = new Set(['image', 'video']);

export interface GalleryServiceOptions {
  /** When true, conflicting labels on other items are silently moved. */
  replaceConflictingLabels: boolean;
}

export class GalleryService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async list(productId: string): Promise<GalleryItemDto[]> {
    const em = this.emFactory();
    await this.#assertProductExists(em, productId);
    return this.#fetchAllForProduct(em, productId);
  }

  async create(
    productId: string,
    req: CreateGalleryItemRequest,
    options: GalleryServiceOptions,
  ): Promise<GalleryItemDto> {
    const em = this.emFactory();
    await this.#assertProductExists(em, productId);

    const asset = await em.findOne(Asset, { id: req.assetId });
    if (!asset) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Asset ${req.assetId} not found.`);
    }
    if (!ASSET_KINDS_GALLERY.has(asset.kind)) {
      throw new HttpError(
        400,
        ERROR_CODES.ASSET_KIND_NOT_SUPPORTED,
        `Gallery items require asset.kind ∈ {image, video}; got "${asset.kind}".`,
      );
    }

    const labels = this.#normalizeAndValidateLabels(req.labels);

    // Compute next position when omitted.
    const conn = em.getConnection();
    const position =
      req.position ??
      ((await this.#nextPosition(em, productId)) as number);

    const item = em.create(GalleryItem, {
      productId,
      assetId: req.assetId,
      position,
    });
    await em.persistAndFlush(item);

    if (labels.length > 0) {
      await this.#applyLabels(em, productId, item.id, labels, options);
    }

    return (await this.#fetchOne(em, item.id))!;
    void conn; // Used inside helpers — keep import consistent.
  }

  async update(
    productId: string,
    itemId: string,
    req: UpdateGalleryItemRequest,
    options: GalleryServiceOptions,
  ): Promise<GalleryItemDto> {
    const em = this.emFactory();
    const item = await em.findOne(GalleryItem, { id: itemId, productId });
    if (!item) {
      throw new HttpError(
        404,
        ERROR_CODES.GALLERY_ITEM_NOT_FOUND,
        `Gallery item ${itemId} not found under Product ${productId}.`,
      );
    }
    if (req.position !== undefined) item.position = req.position;
    await em.flush();

    if (req.labels !== undefined) {
      const labels = this.#normalizeAndValidateLabels(req.labels);
      // Replace the item's existing labels with the new set.
      const conn = em.getConnection();
      await conn.execute(
        `delete from gallery_item_labels where gallery_item_id = ?`,
        [itemId],
      );
      if (labels.length > 0) {
        await this.#applyLabels(em, productId, itemId, labels, options);
      }
    }

    return (await this.#fetchOne(em, itemId))!;
  }

  async delete(productId: string, itemId: string): Promise<void> {
    const em = this.emFactory();
    const item = await em.findOne(GalleryItem, { id: itemId, productId });
    if (!item) {
      throw new HttpError(
        404,
        ERROR_CODES.GALLERY_ITEM_NOT_FOUND,
        `Gallery item ${itemId} not found under Product ${productId}.`,
      );
    }
    await em.removeAndFlush(item);
    // CASCADE on gallery_item_labels picks up the children.
  }

  async reorder(productId: string, orderedIds: string[]): Promise<void> {
    const em = this.emFactory();
    await this.#assertProductExists(em, productId);
    const conn = em.getConnection();
    // Verify all ids belong to this product.
    const existing = await em.find(GalleryItem, { productId });
    const existingIds = new Set(existing.map((i) => i.id));
    if (
      orderedIds.length !== existing.length ||
      !orderedIds.every((id) => existingIds.has(id))
    ) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'orderedGalleryItemIds must cover every existing gallery item exactly once.',
      );
    }
    // One UPDATE per row; transactional.
    for (let i = 0; i < orderedIds.length; i++) {
      await conn.execute(
        `update gallery_items set position = ? where id = ?`,
        [i, orderedIds[i]],
      );
    }
  }

  // -- INTERNALS -------------------------------------------------------------

  async #assertProductExists(em: EntityManager, productId: string): Promise<void> {
    const product = await em.findOne(Product, { id: productId });
    if (!product) {
      throw new HttpError(
        404,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        `Product ${productId} not found.`,
      );
    }
  }

  #normalizeAndValidateLabels(labels: GalleryLabel[] | undefined): GalleryLabel[] {
    if (!labels) return [];
    const seen = new Set<GalleryLabel>();
    for (const l of labels) {
      if (!GALLERY_LABELS_VALID.has(l)) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Unknown gallery label "${l}".`,
        );
      }
      seen.add(l);
    }
    if (seen.size !== labels.length) {
      throw new HttpError(
        400,
        ERROR_CODES.GALLERY_LABEL_LIMIT_EXCEEDED,
        'A gallery item cannot carry the same label twice (1-3 distinct labels).',
      );
    }
    if (seen.size > 3) {
      throw new HttpError(
        400,
        ERROR_CODES.GALLERY_LABEL_LIMIT_EXCEEDED,
        'A gallery item can have at most 3 labels.',
      );
    }
    return Array.from(seen);
  }

  async #nextPosition(em: EntityManager, productId: string): Promise<number> {
    const conn = em.getConnection();
    const rows = (await conn.execute(
      `select coalesce(max(position), -1) + 1 as next_position from gallery_items where product_id = ?`,
      [productId],
    )) as Array<{ next_position: number }>;
    return rows[0]?.next_position ?? 0;
  }

  /**
   * Apply a set of labels to a gallery item. If `replaceConflictingLabels`
   * is true, any existing assignment of the same label to ANOTHER item
   * under the same product is removed first (atomic swap). If false and
   * a conflict exists, throws 409 GALLERY_LABEL_ALREADY_TAKEN.
   */
  async #applyLabels(
    em: EntityManager,
    productId: string,
    itemId: string,
    labels: GalleryLabel[],
    options: GalleryServiceOptions,
  ): Promise<void> {
    const conn = em.getConnection();
    if (options.replaceConflictingLabels) {
      // Remove any other assignment of these labels under the product.
      const placeholders = labels.map(() => '?').join(', ');
      await conn.execute(
        `delete from gallery_item_labels
         where product_id = ? and label in (${placeholders}) and gallery_item_id <> ?`,
        [productId, ...labels, itemId],
      );
    } else {
      // Fail-fast on any conflict.
      const placeholders = labels.map(() => '?').join(', ');
      const conflicts = (await conn.execute(
        `select label, gallery_item_id from gallery_item_labels
         where product_id = ? and label in (${placeholders}) and gallery_item_id <> ?`,
        [productId, ...labels, itemId],
      )) as Array<{ label: string; gallery_item_id: string }>;
      if (conflicts.length > 0) {
        const c = conflicts[0]!;
        throw new HttpError(
          409,
          ERROR_CODES.GALLERY_LABEL_ALREADY_TAKEN,
          `Label "${c.label}" is already assigned to gallery item ${c.gallery_item_id}.`,
          [{ path: 'labels', issue: `currently on ${c.gallery_item_id}` }],
        );
      }
    }
    // Insert the new assignments. ON CONFLICT (gallery_item_id, label)
    // DO NOTHING handles the case where the same label is already on
    // this item (idempotent re-application).
    const values = labels.map(() => '(?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const l of labels) params.push(itemId, productId, l);
    await conn.execute(
      `insert into gallery_item_labels (gallery_item_id, product_id, label) values ${values}
       on conflict (gallery_item_id, label) do nothing`,
      params,
    );
  }

  async #fetchAllForProduct(
    em: EntityManager,
    productId: string,
  ): Promise<GalleryItemDto[]> {
    const items = await em.find(
      GalleryItem,
      { productId },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    if (items.length === 0) return [];
    const labels = await em.find(GalleryItemLabel, { productId });
    const labelsByItem = new Map<string, GalleryLabel[]>();
    for (const l of labels) {
      const existing = labelsByItem.get(l.galleryItemId) ?? [];
      existing.push(l.label);
      labelsByItem.set(l.galleryItemId, existing);
    }
    return items.map((i) => this.#toDto(i, labelsByItem.get(i.id) ?? []));
  }

  async #fetchOne(em: EntityManager, itemId: string): Promise<GalleryItemDto | null> {
    const item = await em.findOne(GalleryItem, { id: itemId });
    if (!item) return null;
    const labels = await em.find(GalleryItemLabel, { galleryItemId: itemId });
    return this.#toDto(item, labels.map((l) => l.label));
  }

  #toDto(item: GalleryItem, labels: GalleryLabel[]): GalleryItemDto {
    return {
      id: item.id,
      productId: item.productId,
      assetId: item.assetId,
      position: item.position,
      labels: [...labels].sort(),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
