import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';

/**
 * Feature 062 / T008 — sales-channel resolver step 0: a bound api key pins the
 * request to its bound channel (contracts/api-key-binding.md §3, research §R6).
 *
 *  - no explicit signal → resolved channel = bound channel; echo header carries
 *    the bound code;
 *  - explicit header naming a DIFFERENT channel → 403 API_KEY_CHANNEL_MISMATCH
 *    + audit `api_key.channel_mismatch` (fail closed, Principle XII);
 *  - bound channel inactive → INACTIVE_SALES_CHANNEL refusal, never a fallback;
 *  - unbound keys keep header/host/default resolution unchanged (FR-020).
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const PROBE_URL = '/api/v1/catalog/attribute-sets';

describe('Distributor API — bound-key channel pinning (062)', () => {
  let h: BackendServerHandle;
  let boundToken: string;
  let inactiveBoundToken: string;
  let unboundToken: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const partnerChannel = em.create(SalesChannel, {
      code: 'partner-b',
      name: { 'en-US': 'Partner B' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    const dormantChannel = em.create(SalesChannel, {
      code: 'partner-dormant',
      name: { 'en-US': 'Partner Dormant' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: false,
    });
    await em.persistAndFlush([partnerChannel, dormantChannel]);
    // Direct writes bypass the CRUD cache invalidation — drop any stale entries.
    await h.salesChannels.cache.invalidate('partner-b');
    await h.salesChannels.cache.invalidate('partner-dormant');

    const mint = async (payload: Record<string, unknown>): Promise<string> => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/api-keys',
        payload,
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { data: { bearerToken: string } }).data.bearerToken;
    };

    boundToken = await mint({
      name: 'Bound partner key',
      scopes: ['catalog:read', 'orders:read', 'orders:write'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: partnerChannel.id,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
    inactiveBoundToken = await mint({
      name: 'Bound dormant key',
      scopes: ['catalog:read', 'orders:read', 'orders:write'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: dormantChannel.id,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
    unboundToken = await mint({ name: 'Unbound PIM key', scopes: ['catalog:read'] });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('bound key with no header resolves to the bound channel and echoes its code', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: PROBE_URL,
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-sales-channel']).toBe('partner-b');
  });

  it('bound key naming its own channel explicitly still resolves (no mismatch)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: PROBE_URL,
      headers: {
        authorization: `Bearer ${boundToken}`,
        'x-sales-channel': 'partner-b',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-sales-channel']).toBe('partner-b');
  });

  it('header naming a DIFFERENT channel → 403 API_KEY_CHANNEL_MISMATCH + audit row', async () => {
    const before = await h.em().count(AuditLogEntry, { action: 'api_key.channel_mismatch' });
    const res = await h.app.inject({
      method: 'GET',
      url: PROBE_URL,
      headers: {
        authorization: `Bearer ${boundToken}`,
        'x-sales-channel': 'default',
      },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.API_KEY_CHANNEL_MISMATCH,
    );
    const after = await h.em().count(AuditLogEntry, { action: 'api_key.channel_mismatch' });
    expect(after).toBe(before + 1);
  });

  it('bound channel inactive → INACTIVE_SALES_CHANNEL, never a fallback', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: PROBE_URL,
      headers: { authorization: `Bearer ${inactiveBoundToken}` },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.INACTIVE_SALES_CHANNEL,
    );
  });

  it('unbound key keeps header-based resolution (any channel nameable)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: PROBE_URL,
      headers: {
        authorization: `Bearer ${unboundToken}`,
        'x-sales-channel': 'partner-b',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-sales-channel']).toBe('partner-b');
  });

  it('unbound key with no signal keeps the system-default fallback', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: PROBE_URL,
      headers: { authorization: `Bearer ${unboundToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-sales-channel']).toBe('default');
  });
});
