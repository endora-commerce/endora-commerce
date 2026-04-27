import type { EntityManager } from '@mikro-orm/postgresql';
import { Category } from '../../../catalog/entities/category.entity.js';
import type { ImportExportAdapter, ImportRowResult } from '../adapter.js';

/**
 * Categories import/export. The CSV uses `parent_slug` to keep a parent
 * reference human-readable; an empty value means "root". Categories are
 * processed in the order they appear, so spreadsheets must list parents
 * before their children.
 */
export const categoriesAdapter: ImportExportAdapter = {
  name: 'categories',
  exportHeader: ['id', 'slug', 'parent_slug', 'sort_order', 'name_en'] as const,

  async exportRows(em: EntityManager): Promise<string[][]> {
    const rows = await em.find(Category, {}, { orderBy: { slug: 'asc' } });
    const slugById = new Map(rows.map((c) => [c.id, c.slug]));
    return rows.map((c) => [
      c.id,
      c.slug,
      c.parentCategoryId ? (slugById.get(c.parentCategoryId) ?? '') : '',
      String(c.sortOrder),
      c.name['en-US'] ?? '',
    ]);
  },

  importHeader: ['slug', 'parent_slug', 'sort_order', 'name_en'] as const,

  async importRow(em, row): Promise<ImportRowResult> {
    const slug = row['slug']?.trim();
    if (!slug) return { ok: false, reason: 'slug is required' };

    const nameEn = row['name_en']?.trim();
    if (!nameEn) return { ok: false, reason: 'name_en is required' };

    const parentSlug = row['parent_slug']?.trim();
    let parentId: string | null = null;
    if (parentSlug) {
      const parent = await em.findOne(Category, { slug: parentSlug });
      if (!parent) return { ok: false, reason: `unknown parent_slug: ${parentSlug}` };
      parentId = parent.id;
    }

    const sortOrderRaw = row['sort_order']?.trim();
    const sortOrder = sortOrderRaw ? Number.parseInt(sortOrderRaw, 10) : 0;
    if (Number.isNaN(sortOrder)) {
      return { ok: false, reason: `invalid sort_order: ${sortOrderRaw}` };
    }

    const existing = await em.findOne(Category, { slug });
    if (existing) {
      existing.parentCategoryId = parentId;
      existing.sortOrder = sortOrder;
      existing.name = { ...existing.name, 'en-US': nameEn };
      return { ok: true };
    }
    em.create(Category, {
      slug,
      ...(parentId !== null ? { parentCategoryId: parentId } : {}),
      sortOrder,
      name: { 'en-US': nameEn },
    });
    return { ok: true };
  },
};
