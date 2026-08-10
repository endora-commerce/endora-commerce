import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { EventBus } from '../../../src/events/bus.js';
import { SalesChannelsService } from '../../../src/modules/sales_channels/services/sales-channels.service.js';
import { DefaultChannelReconciler } from '../../../src/kernel/sales-channels/default-channel-reconciler.js';
import { HttpError } from '../../../src/http/error-envelope.js';

/**
 * T023 — FR-002: the system-default Sales Channel cannot be deactivated
 * or deleted. The HTTP-flavored test (with full route coverage) lands
 * in T031 once US2's admin routes exist; this is the service-layer
 * smoke test that proves the guards inside `SalesChannelsService` are
 * in place.
 */
describe('Default channel is undeletable / undeactivatable (T023)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  async function ensureDefault(): Promise<string> {
    const em = db.em();
    await new DefaultChannelReconciler(() => em).run();
    const found = await em.findOneOrFail(
      (await import('../../../src/kernel/sales-channels/sales-channel.entity.js'))
        .SalesChannel,
      { systemDefault: true },
    );
    return found.code;
  }

  it('refuses deactivate(systemDefaultCode) with CANNOT_MODIFY_SYSTEM_DEFAULT', async () => {
    try {
      const code = await ensureDefault();
      const svc = new SalesChannelsService(() => db.em(), new EventBus());

      let caught: unknown;
      try {
        await svc.deactivate(code);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HttpError);
      const httpErr = caught as HttpError;
      expect(httpErr.statusCode).toBe(422);
      expect(httpErr.code).toBe(ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT);
    } finally {
      await db.rollbackTx();
    }
  });

  it('refuses delete(systemDefaultCode) with CANNOT_MODIFY_SYSTEM_DEFAULT', async () => {
    try {
      const code = await ensureDefault();
      const svc = new SalesChannelsService(() => db.em(), new EventBus());

      let caught: unknown;
      try {
        await svc.delete(code);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HttpError);
      const httpErr = caught as HttpError;
      expect(httpErr.statusCode).toBe(422);
      expect(httpErr.code).toBe(ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT);
    } finally {
      await db.rollbackTx();
    }
  });

  it('refuses delete on a non-existent code with NOT_FOUND', async () => {
    try {
      await ensureDefault();
      const svc = new SalesChannelsService(() => db.em(), new EventBus());

      let caught: unknown;
      try {
        await svc.delete('does-not-exist');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HttpError);
      expect((caught as HttpError).statusCode).toBe(404);
    } finally {
      await db.rollbackTx();
    }
  });
});
