import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { EventBus } from '@endora-commerce/platform/events';
import { SalesChannelAttributionRegistry } from '../../../../packages/modules/sales_channels/src/backend/services/sales-channel-attribution-registry.js';
import { SalesChannelsService } from '../../../../packages/modules/sales_channels/src/backend/services/sales-channels.service.js';
import { dictionaryValidatorFor } from '../../helpers/dictionary-services.js';
import { DefaultChannelReconciler } from '@endora-commerce/platform/composition';
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

  /**
   * Both arguments are required since feature 075 (D-87): the validator's
   * absent branch used to be a raw `select` over `languages` and `currencies`,
   * and the registry's absent form would be an open delete guard. Neither is
   * exercised here — this suite never creates a channel, and its deletes are
   * refused before the guard — but the service does not have an absent form of
   * either any more, which is the point.
   */
  function serviceFor(): SalesChannelsService {
    return new SalesChannelsService(
      () => db.em(),
      new EventBus(),
      dictionaryValidatorFor(() => db.em()),
      new SalesChannelAttributionRegistry(),
    );
  }

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
      const svc = serviceFor();

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
      const svc = serviceFor();

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
      const svc = serviceFor();

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
