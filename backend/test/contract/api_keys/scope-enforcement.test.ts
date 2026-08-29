import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';

/**
 * T220 — Authenticated API key called with an out-of-scope action returns
 * 403 API_KEY_OUT_OF_SCOPE and writes an audit-log entry tagging the api
 * key + the attempted scope.
 */

describe('API key scope enforcement', () => {
  let h: BackendServerHandle;
  let readOnlyToken: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    // Mint a read-only key (catalog:read) — has no catalog:write scope.
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload: { name: 'Read-only PIM', scopes: ['catalog:read'] },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    readOnlyToken = (created.json() as { data: { bearerToken: string } }).data.bearerToken;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 403 API_KEY_OUT_OF_SCOPE on PUT /catalog/products/by-sku and writes an audit row', async () => {
    const before = await h.em().count(AuditLogEntry, { action: 'api_key.out_of_scope' });

    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/catalog/products/by-sku/SCOPE-TEST-001',
      payload: {
        sku: 'SCOPE-TEST-001',
        type: 'simple',
        name: { 'en-US': 'Scope test' },
        description: { 'en-US': 'Scope test' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      headers: { authorization: `Bearer ${readOnlyToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.API_KEY_OUT_OF_SCOPE,
    );

    const after = await h.em().count(AuditLogEntry, { action: 'api_key.out_of_scope' });
    expect(after).toBe(before + 1);
  });

  it('a key WITH catalog:write succeeds on the same route', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload: { name: 'PIM writer', scopes: ['catalog:write'] },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const writeToken = (created.json() as { data: { bearerToken: string } }).data.bearerToken;

    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/catalog/products/by-sku/SCOPE-TEST-002',
      payload: {
        sku: 'SCOPE-TEST-002',
        type: 'simple',
        name: { 'en-US': 'Scope test ok' },
        description: { 'en-US': 'Scope test ok' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      headers: { authorization: `Bearer ${writeToken}` },
    });
    // 201 (created) since the SKU is fresh.
    expect(res.statusCode).toBe(201);
  });

  it('feature 062 — an unbound key still operates under system scope on the PIM surface', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload: { name: 'Unbound PIM writer (062)', scopes: ['catalog:write'] },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const token = (created.json() as { data: { bearerToken: string } }).data.bearerToken;

    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/catalog/products/by-sku/SCOPE-TEST-003',
      payload: {
        sku: 'SCOPE-TEST-003',
        type: 'simple',
        name: { 'en-US': 'Unbound system-scope test' },
        description: { 'en-US': 'Unbound system-scope test' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      headers: { authorization: `Bearer ${token}` },
    });
    // The write succeeds with no organization attached to the key — the
    // unbound key keeps trusted system tenant scope (FR-020) and channel
    // resolution keeps the header/host/default path (no pinning).
    expect(res.statusCode).toBe(201);
    expect(res.headers['x-sales-channel']).toBe('default');
  });
});
