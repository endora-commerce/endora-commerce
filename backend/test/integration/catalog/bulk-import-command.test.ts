import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CommandBus } from '../../../src/commands/index.js';
import { CatalogBulkImportService } from '../../../src/modules/catalog/services/catalog-bulk-import.service.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Feature 075 / D-74 — the catalogue half of the bulk import, on this side of
 * the boundary.
 *
 * Four properties, and each of them is something the old `import_export` path
 * either had by accident or did not have at all:
 *
 *  - **within-run parent resolution** worked only because MikroORM's
 *    `FlushMode.AUTO` flushes before a query a pending insert would change.
 *    Nothing in the tree said so. It is an explicit index here, and the test
 *    that a child listed *above* its parent still fails is what proves the index
 *    is ordered rather than a set of every slug in the file;
 *  - **all-or-nothing** — a rejected row applies nothing, which is the only
 *    thing making a corrected re-upload safe (there is no run ledger and no
 *    idempotency key anywhere in the platform);
 *  - **one audit row per run**, and none when the run applied nothing. The old
 *    path wrote no audit row at all, and `check:command-coverage` could not see
 *    that, because `em.create` and a field assignment are not in its vocabulary;
 *  - **the default sales-channel binding** for created categories (Principle
 *    XII), which the CSV path has never performed — so every category ever
 *    imported was invisible in every channel.
 */
describe('CatalogBulkImportService — one Command per run [real DB]', () => {
  let h: BackendServerHandle;
  let service: CatalogBulkImportService;

  beforeAll(async () => {
    h = await setupBackendServer();
    const commandBus = new CommandBus(h.orm, h.auditLogService, h.eventBus);
    service = new CatalogBulkImportService(commandBus, h.salesChannels.membershipService);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const run = async <T>(what: string, fn: () => Promise<T>): Promise<T> =>
    withSystemScope(`feature 075 D-74 test — ${what}`, fn);

  const auditCount = async (action: string): Promise<number> =>
    h.em().count(AuditLogEntry, { action });

  it('resolves a parent introduced by an earlier row in the same run', async () => {
    const report = await run('within-run parent', () =>
      service.importCategories([
        { slug: 'bi-root', parentSlug: null, sortOrder: 1, name: { 'en-US': 'BI root' } },
        { slug: 'bi-child', parentSlug: 'bi-root', sortOrder: 2, name: { 'en-US': 'BI child' } },
      ]),
    );

    expect(report).toEqual({ imported: 2, errors: [] });
    const root = await h.em().findOneOrFail(Category, { slug: 'bi-root' });
    const child = await h.em().findOneOrFail(Category, { slug: 'bi-child' });
    expect(child.parentCategoryId).toBe(root.id);
    expect(child.sortOrder).toBe(2);
  });

  it('refuses a child listed above its parent, and applies neither row', async () => {
    const before = await auditCount('catalog.categories.import');

    const report = await run('child above parent', () =>
      service.importCategories([
        { slug: 'bi-early', parentSlug: 'bi-late', sortOrder: 0, name: { 'en-US': 'Early' } },
        { slug: 'bi-late', parentSlug: null, sortOrder: 0, name: { 'en-US': 'Late' } },
      ]),
    );

    expect(report.imported).toBe(0);
    expect(report.errors).toEqual([{ index: 0, reason: 'unknown parent_slug: bi-late' }]);
    // Neither row lands — not the rejected one and not the valid one below it.
    expect(await h.em().findOne(Category, { slug: 'bi-early' })).toBeNull();
    expect(await h.em().findOne(Category, { slug: 'bi-late' })).toBeNull();
    // And nothing was applied, so there is nothing to audit.
    expect(await auditCount('catalog.categories.import')).toBe(before);
  });

  it('writes exactly one audit row for a run, whatever the row count', async () => {
    const before = await auditCount('catalog.categories.import');

    await run('audit row count', () =>
      service.importCategories([
        { slug: 'bi-a', parentSlug: null, sortOrder: 0, name: { 'en-US': 'A' } },
        { slug: 'bi-b', parentSlug: null, sortOrder: 0, name: { 'en-US': 'B' } },
        { slug: 'bi-c', parentSlug: 'bi-a', sortOrder: 0, name: { 'en-US': 'C' } },
      ]),
    );

    expect(await auditCount('catalog.categories.import')).toBe(before + 1);
    const rows = await h
      .em()
      .find(AuditLogEntry, { action: 'catalog.categories.import' }, { orderBy: { actedAt: 'desc' } });
    expect((rows[0]?.stateAfter as { rows?: number } | null)?.rows).toBe(3);
  });

  it('binds a created category to the default sales channel (Principle XII)', async () => {
    await run('channel binding', () =>
      service.importCategories([
        { slug: 'bi-bound', parentSlug: null, sortOrder: 0, name: { 'en-US': 'Bound' } },
      ]),
    );

    const created = await h.em().findOneOrFail(Category, { slug: 'bi-bound' });
    const links = (await h
      .em()
      .getConnection()
      .execute('select sales_channel_id from sales_channel_categories where category_id = ?', [
        created.id,
      ])) as Array<{ sales_channel_id: string }>;
    expect(links).toHaveLength(1);
  });

  it('updates an existing category rather than creating a second one', async () => {
    await run('seed the update target', () =>
      service.importCategories([
        { slug: 'bi-update', parentSlug: null, sortOrder: 1, name: { 'en-US': 'First' } },
      ]),
    );
    await run('update it', () =>
      service.importCategories([
        {
          slug: 'bi-update',
          parentSlug: null,
          sortOrder: 7,
          name: { 'en-US': 'Second' },
          isActive: false,
        },
      ]),
    );

    const rows = await h.em().find(Category, { slug: 'bi-update' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sortOrder).toBe(7);
    expect(rows[0]?.name['en-US']).toBe('Second');
    expect(rows[0]?.isActive).toBe(false);
  });

  it('rolls back the whole product run when one SKU does not resolve', async () => {
    const target = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-BLUE-002' });
    const beforeName = target.name['en-US'];
    const beforeAudit = await auditCount('catalog.products.import');

    const report = await run('unknown sku', () =>
      service.importProducts([
        { sku: 'EXAMPLE-BLUE-002', name: { 'en-US': 'About to be reverted' } },
        { sku: 'BI-NO-SUCH-SKU', name: { 'en-US': 'Will fail' } },
      ]),
    );

    expect(report.imported).toBe(0);
    expect(report.errors).toEqual([{ index: 1, reason: 'unknown sku: BI-NO-SUCH-SKU' }]);
    const reloaded = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-BLUE-002' });
    expect(reloaded.name['en-US']).toBe(beforeName);
    expect(await auditCount('catalog.products.import')).toBe(beforeAudit);
  });

  it('applies a valid product run and audits it once', async () => {
    const beforeAudit = await auditCount('catalog.products.import');

    const report = await run('valid product run', () =>
      service.importProducts([
        {
          sku: 'EXAMPLE-SIMPLE-001',
          status: 'active',
          visibility: 'public',
          name: { 'en-US': 'Bulk renamed' },
          description: { 'en-US': 'Bulk described.' },
        },
      ]),
    );

    expect(report).toEqual({ imported: 1, errors: [] });
    const reloaded = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    expect(reloaded.name['en-US']).toBe('Bulk renamed');
    expect(reloaded.description['en-US']).toBe('Bulk described.');
    expect(await auditCount('catalog.products.import')).toBe(beforeAudit + 1);
  });

  it('audits nothing for an empty run', async () => {
    const beforeCategories = await auditCount('catalog.categories.import');
    const beforeProducts = await auditCount('catalog.products.import');

    expect(await run('empty categories', () => service.importCategories([]))).toEqual({
      imported: 0,
      errors: [],
    });
    expect(await run('empty products', () => service.importProducts([]))).toEqual({
      imported: 0,
      errors: [],
    });

    expect(await auditCount('catalog.categories.import')).toBe(beforeCategories);
    expect(await auditCount('catalog.products.import')).toBe(beforeProducts);
  });
});
