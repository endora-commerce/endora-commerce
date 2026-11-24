import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ReturnsSeeder } from '../../../../packages/modules/returns/src/backend/services/returns-seeder.js';
import { ReturnReason, ReturnStatus, ReturnStatusTransition } from '../../helpers/package-entities.js';
import { DEFAULT_RETURN_STATUSES } from '../../../../packages/modules/returns/src/backend/domain/return-status-graph.js';

/**
 * Feature 046 (T017) — idempotent default seeder.
 */
describe('returns — seeder', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('restores the default status graph + reasons when wiped, and is idempotent', async () => {
    // In a transaction rolled back at the end, so the rows removed here are
    // never missing for another file: the defaults the seeder owns, and the
    // reasons this transaction reads — the seeder adds reasons only to an empty
    // table.
    const em = h.em().fork();
    await em.begin();
    try {
      const statusCodes = DEFAULT_RETURN_STATUSES.map((s) => s.code);
      const marks = (values: readonly unknown[]) => values.map(() => '?').join(', ');
      await em.execute(
        `delete from "return_status_transitions"
          where "from_status_code" in (${marks(statusCodes)}) or "to_status_code" in (${marks(statusCodes)})`,
        [...statusCodes, ...statusCodes],
      );
      await em.execute(`delete from "return_statuses" where "code" in (${marks(statusCodes)})`, statusCodes);
      const reasonIds = (await em.execute<Array<{ id: string }>>('select "id" from "return_reasons"')).map((r) => r.id);
      if (reasonIds.length > 0) {
        await em.execute(`delete from "return_reasons" where "id" in (${marks(reasonIds)})`, reasonIds);
      }

      const seeder = new ReturnsSeeder(() => em);
      const counts = async () => ({
        statuses: await em.count(ReturnStatus, { code: { $in: statusCodes } }),
        transitions: await em.count(ReturnStatusTransition, {
          fromStatusCode: { $in: statusCodes },
          toStatusCode: { $in: statusCodes },
        }),
        reasons: await em.count(ReturnReason, {}),
      });
      await seeder.ensureDefaults();
      expect(await counts()).toEqual({ statuses: 7, transitions: 9, reasons: 6 });

      // Second run is a no-op (counts unchanged — no duplicates).
      await seeder.ensureDefaults();
      expect(await counts()).toEqual({ statuses: 7, transitions: 9, reasons: 6 });
    } finally {
      await em.rollback();
    }
  });
});
