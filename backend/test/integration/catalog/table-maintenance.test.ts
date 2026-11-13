import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CatalogBulkImportPort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  vacuumAnalyzeTable,
  type TableMaintenanceProducer,
} from '../../../../packages/modules/catalog/src/backend/services/table-maintenance-queue.js';

/**
 * Issue #409 — a products import asks for `VACUUM (ANALYZE)` of `products` and
 * `product_variants` in the background once it wrote, so the admin's ordered
 * walks and search counts have a visibility map before autovacuum's first
 * pass (spec 161 R14). `import_export` reaches it through
 * `catalogBulkImportPort`, the import being this module's write.
 *
 * The queue's one-job-per-table window is pinned against a real BullMQ in
 * `test/integration/price_lists/table-maintenance.test.ts`; the producer here
 * is the same shape, unit-tested beside it.
 */
describe('catalog table maintenance — a products import asks for it', () => {
  let h: BackendServerHandle;
  let port: CatalogBulkImportPort;
  let requests = 0;
  const recorder: TableMaintenanceProducer = {
    request: async () => {
      requests += 1;
      return true;
    },
    close: async () => undefined,
  };
  const run = <T>(fn: () => Promise<T>): Promise<T> => withSystemScope('issue #409 test — products import', fn);
  const rename = (sku: string, value: string) => ({
    sku,
    cells: [{ scope: { level: 'global' as const }, field: 'name' as const, op: { op: 'set' as const, value } }],
  });

  beforeAll(async () => {
    h = await setupBackendServer({ moduleOverrides: { catalogTableMaintenance: recorder } });
    port = (h.container.cradle as unknown as { catalogBulkImportPort: CatalogBulkImportPort }).catalogBulkImportPort;
  }, 5 * 60_000);

  beforeEach(() => {
    requests = 0;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('once, after an import that wrote', async () => {
    const report = await run(() => port.importProducts([rename('EXAMPLE-SIMPLE-001', 'Renamed by #409'), rename('EXAMPLE-BLUE-002', 'Renamed too')]));
    expect(report.imported).toBe(2);
    expect(requests).toBe(1);
  });

  it('not for a dry run, nor for an import that wrote nothing', async () => {
    const dry = await run(() => port.importProducts([rename('EXAMPLE-SIMPLE-001', 'Dry run')], { dryRun: true }));
    expect(dry.imported).toBe(1);
    const unknown = await run(() => port.importProducts([rename('ISSUE-409-NO-SUCH-SKU', 'Nothing')]));
    expect(unknown.imported).toBe(0);
    expect(requests).toBe(0);
  });

  it('the job vacuums and analyses both tables', async () => {
    const conn = h.em().getConnection();
    for (const table of ['products', 'product_variants']) {
      const [{ before }] = (await conn.execute(`select clock_timestamp() as "before"`)) as [{ before: string | Date }];
      await vacuumAnalyzeTable(conn, table);
      await conn.execute(`select pg_stat_clear_snapshot()`);
      const [stats] = await conn.execute<Array<{ reltuples: number; last_vacuum: string | Date | null; last_analyze: string | Date | null }>>(
        `select c."reltuples"::float8 as "reltuples", s."last_vacuum", s."last_analyze"
           from "pg_class" c join "pg_stat_user_tables" s on s."relid" = c."oid" where c."oid" = ?::regclass`,
        [table],
      );
      // `reltuples` is -1 for a table never vacuumed nor analysed; an empty one analysed is 0.
      expect(Number(stats!.reltuples), table).toBeGreaterThanOrEqual(0);
      expect(stats!.last_vacuum ? new Date(stats!.last_vacuum).getTime() : 0, table).toBeGreaterThanOrEqual(new Date(before).getTime());
      expect(stats!.last_analyze ? new Date(stats!.last_analyze).getTime() : 0, table).toBeGreaterThanOrEqual(new Date(before).getTime());
    }
  });
});
