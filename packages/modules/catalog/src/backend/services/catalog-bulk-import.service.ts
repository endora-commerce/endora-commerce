import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  isSystemAttributeKey,
  scopedColumn,
  toScopeChannel,
  type BulkImportReport,
  type BulkImportRowError,
  type CatalogAttributeReadPort,
  type CatalogBulkImportPort,
  type CategoryImportRow,
  type FieldPath,
  type ProductImportCell,
  type ProductImportRow,
  type ScopedExportValue,
  type ScopedValuesExport,
  sameLanguage,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { EventBus } from '@endora-commerce/platform/events';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Category } from '../entities/category.entity.js';
import { Product } from '../entities/product.entity.js';
import { ProductChannelScope } from '../entities/product-channel-scope.entity.js';
import { ProductChannelLanguageScope } from '../entities/product-channel-language-scope.entity.js';
import { ProductUrlKey } from '../entities/product-url-key.entity.js';
import { ProductValueOverride } from '../entities/product-value-override.entity.js';
import { firstDuplicateCell, planScopedImport, runScopedImport, type ScopedImportDeps } from './scoped-values-import.js';

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
 * **All-or-nothing stays for categories, and it moves inside the transaction
 * rather than being produced by throwing out of one.** A categories run with any
 * rejected row applies nothing and writes no audit entry (`skipAudit`). The
 * transaction is still the backstop for what validation did not anticipate: a
 * unique violation throws, the bus rolls back, and the audit row goes with it.
 *
 * **Products are per product** (feature 174, `contracts/import-profiles-and-csv.md`
 * §2): each row is its own `product.scoped_values.import` Command, refused cells
 * are reported per cell, and one failing row leaves the others applied.
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
    /**
     * Feature 163 (FR-092) — the scoped-status columns: the export reads the scope
     * rows, and an import that changed a product's scoped status announces it
     * (`product.updated.v1` `['scopedStatus']`, after commit). Optional for the
     * compositions that import no scoped status.
     */
    private readonly scoped?: {
      emFactory: () => EntityManager;
      eventBus?: Pick<EventBus, 'emit'>;
      /** Feature 174 (T084) — the scoped import's planner deps (`scoped-values-import.ts`). */
      importDeps?: ScopedImportDeps;
    },
    /**
     * Feature 172 (FR-041) — the attribute read that says which keys are Page
     * Builder content attributes. Optional for the compositions that import no
     * products file.
     */
    private readonly attributes?: Pick<CatalogAttributeReadPort, 'listAll'>,
  ) {}

  /**
   * Feature 172 (FR-041) — the keys of the Page Builder content attributes,
   * sorted. Content is authored on the product content screen only, so the
   * products importer refuses a cell under one of these keys. Unwired, it
   * throws rather than answer "none", which would let such a cell through.
   */
  async contentAttributeKeys(): Promise<string[]> {
    if (!this.attributes) {
      throw new Error('CatalogBulkImportService: the attribute read is not wired.');
    }
    const views = await this.attributes.listAll();
    return views
      .filter((view) => view.valueType === 'page_builder')
      .map((view) => view.key)
      .sort();
  }

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

  /**
   * Feature 174 (T084; `contracts/import-profiles-and-csv.md` §2) — per product: each row applies
   * in its own Command `product.scoped_values.import` (the connector port's planner and writers,
   * `scoped-values-import.ts`), so a failing row leaves the others applied. An unknown SKU, a
   * (field, scope) named twice in a row, or a refusal of the whole product (`404`) is a row error;
   * each refused cell a field error under its column, the row's other cells applying. The
   * legacy `status` column writes the Global status, `visibility` the Global audience's visibility.
   * `imported` counts the rows not every cell of which was refused. A row error's `reason` is
   * `<CODE>: <message>` for a refusal of the whole product, which the admin labels by its code.
   * `dryRun` plans every row the same way and writes nothing.
   */
  async importProducts(rows: readonly ProductImportRow[], options: { dryRun?: boolean } = {}): Promise<BulkImportReport> {
    if (rows.length === 0) return { imported: 0, errors: [] };
    const scoped = this.#requireScoped();
    const em = scoped.emFactory();
    const products = await em.find(Product, { sku: { $in: [...new Set(rows.map((row) => row.sku))] } }, { fields: ['id', 'sku'] });
    const idBySku = new Map(products.map((product) => [product.sku, product.id]));

    const errors: BulkImportRowError[] = [];
    const fieldErrors: NonNullable<BulkImportReport['fieldErrors']> = [];
    let imported = 0;
    for (const [index, row] of rows.entries()) {
      const productId = idBySku.get(row.sku);
      // The import creates no product: a flat sheet carries no attribute set, no type and no slug.
      if (productId === undefined) {
        errors.push({ index, reason: `unknown sku: ${row.sku}` });
        continue;
      }
      const cells: ProductImportCell[] = [...(row.cells ?? [])];
      if (row.status !== undefined) cells.push({ scope: { level: 'global' }, field: 'status', op: { op: 'set', value: row.status }, column: 'status' });
      const duplicate = firstDuplicateCell(cells);
      if (duplicate !== null) {
        errors.push({ index, reason: `${columnOf(cells[duplicate]!)}: the same field and scope twice in one row` });
        continue;
      }
      const extras = row.visibility !== undefined ? { visibility: row.visibility } : undefined;
      try {
        const result = options.dryRun
          ? await planScopedImport(scoped.emFactory(), scoped.importDeps, productId, cells, extras)
          : await runScopedImport(this.commandBus, scoped.importDeps, productId, cells, {
              source: 'import_export',
              path: 'import',
              ...(extras ? { extras } : {}),
            });
        for (const refusal of result.refused) {
          fieldErrors.push({ index, column: columnOf(cells[refusal.index]!), code: refusal.code });
        }
        const urlKeyCells = cells.filter((cell) => cell.field === 'urlKey' && !result.refused.some((r) => cells[r.index] === cell));
        let takenUrlKeys = 0;
        result.urlKeys.forEach((outcome, position) => {
          if (outcome.written) return;
          takenUrlKeys += 1;
          fieldErrors.push({ index, column: columnOf(urlKeyCells[position]!), code: ERROR_CODES.URL_KEY_TAKEN });
        });
        // A row counts as imported unless every one of its cells was refused (a field error each):
        // a cell that writes what the scope already holds is not a refusal, so an unchanged
        // re-import still counts its rows (`contracts/import-profiles-and-csv.md` §2.3).
        if (cells.length - result.refused.length - takenUrlKeys > 0 || extras !== undefined) imported += 1;
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        errors.push({ index, reason: `${error.code}: ${error.message}` });
      }
    }
    return { imported, errors, ...(fieldErrors.length > 0 ? { fieldErrors } : {}) };
  }

  /**
   * Feature 174 (T084; `contracts/import-profiles-and-csv.md` §3; FR-043, FR-114) — the scoped
   * columns of a products export: `name`, `description`, `status`, `urlKey` and every
   * `attribute:<key>` at C and C×L, one column per (field, scope) at which any product holds an own
   * value there, and each product's own values. Orphans (a channel the product left, a language
   * the channel dropped, a level the attribute's scope set no longer has) are not exported: a
   * re-import of the file must write nothing.
   *
   * Not paged (C2/C3 code review note): the products export is one in-memory file. Its adapter
   * reads every product (`catalogProducts.listAll()`) and needs the whole column set for the
   * header before it writes the first row, so paging this read alone would bound nothing. The
   * export's memory is bounded when the file itself streams, which is a follow-up of its own.
   */
  async exportScopedValues(): Promise<ScopedValuesExport> {
    const scoped = this.#requireScoped();
    if (!this.salesChannelMembership) throw new Error('CatalogBulkImportService: the export needs the channel-membership accessor.');
    const em = scoped.emFactory();
    const [channels, overrides, channelRows, languageRows, keys, attributes] = await Promise.all([
      em.find(SalesChannel, {}, { orderBy: { code: 'asc' } }),
      em.find(ProductValueOverride, {}),
      em.find(ProductChannelScope, {}),
      em.find(ProductChannelLanguageScope, {}),
      em.find(ProductUrlKey, {}),
      scoped.importDeps.listAttributes(),
    ]);
    const levelsOf = new Map<string, readonly string[]>([
      ['name', ['G', 'C', 'CL']],
      ['description', ['G', 'C', 'CL']],
      ['status', ['G', 'C', 'CL']],
      ['urlKey', ['G', 'C', 'CL']],
      ['minOrderQuantity', ['G', 'C']],
      ['returnable', ['G', 'C']],
      ...attributes.map((attribute) => [`attribute:${attribute.key}`, attribute.scopeLevels] as const),
    ]);
    const cells: Array<{ productId: string; field: string; channelId: string; languageCode: string | null; value: ScopedExportValue }> = [];
    const own = (v: unknown): ScopedExportValue =>
      v === null || v === undefined
        ? { kind: 'empty' }
        : typeof v === 'string'
          ? { kind: 'text', text: v }
          : { kind: 'value', value: v as number | boolean | string[] };
    for (const row of overrides) {
      const field = isSystemAttributeKey(row.attributeKey) ? row.attributeKey : `attribute:${row.attributeKey}`;
      cells.push({ productId: row.productId, field, channelId: row.channelId, languageCode: row.languageCode ?? null, value: own(row.value?.v) });
    }
    const at = (row: { productId: string; salesChannelId: string }, field: string, value: ScopedExportValue, languageCode: string | null = null) =>
      cells.push({ productId: row.productId, field, channelId: row.salesChannelId, languageCode, value });
    for (const row of channelRows) {
      if (row.status != null) at(row, 'status', { kind: 'text', text: row.status });
      if (row.minOrderQuantityOverridden) at(row, 'minOrderQuantity', own(row.minOrderQuantity ?? null));
      if (row.returnable != null) at(row, 'returnable', { kind: 'value', value: row.returnable });
    }
    for (const row of languageRows) at(row, 'status', { kind: 'text', text: row.status }, row.languageCode);
    for (const row of keys) at(row, 'urlKey', { kind: 'text', text: row.key }, row.languageCode);

    const productIds = [...new Set(cells.map((cell) => cell.productId))];
    const members = new Map<string, Set<string>>();
    for (const channel of channels) {
      members.set(channel.id, new Set(productIds.length === 0 ? [] : await this.salesChannelMembership.filterEntityIdsInChannel(channel.id, 'product', productIds)));
    }
    const channelById = new Map(channels.map((channel) => [channel.id, { code: channel.code, languages: toScopeChannel(channel).languages }]));
    const values: ScopedValuesExport['values'] = {};
    const used = new Map<string, ScopedValuesExport['columns'][number]>();
    for (const cell of cells) {
      const channel = channelById.get(cell.channelId);
      if (!channel || !members.get(cell.channelId)?.has(cell.productId)) continue;
      const levels = levelsOf.get(cell.field);
      if (!levels || !levels.includes(cell.languageCode === null ? 'C' : 'CL')) continue;
      const languageCode = cell.languageCode === null ? null : channel.languages.find((code) => sameLanguage(code, cell.languageCode));
      if (languageCode === undefined) continue;
      const column = scopedColumn(cell.field, channel.code, languageCode);
      used.set(column, { field: cell.field as FieldPath, channelId: cell.channelId, channelCode: channel.code, languageCode });
      (values[cell.productId] ??= {})[column] = cell.value;
    }
    const RANK = ['name', 'description', 'status', 'urlKey', 'minOrderQuantity', 'returnable'];
    const fieldRank = (field: string) => (RANK.includes(field) ? RANK.indexOf(field) : RANK.length);
    const columns = [...used.values()].sort((a, b) => {
      const languages = channelById.get(a.channelId)?.languages ?? [];
      return (
        fieldRank(a.field) - fieldRank(b.field) ||
        a.field.localeCompare(b.field) ||
        a.channelCode.localeCompare(b.channelCode) ||
        (a.languageCode === null ? -1 : b.languageCode === null ? 1 : languages.indexOf(a.languageCode) - languages.indexOf(b.languageCode))
      );
    });
    return { columns, values };
  }

  #requireScoped(): { emFactory: () => EntityManager; importDeps: ScopedImportDeps } {
    if (!this.scoped?.importDeps) throw new Error('CatalogBulkImportService: the scoped import is not wired.');
    return { emFactory: this.scoped.emFactory, importDeps: this.scoped.importDeps };
  }
}

/** A cell's file column: the caller's, else `<field>@<scope>`. */
function columnOf(cell: ProductImportCell): string {
  if (cell.column) return cell.column;
  if (cell.scope.level === 'global') return cell.field;
  return cell.scope.level === 'channel' ? `${cell.field}@${cell.scope.channelId}` : `${cell.field}@${cell.scope.channelId}/${cell.scope.languageCode}`;
}
