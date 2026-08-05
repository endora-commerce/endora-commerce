import type { EntityManager } from '@mikro-orm/postgresql';
import { Category } from '../../../catalog/entities/category.entity.js';
import type { ImportExportAdapter, ImportRowResult } from '../adapter.js';

/**
 * Categories import/export. The CSV uses `parent_slug` to keep a parent
 * reference human-readable; an empty value means "root". Categories are
 * processed in the order they appear, so spreadsheets must list parents
 * before their children.
 *
 * Feature 068 — `is_active` rides along in both directions so a round-trip
 * through a spreadsheet does not silently re-publish a hidden category. An
 * absent or empty cell leaves the stored value alone (and defaults to active
 * on create), which keeps older exports importable.
 */
export const categoriesAdapter: ImportExportAdapter = {
  name: 'categories',
  exportHeader: ['id', 'slug', 'parent_slug', 'sort_order', 'name_en', 'is_active'] as const,

  async exportRows(em: EntityManager): Promise<string[][]> {
    const rows = await em.find(Category, {}, { orderBy: { slug: 'asc' } });
    const slugById = new Map(rows.map((c) => [c.id, c.slug]));
    return rows.map((c) => [
      c.id,
      c.slug,
      c.parentCategoryId ? (slugById.get(c.parentCategoryId) ?? '') : '',
      String(c.sortOrder),
      c.name['en-US'] ?? '',
      c.isActive ? 'true' : 'false',
    ]);
  },

  // `is_active` is deliberately NOT listed here: `importHeader` is the set of
  // columns the CSV must carry, and requiring it would reject every
  // spreadsheet produced before this feature.
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

    const isActiveRaw = row['is_active']?.trim().toLowerCase();
    let isActive: boolean | undefined;
    if (isActiveRaw !== undefined && isActiveRaw !== '') {
      if (isActiveRaw === 'true' || isActiveRaw === '1') isActive = true;
      else if (isActiveRaw === 'false' || isActiveRaw === '0') isActive = false;
      else return { ok: false, reason: `invalid is_active: ${row['is_active']}` };
    }

    const existing = await em.findOne(Category, { slug });
    if (existing) {
      existing.parentCategoryId = parentId;
      existing.sortOrder = sortOrder;
      existing.name = { ...existing.name, 'en-US': nameEn };
      if (isActive !== undefined) existing.isActive = isActive;
      return { ok: true };
    }
    em.create(Category, {
      slug,
      ...(parentId !== null ? { parentCategoryId: parentId } : {}),
      sortOrder,
      name: { 'en-US': nameEn },
      ...(isActive !== undefined ? { isActive } : {}),
    });
    return { ok: true };
  },
};
