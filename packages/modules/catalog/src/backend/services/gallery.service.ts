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

import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';

import {
  ERROR_CODES,
  type AssetReadPort,
  type CatalogGalleryBatchItem,
  type GalleryItem as GalleryItemDto,
  type GalleryLabel,
  type CreateGalleryItemRequest,
  type UpdateGalleryItemRequest,
} from '@endora-commerce/contracts';

import { HttpError } from '@endora-commerce/platform/http';
import type { CommandBus } from '@endora-commerce/platform/commands';
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
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 054 — audits gallery-item writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
    /**
     * Feature 075 — `assets_library`'s read port, where `em.findOne(Asset, …)`
     * used to be. It backs the kind check below, so with `assets_library` off
     * the port fails closed and a gallery item pointing at an unverifiable
     * asset is refused rather than stored.
     */
    private readonly assets?: AssetReadPort,
  ) {}

  #requireAssets(): AssetReadPort {
    if (!this.assets) {
      throw new Error(
        'GalleryService: the asset read port is not wired — a gallery item cannot be verified.',
      );
    }
    return this.assets;
  }

  /**
   * Feature 054 — run a gallery-item write through the Command Bus. The item +
   * audit are co-transactional; the raw-SQL LABEL writes stay AFTER the command
   * (a gallery item with no labels is a valid state, so nothing is orphaned).
   */
  async #audited<T>(
    action: string,
    objectId: string,
    write: (em: EntityManager) => Promise<{
      result: T;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>,
  ): Promise<T> {
    if (this.commandBus) {
      return this.commandBus.run({ action, objectType: 'gallery_item', objectId, run: ({ em }) => write(em) });
    }
    const em = this.emFactory();
    const w = await write(em);
    await em.flush();
    return w.result;
  }

  async list(productId: string): Promise<GalleryItemDto[]> {
    const em = this.emFactory();
    await this.#assertProductExists(em, productId);
    return this.#fetchAllForProduct(em, productId);
  }

  /**
   * Feature 075 / D-87 — the batch half of {@link list}, for the callers that
   * walk a page or a whole sellable catalogue.
   *
   * `product_feeds` used to run this statement itself, inside its own hydration
   * batch, against a table `catalog` owns. It named no import specifier, so the
   * boundary compiled and returned rows; `list` could not replace it because
   * three round-trips per product is 1500 for a 500-product batch.
   *
   * Two things are deliberately absent. There is **no `#assertProductExists`**:
   * a caller asks about the ids it holds, one of which may have been removed
   * since, and answering 404 for the batch would be answering about a different
   * question. And there are **no labels**: neither consumer reads them here, and
   * fetching them costs a second statement per batch.
   */
  async listForProducts(productIds: readonly string[]): Promise<CatalogGalleryBatchItem[]> {
    if (productIds.length === 0) return [];
    const ids = [...new Set(productIds)];
    // `em.execute`, not `em.getConnection().execute`, so a caller that opens a
    // transaction around this read sees its own uncommitted writes (issue #200).
    const rows = await this.emFactory().execute<
      Array<{ product_id: string; asset_id: string; position: number }>
    >(
      `select gi.product_id::text as product_id,
              gi.asset_id::text as asset_id,
              gi.position
         from gallery_items gi
        where gi.product_id in (${ids.map(() => '?').join(',')})
        order by gi.product_id, gi.position asc, gi.id asc`,
      ids,
    );
    return rows.map((row) => ({
      productId: row.product_id,
      assetId: row.asset_id,
      position: Number(row.position),
    }));
  }

  /**
   * Feature 075 / D-87 — the `base_image` url of each of a batch of products.
   *
   * `comparisons` used to answer this with one statement joining this module's
   * `gallery_item_labels` and `gallery_items` to `assets_library`'s `assets` —
   * three cross-module reaches in a single join, which is why they retire
   * together or not at all. Here the join stops at this module's own two tables
   * and the asset row is asked of its owner through the port this service
   * already holds, in one call for the whole batch.
   *
   * `base_image` only. This is not {@link resolvePrimaryAssetUrls}, which walks
   * thumbnail → base_image → first item and answers "which image represents
   * this product"; the comparison column names the base image explicitly
   * (feature 007, FR-006), and a fallback here would quietly put a thumbnail in
   * a column an operator set deliberately.
   *
   * The map holds one entry per requested id. `null` covers three cases the
   * callers render identically — no label, no product, no asset row — and the
   * inner join it replaces collapsed all three the same way.
   */
  async baseImageUrls(productIds: readonly string[]): Promise<Map<string, string | null>> {
    const urlByProduct = new Map<string, string | null>();
    for (const id of productIds) urlByProduct.set(id, null);
    if (urlByProduct.size === 0) return urlByProduct;

    const ids = [...urlByProduct.keys()];
    const rows = await this.emFactory().execute<Array<{ product_id: string; asset_id: string }>>(
      `select gil.product_id::text as product_id, gi.asset_id::text as asset_id
         from gallery_item_labels gil
         join gallery_items gi on gi.id = gil.gallery_item_id
        where gil.label = 'base_image'
          and gil.product_id in (${ids.map(() => '?').join(',')})`,
      ids,
    );
    if (rows.length === 0) return urlByProduct;

    // One call to the owner for every base image in the batch. `assets_library`
    // is a binding dependency of this module, so an absent owner fails closed
    // here rather than quietly answering "no product has an image".
    const assetIds = [...new Set(rows.map((row) => row.asset_id))];
    const urlByAsset = new Map(
      (await this.#requireAssets().findByIds(assetIds)).map((asset) => [
        asset.id,
        asset.storageUrl,
      ]),
    );
    for (const row of rows) {
      const url = urlByAsset.get(row.asset_id);
      if (url !== undefined) urlByProduct.set(row.product_id, url);
    }
    return urlByProduct;
  }

  async create(
    productId: string,
    req: CreateGalleryItemRequest,
    options: GalleryServiceOptions,
  ): Promise<GalleryItemDto> {
    const em0 = this.emFactory();
    await this.#assertProductExists(em0, productId);

    const asset = await this.#requireAssets().findById(req.assetId);
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
    const position = req.position ?? ((await this.#nextPosition(em0, productId)) as number);

    const id = randomUUID();
    await this.#audited('gallery_item.create', id, async (em) => {
      const item = em.create(GalleryItem, { id, productId, assetId: req.assetId, position });
      await em.flush();
      return {
        result: item,
        before: null,
        after: { productId, assetId: req.assetId, position, labels },
      };
    });

    // Labels run AFTER the item commits (bridge-after-command) — matches the
    // pre-054 two-step; an item with no labels is a valid state.
    const em = this.emFactory();
    if (labels.length > 0) {
      await this.#applyLabels(em, productId, id, labels, options);
    }
    return (await this.#fetchOne(em, id))!;
  }

  async update(
    productId: string,
    itemId: string,
    req: UpdateGalleryItemRequest,
    options: GalleryServiceOptions,
  ): Promise<GalleryItemDto> {
    await this.#audited('gallery_item.update', itemId, async (em) => {
      const item = await em.findOne(GalleryItem, { id: itemId, productId });
      if (!item) {
        throw new HttpError(
          404,
          ERROR_CODES.GALLERY_ITEM_NOT_FOUND,
          `Gallery item ${itemId} not found under Product ${productId}.`,
        );
      }
      const before = { position: item.position };
      if (req.position !== undefined) item.position = req.position;
      return { result: undefined, before, after: { position: item.position } };
    });

    // Label replacement runs AFTER the item update (bridge-after-command).
    if (req.labels !== undefined) {
      const em = this.emFactory();
      const labels = this.#normalizeAndValidateLabels(req.labels);
      await em.execute(`delete from gallery_item_labels where gallery_item_id = ?`, [itemId]);
      if (labels.length > 0) {
        await this.#applyLabels(em, productId, itemId, labels, options);
      }
    }

    return (await this.#fetchOne(this.emFactory(), itemId))!;
  }

  async delete(productId: string, itemId: string): Promise<void> {
    await this.#audited('gallery_item.delete', itemId, async (em) => {
      const item = await em.findOne(GalleryItem, { id: itemId, productId });
      if (!item) {
        throw new HttpError(
          404,
          ERROR_CODES.GALLERY_ITEM_NOT_FOUND,
          `Gallery item ${itemId} not found under Product ${productId}.`,
        );
      }
      const before = { productId, assetId: item.assetId };
      em.remove(item); // CASCADE on gallery_item_labels picks up the children.
      return { result: undefined, before, after: null };
    });
  }

  async reorder(productId: string, orderedIds: string[]): Promise<void> {
    const em = this.emFactory();
    await this.#assertProductExists(em, productId);
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
    // One UPDATE per row. `em.execute`, not `em.getConnection().execute`, so a
    // caller that ever opens a transaction around this gets the whole reorder
    // in it (issue #207). This comment used to claim the loop was transactional
    // and it is not: `em` here is a bare fork, so a failure part-way through
    // leaves the gallery in the order the successful updates put it.
    for (let i = 0; i < orderedIds.length; i++) {
      await em.execute(
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
    const rows = (await em.execute(
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
    if (options.replaceConflictingLabels) {
      // Remove any other assignment of these labels under the product.
      const placeholders = labels.map(() => '?').join(', ');
      await em.execute(
        `delete from gallery_item_labels
         where product_id = ? and label in (${placeholders}) and gallery_item_id <> ?`,
        [productId, ...labels, itemId],
      );
    } else {
      // Fail-fast on any conflict.
      const placeholders = labels.map(() => '?').join(', ');
      const conflicts = (await em.execute(
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
    await em.execute(
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
