import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import { ApiKey } from '../../../src/modules/api_keys/entities/api-key.entity.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';

/**
 * Feature 062 / T010 — `requireBoundApiKey(scope)` gate
 * (contracts/api-key-binding.md §4, research §R11):
 *   authenticate → 401; scope miss → 403 API_KEY_OUT_OF_SCOPE (audited,
 *   unchanged); no binding → 403 API_KEY_NOT_BOUND + audit `api_key.not_bound`;
 *   success stashes the resolved binding on the request.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const LEGACY_ORDERS_TOKEN = 'sk_live_legacy-unbound-orders-key-062';

describe('requireBoundApiKey gate (062)', () => {
  let h: BackendServerHandle;
  let probe: FastifyInstance;
  let boundToken: string;
  let unboundReadToken: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const defaultChannel = await h.salesChannels.resolver.getSystemDefault();

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
      name: 'Bound gate key',
      scopes: ['catalog:read', 'orders:read', 'orders:write'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: defaultChannel!.id,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
    unboundReadToken = await mint({ name: 'Unbound read key', scopes: ['catalog:read'] });

    // A legacy row with a free-text orders scope but no binding — creation
    // refuses this shape today (B1), but stored legacy keys must fail closed
    // at the gate with API_KEY_NOT_BOUND.
    const em = h.em();
    const legacy = em.create(ApiKey, {
      name: 'Legacy orders key',
      keyHash: createHash('sha256').update(LEGACY_ORDERS_TOKEN, 'utf8').digest('hex'),
      lastFour: LEGACY_ORDERS_TOKEN.slice(-4),
      scopes: ['orders:write'],
    });
    await em.persistAndFlush(legacy);

    probe = Fastify();
    registerErrorEnvelope(probe);
    probe.get(
      '/probe',
      { preHandler: h.integrations.requireBoundApiKey('orders:write') },
      async (request) => ({ data: { binding: request.apiKeyBinding ?? null } }),
    );
    await probe.ready();
  });

  afterAll(async () => {
    await probe.close();
    await teardownBackendServer(h);
  });

  it('missing bearer → 401 UNAUTHORIZED', async () => {
    const res = await probe.inject({ method: 'GET', url: '/probe' });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.UNAUTHORIZED,
    );
  });

  it('scope miss → 403 API_KEY_OUT_OF_SCOPE (existing audited refusal)', async () => {
    const before = await h.em().count(AuditLogEntry, { action: 'api_key.out_of_scope' });
    const res = await probe.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: `Bearer ${unboundReadToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.API_KEY_OUT_OF_SCOPE,
    );
    const after = await h.em().count(AuditLogEntry, { action: 'api_key.out_of_scope' });
    expect(after).toBe(before + 1);
  });

  it('unbound key with the scope → 403 API_KEY_NOT_BOUND + audit api_key.not_bound', async () => {
    const before = await h.em().count(AuditLogEntry, { action: 'api_key.not_bound' });
    const res = await probe.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: `Bearer ${LEGACY_ORDERS_TOKEN}` },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.API_KEY_NOT_BOUND,
    );
    const after = await h.em().count(AuditLogEntry, { action: 'api_key.not_bound' });
    expect(after).toBe(before + 1);
  });

  it('bound key with the scope passes and stashes the resolved binding', async () => {
    const res = await probe.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: `Bearer ${boundToken}` },
    });
    expect(res.statusCode).toBe(200);
    const { binding } = (res.json() as {
      data: { binding: Record<string, unknown> | null };
    }).data;
    expect(binding).toMatchObject({
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: TEST_CUSTOMER_ID,
    });
    expect(typeof binding!['apiKeyId']).toBe('string');
    expect(typeof binding!['salesChannelId']).toBe('string');
  });
});
