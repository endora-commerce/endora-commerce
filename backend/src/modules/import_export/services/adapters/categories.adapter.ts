import type { BulkImportReport, BulkImportRowError, CategoryImportRow } from '@b2b/contracts';
import type { ImportExportAdapter, ImportExportPorts } from '../adapter.js';

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
 *
 * Feature 075 / D-74 — the rows are `catalog`'s, so `catalog` applies them.
 * What is left here is the CSV vocabulary: which columns exist, how a cell
 * becomes a field, and which cell is malformed. "Unknown parent_slug" is not in
 * that list — it is an answer only the catalogue has.
 */
export function categoriesAdapter(ports: ImportExportPorts): ImportExportAdapter {
  return {
    name: 'categories',
    owners: ['catalog'],
    exportHeader: ['id', 'slug', 'parent_slug', 'sort_order', 'name_en', 'is_active'] as const,

    async exportRows(): Promise<string[][]> {
      const rows = await ports.catalogCategories.listAll();
      const slugById = new Map(rows.map((c) => [c.id, c.slug]));
      // By slug, as the export has always been. The port orders by sort order
      // then slug, because that is what its other eight callers want.
      return [...rows]
        .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
        .map((c) => [
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

    async importRows(records): Promise<BulkImportReport> {
      const errors: BulkImportRowError[] = [];
      const rows: CategoryImportRow[] = [];

      for (const [index, record] of records.entries()) {
        const slug = record['slug']?.trim();
        if (!slug) {
          errors.push({ index, reason: 'slug is required' });
          continue;
        }

        const nameEn = record['name_en']?.trim();
        if (!nameEn) {
          errors.push({ index, reason: 'name_en is required' });
          continue;
        }

        const sortOrderRaw = record['sort_order']?.trim();
        const sortOrder = sortOrderRaw ? Number.parseInt(sortOrderRaw, 10) : 0;
        if (Number.isNaN(sortOrder)) {
          errors.push({ index, reason: `invalid sort_order: ${sortOrderRaw}` });
          continue;
        }

        const isActiveRaw = record['is_active']?.trim().toLowerCase();
        let isActive: boolean | undefined;
        if (isActiveRaw !== undefined && isActiveRaw !== '') {
          if (isActiveRaw === 'true' || isActiveRaw === '1') isActive = true;
          else if (isActiveRaw === 'false' || isActiveRaw === '0') isActive = false;
          else {
            errors.push({ index, reason: `invalid is_active: ${record['is_active']}` });
            continue;
          }
        }

        rows.push({
          slug,
          // Both columns are required headers, so every row states them: an
          // empty `parent_slug` means root rather than "leave the parent alone".
          parentSlug: record['parent_slug']?.trim() || null,
          sortOrder,
          name: { 'en-US': nameEn },
          ...(isActive !== undefined ? { isActive } : {}),
        });
      }

      // A malformed cell stops the run before the owner is asked to do anything:
      // the promise is that either every row lands or none does, and half of the
      // validation living on each side must not weaken it.
      if (errors.length > 0) return { imported: 0, errors };
      return ports.catalogBulkImport.importCategories(rows);
    },
  };
}
