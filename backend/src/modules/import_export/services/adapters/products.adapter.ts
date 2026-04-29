import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../../../catalog/entities/product.entity.js';
import type { ImportExportAdapter, ImportRowResult } from '../adapter.js';

const PRODUCT_TYPES = new Set(['simple', 'configurable', 'grouped', 'bundle', 'virtual']);
const PRODUCT_STATUSES = new Set(['draft', 'active', 'archived']);
const PRODUCT_VISIBILITIES = new Set([
  'public',
  'logged_in_only',
  'organization_restricted',
]);

/**
 * Products import/export. The CSV is intentionally flat — multilingual
 * `name`/`description` collapse to a single locale column (defaults to
 * `en-US`). Power users who need full multi-locale round-trip should use the
 * JSON API directly.
 */
export const productsAdapter: ImportExportAdapter = {
  name: 'products',
  exportHeader: [
    'id',
    'sku',
    'slug',
    'type',
    'status',
    'visibility',
    'name_en',
    'description_en',
  ] as const,

  async exportRows(em: EntityManager): Promise<string[][]> {
    const rows = await em.find(Product, {}, { orderBy: { sku: 'asc' } });
    return rows.map((p) => [
      p.id,
      p.sku,
      p.slug,
      p.type,
      p.status,
      p.visibility,
      p.name['en-US'] ?? '',
      p.description['en-US'] ?? '',
    ]);
  },

  importHeader: ['sku', 'status', 'visibility', 'name_en', 'description_en'] as const,

  async importRow(em, row): Promise<ImportRowResult> {
    const sku = row['sku']?.trim();
    if (!sku) return { ok: false, reason: 'sku is required' };
    const product = await em.findOne(Product, { sku });
    if (!product) return { ok: false, reason: `unknown sku: ${sku}` };

    const status = row['status']?.trim();
    if (status) {
      if (!PRODUCT_STATUSES.has(status)) {
        return { ok: false, reason: `invalid status: ${status}` };
      }
      product.status = status as Product['status'];
    }

    const visibility = row['visibility']?.trim();
    if (visibility) {
      if (!PRODUCT_VISIBILITIES.has(visibility)) {
        return { ok: false, reason: `invalid visibility: ${visibility}` };
      }
      product.visibility = visibility as Product['visibility'];
    }

    const nameEn = row['name_en'];
    if (nameEn !== undefined && nameEn !== '') {
      product.name = { ...product.name, 'en-US': nameEn };
    }
    const descEn = row['description_en'];
    if (descEn !== undefined && descEn !== '') {
      product.description = { ...product.description, 'en-US': descEn };
    }
    // The `type` field is intentionally not editable post-create — see the
    // FIELD_IMMUTABLE error code in catalog. Operators changing a product's
    // structural type should issue a delete + recreate via the API.
    return { ok: true };
  },
};

// Silence the unused import warning when type narrowing is the only consumer.
void PRODUCT_TYPES;
