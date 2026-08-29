import { randomUUID } from 'node:crypto';
import type {
  BulkImportReport,
  BulkImportRowError,
  CatalogBulkImportPort,
  CategoryImportRow,
  ProductImportRow,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { Category } from '../entities/category.entity.js';
import { Product } from '../entities/product.entity.js';

/**
 * Bulk import of catalogue rows (feature 075, D-74).
 *
 * `import_export` used to do this itself: it held `Category` and `Product`,
 * assigned to their fields inside its own `em.transactional`, and committed on
 * MikroORM's implicit flush. Three things were wrong with that, and this class
 * is the answer to all three at once.
 *
 * **One Command per run, so the write is audited by construction.**
 * `check:command-coverage` read the old path clean because `em.create` and a
 * field assignment are not in its vocabulary, so a spreadsheet that rewrote the
 * status and visibility of every product in the catalogue left the same trace
 * as a GET. There is no other way to write here: the transaction belongs to the
 * bus.
 *
 * **Validate, then apply, over one in-memory index.** The old path resolved a
 * parent created by an earlier row with `em.findOne(Category, { slug })` and no
 * intervening flush — it worked only because MikroORM's default `FlushMode.AUTO`
 * flushes before a query a pending insert would change. Nothing in the tree said
 * so. Here the index is explicit: a slug enters it when a row introduces it, and
 * a child listed above its parent fails with the same message it always did.
 *
 * **All-or-nothing stays, and it moves inside the transaction rather than being
 * produced by throwing out of one.** A run with any rejected row applies nothing
 * and writes no audit entry (`skipAudit`) — there is nothing to record. The
 * transaction is still the backstop for what validation did not anticipate: a
 * unique violation throws, the bus rolls back, and the audit row goes with it.
 */

/** What the categories command hands back to the port: the report plus what it created. */
interface CategoryImportOutcome {
  report: BulkImportReport;
  /** Ids of the rows this run created — the ones that need a channel binding. */
  createdIds: string[];
}

export class CatalogBulkImportService implements CatalogBulkImportPort {
  constructor(
    private readonly commandBus: CommandBus,
    /**
     * Feature 005 / FR-011 — a created category is bound to the system-default
     * sales channel, exactly as `CategoryAdminService.create` binds one.
     *
     * The CSV path never did, so every category ever imported was invisible in
     * every channel (Principle XII). D-74 calls this out as its one deliberate
     * behaviour change: the defect is only fixed here because this is where the
     * write becomes `catalog`'s.
     */
    private readonly salesChannelMembership?: SalesChannelMembershipPort,
  ) {}

  async importCategories(rows: readonly CategoryImportRow[]): Promise<BulkImportReport> {
    if (rows.length === 0) return { imported: 0, errors: [] };

    const outcome = await this.commandBus.run<CategoryImportOutcome>({
      action: 'catalog.categories.import',
      objectType: 'category',
      // The run, not a row: a bulk command's `objectId` is the operation id.
      objectId: randomUUID(),
      run: async ({ em }) => {
        const existing = await em.find(Category, {});
        const bySlug = new Map(existing.map((category) => [category.slug, category]));

        // Pass one — validate every row against the index, adding each row's own
        // slug as it goes, so a parent introduced earlier in the same file
        // resolves and one introduced later does not.
        const errors: BulkImportRowError[] = [];
        const known = new Set(bySlug.keys());
        for (const [index, row] of rows.entries()) {
          if (row.parentSlug != null && row.parentSlug !== '' && !known.has(row.parentSlug)) {
            errors.push({ index, reason: `unknown parent_slug: ${row.parentSlug}` });
          }
          known.add(row.slug);
        }
        if (errors.length > 0) {
          return { result: { report: { imported: 0, errors }, createdIds: [] }, skipAudit: true };
        }

        // Pass two — apply. Ids are allocated here rather than by the entity
        // default so a child row can name its parent before anything is flushed.
        const createdIds: string[] = [];
        for (const row of rows) {
          const parentId =
            row.parentSlug == null || row.parentSlug === ''
              ? null
              : (bySlug.get(row.parentSlug)?.id ?? null);

          const target = bySlug.get(row.slug);
          if (target) {
            if (row.parentSlug !== undefined) target.parentCategoryId = parentId;
            if (row.sortOrder !== undefined) target.sortOrder = row.sortOrder;
            if (row.name !== undefined) target.name = { ...target.name, ...row.name };
            if (row.isActive !== undefined) target.isActive = row.isActive;
            continue;
          }

          const id = randomUUID();
          const created = em.create(Category, {
            id,
            ...(parentId !== null ? { parentCategoryId: parentId } : {}),
            slug: row.slug,
            sortOrder: row.sortOrder ?? 0,
            name: row.name ?? {},
            ...(row.isActive !== undefined ? { isActive: row.isActive } : {}),
          });
          bySlug.set(row.slug, created);
          createdIds.push(id);
        }
        await em.flush();

        return {
          result: { report: { imported: rows.length, errors: [] }, createdIds },
          after: { rows: rows.length, created: createdIds.length, updated: rows.length - createdIds.length },
        };
      },
    });

    // After commit, like the interactive create — a membership row for a
    // category the transaction rolled back would point at nothing.
    if (this.salesChannelMembership) {
      for (const id of outcome.createdIds) {
        await this.salesChannelMembership.bindToDefaultIfEmpty('category', id);
      }
    }
    return outcome.report;
  }

  async importProducts(rows: readonly ProductImportRow[]): Promise<BulkImportReport> {
    if (rows.length === 0) return { imported: 0, errors: [] };

    return this.commandBus.run<BulkImportReport>({
      action: 'catalog.products.import',
      objectType: 'product',
      objectId: randomUUID(),
      run: async ({ em }) => {
        const products = await em.find(Product, { sku: { $in: rows.map((row) => row.sku) } });
        const bySku = new Map(products.map((product) => [product.sku, product]));

        // The import creates no product: a flat sheet carries no attribute set,
        // no type and no slug, so an unknown SKU is a rejected row rather than
        // an implied create.
        const errors: BulkImportRowError[] = [];
        for (const [index, row] of rows.entries()) {
          if (!bySku.has(row.sku)) errors.push({ index, reason: `unknown sku: ${row.sku}` });
        }
        if (errors.length > 0) return { result: { imported: 0, errors }, skipAudit: true };

        for (const row of rows) {
          const product = bySku.get(row.sku);
          if (!product) continue;
          if (row.status !== undefined) product.status = row.status;
          if (row.visibility !== undefined) product.visibility = row.visibility;
          if (row.name !== undefined) product.name = { ...product.name, ...row.name };
          if (row.description !== undefined) {
            product.description = { ...product.description, ...row.description };
          }
        }
        await em.flush();

        return {
          result: { imported: rows.length, errors: [] },
          after: { rows: rows.length },
        };
      },
    });
  }
}
