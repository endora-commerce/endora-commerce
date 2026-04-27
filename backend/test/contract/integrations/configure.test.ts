import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T223 — POST /admin/integrations creates the row and runs the connection
 * probe synchronously. The response carries `testResult.ok` + the integration
 * row's `status` reflecting the probe outcome.
 *
 * Asserts both branches:
 *   - reachable baseUrl → status='active', ok=true
 *   - unreachable / failing baseUrl → status='error', ok=false, lastError set
 */

interface ConfigureResponse {
  id: string;
  name: string;
  vendor: string;
  status: 'active' | 'inactive' | 'error';
  lastError: string | null;
  testResult: { ok: boolean; status: string; message: string | null };
}

describe('POST /api/v1/admin/integrations — configure + testConnection', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('marks status=active when the configured baseUrl responds with 2xx', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/integrations',
      payload: {
        name: 'PIM Sync',
        vendor: 'pim_test',
        kind: 'pim',
        config: { baseUrl: 'https://example.com' },
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: ConfigureResponse };
    expect(body.data.testResult.ok).toBe(true);
    expect(body.data.status).toBe('active');
  });

  it('marks status=error when the configured baseUrl is unreachable', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/integrations',
      payload: {
        name: 'Broken integration',
        vendor: 'broken_test',
        kind: 'pim',
        // 127.0.0.0/8 is loopback; using an unbound port should fail fetch.
        config: { baseUrl: 'http://127.0.0.1:1' },
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: ConfigureResponse };
    expect(body.data.testResult.ok).toBe(false);
    expect(body.data.status).toBe('error');
    expect(body.data.lastError).toBeTruthy();
  });
});
