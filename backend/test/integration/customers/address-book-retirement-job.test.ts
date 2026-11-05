import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../../packages/modules/customers/src/manifest.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { runAddressBookRetirementJob } from '../../../../packages/modules/customers/src/backend/workers/address-book-retirement-worker.js';
import type { AddressBookRetirementService } from '../../../../packages/modules/customers/src/backend/services/address-book-retirement-service.js';

/**
 * `specs/173-b2c-address-book-merge/` T-I8 — the retirement job end to end, as
 * the worker runs it: `runAddressBookRetirementJob` enters the real
 * `enterSystemScope`, and the service is the one the test server's composition
 * built, over the composed `customerAccountReadPort`, `organizationDetailsPort`
 * (`organizations`' own `OrganizationDetailsService`) and `addressServicePort`.
 * Nothing is stubbed, so a personal Organization is told from a company by the
 * real record, not by a fake that agrees with the test.
 */
describe('the address-book retirement job, composed (T-I8)', () => {
  let h: BackendServerHandle;
  let b2c: { id: string; organizationId: string };

  function cookieFromResponse(setCookie: string | string[] | undefined): string {
    const raw = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie ?? '');
    const m = raw.match(/b2b_session=([^;]+)/);
    if (!m) throw new Error(`no b2b_session cookie in: ${raw}`);
    return decodeURIComponent(m[1]!);
  }

  async function insertRow(customerAccountId: string, street: string): Promise<string> {
    const rows = await h
      .em()
      .fork()
      .getConnection()
      .execute<Array<{ id: string }>>(
        `insert into "customer_addresses"
           ("id", "customer_account_id", "kind", "recipient_name", "street", "city", "postal_code",
            "country", "phone", "is_default", "created_at", "updated_at")
         values (gen_random_uuid(), ?, 'delivery', 'Job Test', ?, 'Gdańsk', '80-001', 'PL', null,
                 false, now(), now())
         returning "id"`,
        [customerAccountId, street],
      );
    return rows[0]!.id;
  }

  async function row(id: string): Promise<Record<string, unknown>> {
    const rows = await h
      .em()
      .fork()
      .getConnection()
      .execute<Array<Record<string, unknown>>>(`select * from "customer_addresses" where "id" = ?`, [id]);
    return rows[0]!;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await new ManifestReconciler(h.em()).apply([customersManifest.settings!]);
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: true },
    });
    const reg = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: {
        email: `spec173-job-${Date.now()}@example.test`,
        password: 'a-very-strong-pass',
        firstName: 'Job',
        lastName: 'Buyer',
        acceptedTermsVersion: 'v1',
      },
    });
    expect(reg.statusCode, reg.body).toBe(201);
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer',
      cookies: { b2b_session: cookieFromResponse(reg.headers['set-cookie']) },
    });
    b2c = (me.json() as { data: { id: string; organizationId: string } }).data;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('moves a B2C row into the personal Organization and erases a company member’s row', async () => {
    const b2cRow = await insertRow(b2c.id, `ul. Job ${Date.now()}`);
    const companyRow = await insertRow(TEST_CUSTOMER_ID, 'ul. Firmowa 3');
    const cradle = h.container.cradle as unknown as {
      customers: { handle: () => { addressBookRetirement: AddressBookRetirementService } };
    };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const result = await runAddressBookRetirementJob({
      retirement: cradle.customers.handle().addressBookRetirement,
      log: log as never,
    });

    expect(result).not.toBeNull();
    expect(result!.moved).toBeGreaterThanOrEqual(1);
    expect(result!.erased).toBeGreaterThanOrEqual(1);
    expect(log.info).toHaveBeenCalledWith(result, expect.any(String));

    const moved = await row(b2cRow);
    expect(moved['merged_into_address_id']).not.toBeNull();
    expect(moved['deleted_at']).not.toBeNull();
    expect(moved['recipient_name']).toBe('Job Test');
    const target = await h
      .em()
      .fork()
      .getConnection()
      .execute<Array<{ organization_id: string; street: string }>>(
        `select "organization_id", "street" from "addresses" where "id" = ?`,
        [moved['merged_into_address_id']],
      );
    expect(target[0]).toMatchObject({ organization_id: b2c.organizationId, street: moved['street'] });

    const erased = await row(companyRow);
    expect(erased).toMatchObject({ recipient_name: '-', street: '-', merged_into_address_id: null });
    expect(erased['deleted_at']).not.toBeNull();
    const companyBook = await h
      .em()
      .fork()
      .getConnection()
      .execute<Array<{ id: string }>>(`select "id" from "addresses" where "organization_id" = ? and "street" = 'ul. Firmowa 3'`, [
        TEST_ORGANIZATION_ID,
      ]);
    expect(companyBook).toEqual([]);
  });
});
