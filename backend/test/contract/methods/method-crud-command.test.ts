import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';

/**
 * Issue #125 — the payment- and delivery-method writes run through the bus.
 *
 * `admin-crud-audit.test.ts` (issue #122) proves a row lands. This one proves
 * *which* rows land: the exact action names these four handlers record, one row
 * per write and no more, with the diff the Command captured. MR !545 left these
 * writes auditing by hand, which is a different set of rows on a different
 * transaction.
 *
 * Until D-163 each assertion below was followed by an
 * `isRegisteredCommand(entry.action)` line, on the stated ground that "the
 * registry is what the coverage check and any future undo affordance read".
 * Neither was ever true — `check:command-coverage` decides coverage
 * syntactically from `commandBus.run(` and has never imported
 * `command-registry.ts`, and the one undo affordance reads the `reversible`
 * **column** on `catalog_bulk_operations`. So the line asserted that a string
 * appeared in a list nothing read, and it is gone with the list. What proves
 * the path is here and in the static check: the sorted action sets below are
 * exact, so a hand-written audit call that wrote a different action or a second
 * row fails, and `check:command-coverage --strict` fails the build on a method
 * that both runs a Command and audits by hand.
 *
 * The upsert keeps two actions rather than collapsing into one `.upsert`,
 * because "the operator created this method" and "the operator changed it" are
 * different answers to the question an auditor brings to the log.
 */
describe('method CRUD runs through the Command Bus (issue #125)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('records payment-method create, update and delete as Command actions', async () => {
    const create = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/payment-methods/command_probe_card',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'command_probe_card',
        name: { 'en-US': 'Command probe' },
        kind: 'bank_transfer',
      },
    });
    expect(create.statusCode).toBe(200);
    const row = (create.json() as { data: { id: string } }).data;

    const update = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/payment-methods/command_probe_card',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'command_probe_card',
        name: { 'en-US': 'Command probe (renamed)' },
        kind: 'bank_transfer',
        status: 'inactive',
      },
    });
    expect(update.statusCode).toBe(200);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/payment-methods/${row.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(204);

    const entries = await h
      .em()
      .find(AuditLogEntry, { objectType: 'payment_method', objectId: row.id });
    expect(entries.map((e) => e.action).sort()).toEqual([
      'payment_method.create',
      'payment_method.delete',
      'payment_method.update',
    ]);
  });

  it('records delivery-method create, update and delete as Command actions', async () => {
    const create = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/command_probe_courier',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'command_probe_courier',
        name: { 'en-US': 'Command probe courier' },
        cost: 12.5,
        currency: 'PLN',
      },
    });
    expect(create.statusCode).toBe(200);
    const row = (create.json() as { data: { id: string } }).data;

    const update = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/delivery-methods/command_probe_courier',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'command_probe_courier',
        name: { 'en-US': 'Command probe courier' },
        cost: 19.99,
        currency: 'PLN',
      },
    });
    expect(update.statusCode).toBe(200);
    // The adapter a row already carries survives an update that omits it —
    // resolved inside the Command now, against the row the transaction sees.
    expect((update.json() as { data: { adapter: string } }).data.adapter).toBe(
      'command_probe_courier',
    );

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/delivery-methods/${row.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(204);

    const entries = await h
      .em()
      .find(AuditLogEntry, { objectType: 'delivery_method', objectId: row.id });
    expect(entries.map((e) => e.action).sort()).toEqual([
      'delivery_method.create',
      'delivery_method.delete',
      'delivery_method.update',
    ]);

    const updated = entries.find((e) => e.action === 'delivery_method.update')!;
    expect((updated.stateBefore as { cost?: string } | null)?.cost).toBe('12.50');
    expect((updated.stateAfter as { cost?: string } | null)?.cost).toBe('19.99');
  });
});
