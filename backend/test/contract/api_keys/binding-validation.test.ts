import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

/**
 * Feature 062 / T003 — API key creation binding rules B1–B5
 * (contracts/api-key-binding.md §2).
 *
 *  B1 — any `orders:*` scope ⇒ binding REQUIRED
 *  B2 — binding present ⇒ `catalog:write` FORBIDDEN
 *  B3 — service account must be an active member of the bound org
 *  B4 — org + channel must exist
 *  B5 — expiresAt, when present, must be a future instant
 *
 * Plus: happy path returns the binding fields, legacy unbound create keeps
 * working (FR-020), and revoke is unchanged.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

const FOREIGN_ORG_ID = '00000000-0000-4000-8000-00000000b0b0';
const DELETED_ORG_ID = '00000000-0000-4000-8000-00000000b0b3';
const FOREIGN_CUSTOMER_ID = '00000000-0000-4000-8000-00000000b0b1';
const BLOCKED_CUSTOMER_ID = '00000000-0000-4000-8000-00000000b0b2';

interface ErrorBody {
  error: { code: string; details?: Array<{ path: string; issue: string }> };
}

describe('API key binding validation (062 / B1–B5)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;

  const createKey = async (payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload,
      cookies: ADMIN_COOKIE,
    });

  const validBinding = () => ({
    organizationId: TEST_ORGANIZATION_ID,
    salesChannelId: defaultChannelId,
    customerAccountId: TEST_CUSTOMER_ID,
  });

  beforeAll(async () => {
    h = await setupBackendServer();
    const defaultChannel = await h.salesChannels.resolver.getSystemDefault();
    defaultChannelId = defaultChannel.id;

    // Second organization + its customer account (B3 cross-org refusal) and a
    // blocked account inside the bound org (B3 active-account refusal).
    const em = h.em();
    const foreignOrg = em.create(Organization, {
      id: FOREIGN_ORG_ID,
      name: 'Foreign Distributor Co',
      taxId: 'PL0000000062',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Obca 1',
        city: 'Warszawa',
        postalCode: '00-062',
        country: 'PL',
      },
    });
    // Flush the org first — organizationId is a plain uuid column (no ORM
    // relation), so MikroORM cannot order the inserts by FK on its own.
    await em.persistAndFlush(foreignOrg);
    const foreignCustomer = em.create(CustomerAccount, {
      id: FOREIGN_CUSTOMER_ID,
      organizationId: FOREIGN_ORG_ID,
      email: 'foreign-service@example.com',
      passwordHash: 'x',
      firstName: 'Foreign',
      lastName: 'Service',
      role: 'regular_user',
      emailVerifiedAt: new Date(),
    });
    const blockedCustomer = em.create(CustomerAccount, {
      id: BLOCKED_CUSTOMER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      email: 'blocked-service@example.com',
      passwordHash: 'x',
      firstName: 'Blocked',
      lastName: 'Service',
      role: 'regular_user',
      emailVerifiedAt: new Date(),
      blockedAt: new Date(),
    });
    await em.persistAndFlush([foreignCustomer, blockedCustomer]);

    // Feature 075 (D-87) — a soft-deleted organisation. B4's read was
    // `select 1 from "organizations" where "id" = ? and "deleted_at" is null`
    // and is `organizationDetailsPort.findById` now; that port answers with the
    // row rather than filtering, so the `deletedAt` half of the predicate is
    // the module's to keep and this case is what says it kept it.
    const deletedOrg = em.create(Organization, {
      id: DELETED_ORG_ID,
      name: 'Struck Off Distributor Co',
      taxId: 'PL0000000075',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Skreślona 1',
        city: 'Warszawa',
        postalCode: '00-075',
        country: 'PL',
      },
      deletedAt: new Date(),
    });
    await em.persistAndFlush(deletedOrg);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('B1 — orders scope without binding → 422 VALIDATION_FAILED naming `binding`', async () => {
    const res = await createKey({ name: 'B1 key', scopes: ['orders:write'] });
    expect(res.statusCode).toBe(422);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'binding' })]),
    );
  });

  it('B2 — binding with catalog:write → 422 VALIDATION_FAILED naming `scopes`', async () => {
    const res = await createKey({
      name: 'B2 key',
      scopes: ['catalog:write'],
      binding: validBinding(),
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'scopes' })]),
    );
  });

  it('B3 — service account from another organization → 422 naming binding.customerAccountId', async () => {
    const res = await createKey({
      name: 'B3 cross-org key',
      scopes: ['orders:write'],
      binding: { ...validBinding(), customerAccountId: FOREIGN_CUSTOMER_ID },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'binding.customerAccountId' }),
      ]),
    );
  });

  it('B3 — blocked service account → 422 naming binding.customerAccountId', async () => {
    const res = await createKey({
      name: 'B3 blocked key',
      scopes: ['orders:write'],
      binding: { ...validBinding(), customerAccountId: BLOCKED_CUSTOMER_ID },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'binding.customerAccountId' }),
      ]),
    );
  });

  it('B4 — unknown organization → 422 naming binding.organizationId', async () => {
    const res = await createKey({
      name: 'B4 org key',
      scopes: ['orders:write'],
      binding: {
        ...validBinding(),
        organizationId: '00000000-0000-4000-8000-00000000dead',
      },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'binding.organizationId' }),
      ]),
    );
  });

  it('B4 — soft-deleted organization → 422 naming binding.organizationId', async () => {
    const res = await createKey({
      name: 'B4 deleted org key',
      scopes: ['orders:write'],
      binding: { ...validBinding(), organizationId: DELETED_ORG_ID },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'binding.organizationId' })]),
    );
  });

  it('B4 — unknown sales channel → 422 naming binding.salesChannelId', async () => {
    const res = await createKey({
      name: 'B4 channel key',
      scopes: ['orders:write'],
      binding: {
        ...validBinding(),
        salesChannelId: '00000000-0000-4000-8000-00000000dead',
      },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'binding.salesChannelId' }),
      ]),
    );
  });

  it('B5 — past expiresAt → 422 naming expiresAt', async () => {
    const res = await createKey({
      name: 'B5 key',
      scopes: ['orders:write'],
      binding: validBinding(),
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(422);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'expiresAt' })]),
    );
  });

  it('creation validates scopes against the typed enum (free-text scope refused)', async () => {
    const res = await createKey({
      name: 'Free-text scope key',
      scopes: ['integrations:manage'],
    });
    // Schema-level Zod refusal (enum) — 400 VALIDATION_FAILED.
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrorBody).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('happy path — bound key returns binding fields + expiry and audits the binding', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const res = await createKey({
      name: 'Distributor A key',
      scopes: ['catalog:read', 'orders:read', 'orders:write'],
      binding: validBinding(),
      expiresAt,
    });
    expect(res.statusCode).toBe(201);
    const { apiKey } = (res.json() as {
      data: { apiKey: Record<string, unknown>; bearerToken: string };
    }).data;
    expect(apiKey['organizationId']).toBe(TEST_ORGANIZATION_ID);
    expect(apiKey['salesChannelId']).toBe(defaultChannelId);
    expect(apiKey['customerAccountId']).toBe(TEST_CUSTOMER_ID);
    expect(apiKey['expiresAt']).toBe(expiresAt);

    const audit = await h
      .em()
      .findOne(AuditLogEntry, { action: 'api_key.create', objectId: apiKey['id'] as string });
    expect(audit).not.toBeNull();
    expect(audit!.stateAfter).toMatchObject({
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: defaultChannelId,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
  });

  it('legacy unbound create keeps working; binding fields serialize as null', async () => {
    const res = await createKey({ name: 'Legacy PIM key', scopes: ['catalog:read'] });
    expect(res.statusCode).toBe(201);
    const { apiKey } = (res.json() as { data: { apiKey: Record<string, unknown> } }).data;
    expect(apiKey['organizationId']).toBeNull();
    expect(apiKey['salesChannelId']).toBeNull();
    expect(apiKey['customerAccountId']).toBeNull();
    expect(apiKey['expiresAt']).toBeNull();
  });

  it('revoke is unchanged — DELETE /:id returns 204', async () => {
    const created = await createKey({ name: 'To revoke', scopes: ['catalog:read'] });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { data: { apiKey: { id: string } } }).data.apiKey.id;
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/api-keys/${id}`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(204);
  });

  it('authenticate refuses an expired key (401 on a gated route)', async () => {
    const created = await createKey({
      name: 'Short-lived key',
      scopes: ['catalog:read'],
      expiresAt: new Date(Date.now() + 400).toISOString(),
    });
    expect(created.statusCode).toBe(201);
    const token = (created.json() as { data: { bearerToken: string } }).data.bearerToken;
    await new Promise((r) => setTimeout(r, 500));
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/attribute-sets',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as ErrorBody).error.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });
});
