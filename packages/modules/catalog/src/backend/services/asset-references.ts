// Catalog → Assets Library reference descriptors — feature 013 / US2 / T064.
//
// Registers the descriptors that the AssetReferenceRegistry consults when an
// admin tries to delete an asset (FR-030). The four column references each
// run a single batched query (`asset_id = ANY($1)`) and join back to the
// parent row's display info for the human-readable label rendered in the
// admin "in use by" dialog; the fifth looks inside a category's page content,
// where the reference is a string in a Page Builder document.

import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReference,
  AssetReferenceDescriptor,
  AssetReferenceRegistryPort,
} from '@endora-commerce/contracts';

export function registerCatalogAssetReferences(
  registry: AssetReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  const descriptors: AssetReferenceDescriptor[] = [
    productGalleryDescriptor(emFactory),
    productAttachmentDescriptor(emFactory),
    productVirtualDownloadDescriptor(emFactory),
    categoryMainImageDescriptor(emFactory),
    categoryContentDescriptor(emFactory),
  ];
  for (const d of descriptors) registry.register(d);
}

function productGalleryDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'catalog',
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
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
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
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
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const rows = (await em.execute(
        `select p.id::text as product_id, p.name as product_name
         from products p
         where p.download_asset_id in (${assetIds.map(() => '?').join(',')})`,
        assetIds,
      )) as Array<{ product_id: string; product_name: Record<string, string> | string }>;
      return rows.map((r) => ({
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
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const rows = (await em.execute(
        `select c.id::text as category_id, c.name as category_name
         from categories c
         where c.main_image_asset_id in (${assetIds.map(() => '?').join(',')})`,
        assetIds,
      )) as Array<{ category_id: string; category_name: Record<string, string> | string }>;
      return rows.map((r) => ({
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
 * The Page Builder stores the asset's id as a string somewhere in the block's
 * props, at a depth that depends on the block, so the lookup is a recursive
 * jsonpath over the whole envelope rather than a column comparison: the idiom
 * the CMS and the blog use for their own Page Builder columns. Soft-deleted
 * categories are skipped, as they are there — a deleted category's page is not
 * served, so its content holds nothing in use.
 */
function categoryContentDescriptor(
  emFactory: () => EntityManager,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'catalog',
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const em = emFactory();
      const out: AssetReference[] = [];
      for (const raw of assetIds) {
        // An asset id is a UUID; stripping everything else is what keeps the
        // literal-injected jsonpath safe (a jsonpath cannot take a bind).
        const assetId = raw.replace(/[^0-9a-fA-F-]/g, '');
        if (assetId === '') continue;
        const rows = (await em.execute(
          `select c.id::text as category_id, c.name as category_name
             from categories c
            where c.deleted_at is null
              and c.content is not null
              and jsonb_path_exists(c.content, '$.** ? (@ == "${assetId}")'::jsonpath)`,
        )) as Array<{ category_id: string; category_name: Record<string, string> | string }>;
        for (const r of rows) {
          out.push({
            kind: 'category_content',
            entityId: r.category_id,
            label: `Category "${pickName(r.category_name)}" — page content`,
          });
        }
      }
      return out;
    },
  };
}

function pickName(blob: Record<string, string> | string): string {
  if (typeof blob === 'string') return blob;
  return blob['en-US'] ?? blob['en'] ?? blob['pl'] ?? Object.values(blob)[0] ?? '(unnamed)';
}
