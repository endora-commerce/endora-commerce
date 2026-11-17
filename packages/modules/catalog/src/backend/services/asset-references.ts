// Catalog → Assets Library reference descriptors — feature 013 / US2 / T064.
//
// Registers the descriptors that the AssetReferenceRegistry consults when an
// admin tries to delete an asset (FR-030). The four column references each
// run a single batched query (`asset_id = ANY($1)`) and join back to the
// parent row's display info for the human-readable label rendered in the
// admin "in use by" dialog; the fifth looks inside a category's page content,
// and the sixth inside a product's Page Builder content attributes (feature
// 172), where the reference is a string under an `*assetId` key of a Page
// Builder document.

import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReferenceDescriptor,
  AssetReferenceHit,
  AssetReferenceRegistryPort,
} from '@endora-commerce/contracts';

/**
 * The attribute read model's one method the product-content descriptor needs:
 * the key of a content attribute, for its label. Optional — without it the
 * label names the attribute by id — and asked only when a hit was found.
 */
export interface CatalogAssetReferenceAttributeKeys {
  listAll(): Promise<ReadonlyArray<{ id: string; key: string }>>;
}

export function registerCatalogAssetReferences(
  registry: AssetReferenceRegistryPort,
  emFactory: () => EntityManager,
  attributeRead?: CatalogAssetReferenceAttributeKeys,
): void {
  const descriptors: AssetReferenceDescriptor[] = [
    productGalleryDescriptor(emFactory),
    productAttachmentDescriptor(emFactory),
    productVirtualDownloadDescriptor(emFactory),
    categoryMainImageDescriptor(emFactory),
    categoryContentDescriptor(emFactory),
    productContentDescriptor(emFactory, attributeRead),
  ];
  for (const d of descriptors) registry.register(d);
}

function productGalleryDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'catalog',
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const rows = (await em.execute(
        `select gi.asset_id::text as asset_id,
                gi.id::text as item_id,
                gi.position,
                p.id::text as product_id,
                p.name as product_name
         from gallery_items gi
         join products p on p.id = gi.product_id
         where gi.asset_id in (${assetIds.map(() => '?').join(',')})`,
        assetIds,
      )) as Array<{
        asset_id: string;
        item_id: string;
        position: number;
        product_id: string;
        product_name: Record<string, string> | string;
      }>;
      return rows.map((r) => ({
        assetId: r.asset_id,
        kind: 'product_gallery',
        entityId: r.product_id,
        label: `Product "${pickName(r.product_name)}" — gallery position ${r.position}`,
      }));
    },
  };
}

function productAttachmentDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'catalog',
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const rows = (await em.execute(
        `select pa.asset_id::text as asset_id,
                pa.name as attachment_name,
                p.id::text as product_id,
                p.name as product_name
         from product_attachments pa
         join products p on p.id = pa.product_id
         where pa.asset_id in (${assetIds.map(() => '?').join(',')})`,
        assetIds,
      )) as Array<{
        asset_id: string;
        attachment_name: string;
        product_id: string;
        product_name: Record<string, string> | string;
      }>;
      return rows.map((r) => ({
        assetId: r.asset_id,
        kind: 'product_attachment',
        entityId: r.product_id,
        label: `Product "${pickName(r.product_name)}" — attachment "${r.attachment_name}"`,
      }));
    },
  };
}

function productVirtualDownloadDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'catalog',
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const rows = (await em.execute(
        `select p.download_asset_id::text as asset_id, p.id::text as product_id, p.name as product_name
         from products p
         where p.download_asset_id in (${assetIds.map(() => '?').join(',')})`,
        assetIds,
      )) as Array<{ asset_id: string; product_id: string; product_name: Record<string, string> | string }>;
      return rows.map((r) => ({
        assetId: r.asset_id,
        kind: 'product_virtual_download',
        entityId: r.product_id,
        label: `Product "${pickName(r.product_name)}" — virtual download`,
      }));
    },
  };
}

function categoryMainImageDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'catalog',
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const rows = (await em.execute(
        `select c.main_image_asset_id::text as asset_id, c.id::text as category_id, c.name as category_name
         from categories c
         where c.main_image_asset_id in (${assetIds.map(() => '?').join(',')})`,
        assetIds,
      )) as Array<{ asset_id: string; category_id: string; category_name: Record<string, string> | string }>;
      return rows.map((r) => ({
        assetId: r.asset_id,
        kind: 'category_main_image',
        entityId: r.category_id,
        label: `Category "${pickName(r.category_name)}" — main image`,
      }));
    },
  };
}

/**
 * A library asset embedded in a category's page content — an image block, a
 * hero background, a slide.
 *
 * The Page Builder stores the asset's id as a string under a key ending in
 * `assetId` (case-insensitive) somewhere in the block's props, at a depth that
 * depends on the block, so the lookup walks the whole envelope rather than
 * comparing a column: the idiom the CMS and the blog use for their own Page
 * Builder columns, and the rule every renderer reads embeds by. An id under
 * any other key is never rendered, so it is no reference (issue #1359).
 * Soft-deleted categories are skipped, as they are there — a deleted
 * category's page is not served, so its content holds nothing in use.
 *
 * **One statement for the whole batch** (`specs/166-asset-reference-visibility/`
 * research R-6): every object of each document (`strict $.**` visits every
 * level, array elements included) is walked once and its `*assetId` entries
 * are matched against the asked ids, so a document is walked once however many
 * ids are asked, and the matched value is the asset id the hit is tagged with.
 * The jsonpath filter's `?` is written `\\?`: `em.execute` reads a bare `?` as
 * a placeholder.
 */
function categoryContentDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'catalog',
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      const asked = textArrayLiteral(assetIds);
      if (asked === null) return [];
      const rows = (await emFactory().execute(
        `select distinct c.id::text as category_id, c.name as category_name, e.value as asset_id
           from categories c
           cross join lateral jsonb_path_query(c.content, 'strict $.** \\? (@.type() == "object")') as o(node)
           cross join lateral jsonb_each_text(o.node) as e(key, value)
          where c.deleted_at is null
            and c.content is not null
            and e.key ~* 'assetid$'
            and e.value = any(?::text[])`,
        [asked],
      )) as Array<{ category_id: string; category_name: Record<string, string> | string; asset_id: string }>;
      return rows.map((r) => ({
        assetId: r.asset_id,
        kind: 'category_content',
        entityId: r.category_id,
        label: `Category "${pickName(r.category_name)}" — page content`,
      }));
    },
  };
}

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-062, FR-063, research
 * R-17) — a library asset embedded in a product's Page Builder content
 * attribute. The category-content idiom over `product_content_values`: one
 * statement per batch, every object of each document walked once
 * (`strict $.**`), only a string under an `*assetId` key counted (issue #1359). The hit names the **product**, so the "in use by" dialog
 * points at the product whose content holds it. A soft-deleted product's
 * content is unreachable (owner ruling OR-6), so it holds nothing in use.
 */
function productContentDescriptor(
  emFactory: () => EntityManager,
  attributeRead: CatalogAssetReferenceAttributeKeys | undefined,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'catalog',
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      const asked = textArrayLiteral(assetIds);
      if (asked === null) return [];
      const rows = (await emFactory().execute(
        `select distinct p.id::text as product_id, p.name as product_name,
                pcv.product_attribute_id::text as attribute_id, e.value as asset_id
           from product_content_values pcv
           join products p on p.id = pcv.product_id
           cross join lateral jsonb_path_query(pcv.content, 'strict $.** \\? (@.type() == "object")') as o(node)
           cross join lateral jsonb_each_text(o.node) as e(key, value)
          where p.deleted_at is null
            and e.key ~* 'assetid$'
            and e.value = any(?::text[])`,
        [asked],
      )) as Array<{
        product_id: string;
        product_name: Record<string, string> | string;
        attribute_id: string;
        asset_id: string;
      }>;
      if (rows.length === 0) return [];
      // The key lives on the definition, which is `custom_fields`' row: it is
      // asked of the attribute read model, never joined here.
      const keys = new Map((attributeRead ? await attributeRead.listAll() : []).map((a) => [a.id, a.key]));
      return rows.map((r) => ({
        assetId: r.asset_id,
        kind: 'product_content',
        entityId: r.product_id,
        label: `Product "${pickName(r.product_name)}" — content "${keys.get(r.attribute_id) ?? r.attribute_id}"`,
      }));
    },
  };
}

/**
 * The asked ids as one Postgres `text[]` literal, or `null` when none is left.
 * An asset id is a UUID; everything else is stripped, which is what keeps the
 * literal well-formed (`em.execute` formats a JavaScript array as a list, not
 * as one array value).
 */
function textArrayLiteral(assetIds: readonly string[]): string | null {
  const ids = [...new Set(assetIds.map((raw) => raw.replace(/[^0-9a-fA-F-]/g, '')).filter((id) => id !== ''))];
  return ids.length === 0 ? null : `{${ids.map((id) => `"${id}"`).join(',')}}`;
}

function pickName(blob: Record<string, string> | string): string {
  if (typeof blob === 'string') return blob;
  return blob['en-US'] ?? blob['en'] ?? blob['pl'] ?? Object.values(blob)[0] ?? '(unnamed)';
}
