import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CustomFieldCarryReceiverPort, CustomFieldValuePort } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CRM_ADMIN, seedCrmOrder } from '../../helpers/seed-crm.js';

/**
 * `PATCH /api/v1/admin/orders/:id/custom-fields` and another writer of the
 * same Order's bag (issue #399).
 *
 * The admin write merges the keys its request names into the bag it reads, and
 * it holds the row from that read to its write: a concurrent writer — the
 * system carry that fills empty fields of an Order right after it is created,
 * which takes the row `for update` itself — is waited for, and its value kept.
 *
 * The race is not measured with timing. A hook on the shared
 * `customFieldValueService` singleton — called by the route between its read
 * of the bag and its write — starts the carry and waits until the carry has
 * either committed (the admin holds no lock: the bug) or is seen waiting on a
 * row lock in Postgres (the admin holds the row: the fix). What tells the two
 * apart is the final bag.
 */
const API = '/api/v1/admin/custom-fields';
const RUN = randomUUID().slice(0, 8);
const fixtureKey = (name: string) => `acf_${RUN}_${name}`;

const option = (value: string, sortOrder = 0) => ({ value, label: {}, labelDefault: value, isDefault: false, sortOrder });

describe('orders — the admin custom-field write and a concurrent writer of the bag (issue #399)', () => {
  let h: BackendServerHandle;
  let carryPort: CustomFieldCarryReceiverPort;
  let values: CustomFieldValuePort;
  let originalValidateAndMerge: CustomFieldValuePort['validateAndMerge'];
  const created: string[] = [];

  const define = async (entityType: string, key: string, extra: Record<string, unknown> = {}) => {
    const response = await h.app.inject({
      method: 'POST',
      url: `${API}/definitions`,
      cookies: CRM_ADMIN,
      payload: {
        entityType,
        key,
        label: {},
        labelDefault: key,
        valueType: 'select',
        required: false,
        sortOrder: 0,
        config: {},
        options: [option('fair'), option('web', 1)],
        ...extra,
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    created.push((response.json() as { data: { id: string } }).data.id);
  };

  const patch = (orderId: string, payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/orders/${orderId}/custom-fields`,
      cookies: CRM_ADMIN,
      payload,
    });

  const receive = (recordId: string, carried: Record<string, unknown>) =>
    enterSystemScope('test: crm pushes an opportunity’s values', () =>
      carryPort.receiveCarriedValues({
        recordId,
        organizationId: TEST_ORGANIZATION_ID,
        source: { entityType: 'opportunity', recordId: randomUUID(), reference: 'OPP-000399', values: carried },
      }),
    );

  const storedValues = async (id: string): Promise<Record<string, unknown>> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(`select custom_field_values from "orders" where id = ?`, [id])) as Array<{
      custom_field_values: Record<string, unknown> | null;
    }>;
    expect(rows).toHaveLength(1);
    return rows[0]!.custom_field_values ?? {};
  };

  const setStored = async (id: string, bag: Record<string, unknown>) => {
    await h
      .em()
      .getConnection()
      .execute(`update "orders" set custom_field_values = ?::jsonb where id = ?`, [JSON.stringify(bag), id]);
  };

  /** Whether some other backend of this database is waiting on a lock. */
  const someoneWaitsOnALock = async (): Promise<boolean> => {
    const rows = (await h
      .em()
      .getConnection()
      .execute(
        `select count(*)::int as n from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock'`,
      )) as Array<{ n: number }>;
    expect(rows).toHaveLength(1);
    return rows[0]!.n > 0;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const cradle = h.container.cradle as unknown as {
      orderCustomFieldCarryPort: CustomFieldCarryReceiverPort;
      customFieldValueService: CustomFieldValuePort;
    };
    carryPort = cradle.orderCustomFieldCarryPort;
    values = cradle.customFieldValueService;
    originalValidateAndMerge = values.validateAndMerge;
  });

  afterEach(() => {
    values.validateAndMerge = originalValidateAndMerge;
  });

  afterAll(async () => {
    for (const id of [...created].reverse()) {
      await h.app.inject({ method: 'DELETE', url: `${API}/definitions/${id}`, cookies: CRM_ADMIN });
    }
    await teardownBackendServer(h);
  });

  it('merges only the keys the request names: an absent key is kept, an explicit null clears', async () => {
    const kept = fixtureKey('merge_kept');
    const changed = fixtureKey('merge_changed');
    const cleared = fixtureKey('merge_cleared');
    await define('order', kept);
    await define('order', changed);
    await define('order', cleared);
    const order = await seedCrmOrder(h.em());
    await setStored(order.id, { [kept]: 'fair', [changed]: 'fair', [cleared]: 'web' });

    const response = await patch(order.id, { [changed]: 'web', [cleared]: null });
    expect(response.statusCode, response.body).toBe(200);
    expect(await storedValues(order.id)).toEqual({ [kept]: 'fair', [changed]: 'web' });
    expect((response.json() as { data: { customFieldValues: Record<string, unknown> } }).data.customFieldValues).toEqual({
      [kept]: 'fair',
      [changed]: 'web',
    });
  });

  it('holds the row from its read to its write, so a concurrent system carry is waited for and its value kept', async () => {
    const adminKey = fixtureKey('race_admin');
    const carriedKey = fixtureKey('race_carried');
    await define('order', adminKey);
    await define('order', carriedKey);
    await define('opportunity', carriedKey, { carryTo: ['order'] });
    const order = await seedCrmOrder(h.em());

    let carry: Promise<unknown> | null = null;
    values.validateAndMerge = async function (this: unknown, entityType, currentBag, incoming) {
      // Only the admin route's call is hooked, and only once.
      values.validateAndMerge = originalValidateAndMerge;
      // Between the admin's read of the bag and its write, the system carry runs.
      const started = receive(order.id, { [carriedKey]: 'fair' });
      carry = started;
      let settled = false;
      void started.then(
        () => (settled = true),
        () => (settled = true),
      );
      for (let i = 0; i < 400 && !settled; i += 1) {
        if (await someoneWaitsOnALock()) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return originalValidateAndMerge.call(values, entityType, currentBag, incoming);
    };

    const response = await patch(order.id, { [adminKey]: 'web' });
    expect(response.statusCode, response.body).toBe(200);
    expect(carry, 'the hook between the read and the write did not run').not.toBeNull();
    expect(await carry).toEqual({ outcome: 'applied', carried: [carriedKey], skipped: [] });
    expect(await storedValues(order.id)).toEqual({ [adminKey]: 'web', [carriedKey]: 'fair' });
  });
});
