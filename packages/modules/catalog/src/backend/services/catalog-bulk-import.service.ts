import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  scopedStatusColumn,
  toScopeChannel,
  type BulkImportReport,
  type BulkImportRowError,
  type CatalogAttributeReadPort,
  type CatalogBulkImportPort,
  type CategoryImportRow,
  type ProductImportRow,
  type ProductStatus,
  type ScopedStatusExport,
  sameLanguage,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Category } from '../entities/category.entity.js';
import { Product } from '../entities/product.entity.js';
import { ProductChannelScope } from '../entities/product-channel-scope.entity.js';
import { ProductChannelLanguageScope } from '../entities/product-channel-language-scope.entity.js';
import { loadScopeRows, writeScopedStatus } from './product-scopes.service.js';

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
    /**
     * Feature 163 (FR-092) — the scoped-status columns: the export reads the scope
     * rows, and an import that changed a product's scoped status announces it
     * (`product.updated.v1` `['scopedStatus']`, after commit). Optional for the
     * compositions that import no scoped status.
     */
    private readonly scoped?: {
      emFactory: () => EntityManager;
      eventBus?: Pick<EventBus, 'emit'>;
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

  /** Feature 163 (FR-092) — every channel's scope columns, and each product's overrides in them. */
  async exportScopedStatuses(): Promise<ScopedStatusExport> {
    if (!this.scoped) throw new Error('CatalogBulkImportService: the scoped-status export is not wired.');
    const em = this.scoped.emFactory();
    const channels = await em.find(SalesChannel, {}, { orderBy: { code: 'asc' } });
    const columns: ScopedStatusExport['columns'] = [];
    const codeById = new Map<string, string>();
    for (const channel of channels) {
      codeById.set(channel.id, channel.code);
      columns.push({ channelCode: channel.code, languageCode: null });
      for (const languageCode of toScopeChannel(channel).languages) {
        columns.push({ channelCode: channel.code, languageCode });
      }
    }
    const values: ScopedStatusExport['values'] = {};
    const put = (productId: string, column: string, status: ProductStatus): void => {
      (values[productId] ??= {})[column] = status;
    };
    for (const row of await em.find(ProductChannelScope, { status: { $ne: null } })) {
      const code = codeById.get(row.salesChannelId);
      if (code && row.status) put(row.productId, scopedStatusColumn(code, null), row.status);
    }
    for (const row of await em.find(ProductChannelLanguageScope, {})) {
      const code = codeById.get(row.salesChannelId);
      if (code) put(row.productId, scopedStatusColumn(code, row.languageCode), row.status);
    }
    return { columns, values };
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

  async importProducts(rows: readonly ProductImportRow[]): Promise<BulkImportReport> {
    if (rows.length === 0) return { imported: 0, errors: [] };

    const outcome = await this.commandBus.run<{ report: BulkImportReport; scopedChanged: string[] }>({
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
        // Feature 163 (FR-092) — the scoped-status cells, validated with the rest:
        // the whole-file rule is unchanged, one rejected row applies nothing.
        const scoped = errors.length > 0 ? null : await this.#planScopedStatus(em, rows, bySku, errors);
        if (errors.length > 0 || scoped === null) {
          return { result: { report: { imported: 0, errors }, scopedChanged: [] }, skipAudit: true };
        }

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
        const scopedChanged = await scoped.apply();
        await em.flush();

        return {
          result: { report: { imported: rows.length, errors: [] }, scopedChanged },
          after: { rows: rows.length, ...(scopedChanged.length > 0 ? { scopedStatusProducts: scopedChanged.length } : {}) },
        };
      },
    });

    // After commit: a scoped status reaches search, the sitemap and webhooks
    // through the same event an operator's scope write emits (R10).
    for (const productId of outcome.scopedChanged) {
      const payload = {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        productId,
        changedFields: ['scopedStatus'],
      };
      this.scoped?.eventBus?.emit('product.updated.v1', payload);
    }
    return outcome.report;
  }

  /**
   * Validates every scoped-status cell into `errors` (FR-014: a value for a
   * channel the product is not in, or a language the channel does not offer, is
   * refused; an empty cell — use inherited — is always accepted, FR-015) and
   * answers the write to run once the whole file is valid, or `null` when a row
   * was refused. The write answers the ids of the products whose scoped status
   * changed.
   */
  async #planScopedStatus(
    em: EntityManager,
    rows: readonly ProductImportRow[],
    bySku: ReadonlyMap<string, Product>,
    errors: BulkImportRowError[],
  ): Promise<{ apply: () => Promise<string[]> } | null> {
    const cells = rows.flatMap((row, index) => (row.scopedStatus ?? []).map((cell) => ({ index, row, cell })));
    if (cells.length === 0) return { apply: async () => [] };
    if (!this.salesChannelMembership) {
      throw new Error('CatalogBulkImportService: scoped status needs the channel-membership accessor.');
    }
    const codes = [...new Set(cells.map(({ cell }) => cell.channelCode))];
    const channels = await em.find(SalesChannel, { code: { $in: codes } });
    const byCode = new Map(channels.map((channel) => [channel.code, toScopeChannel(channel)]));
    const productIds = [...new Set(cells.map(({ row }) => bySku.get(row.sku)!.id))];
    const members = new Map<string, Set<string>>();
    for (const channel of byCode.values()) {
      members.set(channel.id, new Set(await this.salesChannelMembership.filterEntityIdsInChannel(channel.id, 'product', productIds)));
    }

    const writes: Array<{ productId: string; channelId: string; languageCode: string | null; status: ProductStatus | null }> = [];
    for (const { index, row, cell } of cells) {
      const product = bySku.get(row.sku)!;
      const channel = byCode.get(cell.channelCode);
      const column = scopedStatusColumn(cell.channelCode, cell.languageCode);
      if (!channel) {
        errors.push({ index, reason: `${column}: unknown sales channel ${cell.channelCode}` });
        continue;
      }
      const languageCode =
        cell.languageCode === null
          ? null
          : (channel.languages.find((code) => sameLanguage(code, cell.languageCode)) ?? cell.languageCode);
      if (cell.status !== null) {
        if (!members.get(channel.id)?.has(product.id)) {
          errors.push({ index, reason: `${column}: the product is not in sales channel ${cell.channelCode}` });
          continue;
        }
        if (languageCode !== null && !channel.languages.includes(languageCode)) {
          errors.push({ index, reason: `${column}: sales channel ${cell.channelCode} does not offer ${cell.languageCode}` });
          continue;
        }
      }
      writes.push({ productId: product.id, channelId: channel.id, languageCode, status: cell.status });
    }
    if (errors.length > 0) return null;

    return {
      // C-W3 — the scopes write's own row writers, inside this import's single
      // transaction and its single audit row.
      apply: async () => {
        const changed = new Set<string>();
        const rows = await loadScopeRows(em, productIds);
        for (const write of writes) {
          const scope = { channelId: write.channelId, languageCode: write.languageCode };
          if (writeScopedStatus(em, rows, write.productId, scope, write.status)) changed.add(write.productId);
        }
        return [...changed];
      },
    };
  }
}

