import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 026 US3 — Block / unblock round-trip with transaction gate.
 *
 * Drives the admin endpoints from active → blocked → active and asserts:
 *  1. The block transition succeeds and writes blocked_reason + blocked_at.
 *  2. Once blocked, the OrganizationContextService.assertCanTransact()
 *     contract throws an OrganizationCannotTransactError.
 *  3. The unblock transition restores status to active and clears the
 *     blocked_reason / blocked_at columns.
 *  4. After unblock, assertCanTransact() succeeds again.
 *
 * The audit-log breadcrumb is exercised by US1's approve/reject tests —
 * this test focuses on the active ↔ blocked round-trip and the gate
 * behaviour, which is the operational lever the spec promises.
 */
describe('Admin block / unblock — round-trip with transaction gate', () => {
  let h: BackendServerHandle;
  let orgId: string;
  let initialVersion: number;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Seed a fresh active Organization per scenario so block/unblock state
    // doesn't leak between cases.
    const em = h.em();
    const org = em.create(Organization, {
      name: 'Block Roundtrip Co',
      taxId: `PL026${Date.now().toString().slice(-9)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Operational 1',
        city: 'Warszawa',
        postalCode: '00-005',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);
    orgId = org.id;
    initialVersion = org.version;
  });

  it('blocks an active organization and persists the reason', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/block`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        expectedVersion: initialVersion,
        reason: 'Past-due AR > 90 days',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { status: string; version: number; blockedReason: string | null; blockedAt: string | null };
    };
    expect(body.data.status).toBe('blocked');
    expect(body.data.blockedReason).toBe('Past-due AR > 90 days');
    expect(body.data.blockedAt).not.toBeNull();
    expect(body.data.version).toBe(initialVersion + 1);
  });

  it('refuses to transact when the organization is blocked', async () => {
    // Block first.
    const block = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/block`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { expectedVersion: initialVersion, reason: 'Test block' },
    });
    expect(block.statusCode).toBe(200);

    // Call the OrganizationContextService directly to confirm the
    // assertCanTransact contract throws for the blocked org. (Route-level
    // gates that consume this service are exercised by the existing
    // place-suspended.test.ts — that suite seeds an org with the legacy
    // 'blocked' status from the data migration.)
    h.em().clear();
    await expect(
      h.organizations.organizationContextService.assertCanTransact(orgId),
    ).rejects.toMatchObject({
      name: 'OrganizationCannotTransactError',
      status: 'blocked',
    });
  });

  it('round-trips active → blocked → active and clears blocked_reason on unblock', async () => {
    const block = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/block`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { expectedVersion: initialVersion, reason: 'AR hold' },
    });
    expect(block.statusCode).toBe(200);
    const blockedVersion = (block.json() as { data: { version: number } }).data.version;

    const unblock = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/unblock`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { expectedVersion: blockedVersion },
    });
    expect(unblock.statusCode).toBe(200);
    const body = unblock.json() as {
      data: { status: string; version: number; blockedReason: string | null; blockedAt: string | null };
    };
    expect(body.data.status).toBe('active');
    expect(body.data.blockedReason).toBeNull();
    expect(body.data.blockedAt).toBeNull();
    expect(body.data.version).toBe(blockedVersion + 1);

    // Now assertCanTransact succeeds.
    h.em().clear();
    await expect(
      h.organizations.organizationContextService.assertCanTransact(orgId),
    ).resolves.toBeDefined();
  });

  it('refuses to block an organization that is not active (422)', async () => {
    // Block then try to block again.
    const block = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/block`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { expectedVersion: initialVersion, reason: 'First block' },
    });
    expect(block.statusCode).toBe(200);
    const blockedVersion = (block.json() as { data: { version: number } }).data.version;

    const second = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/block`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { expectedVersion: blockedVersion, reason: 'Second block' },
    });
    expect(second.statusCode).toBe(422);
  });

  it('refuses to unblock a non-blocked organization (422)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/unblock`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { expectedVersion: initialVersion },
    });
    expect(res.statusCode).toBe(422);
  });
});
