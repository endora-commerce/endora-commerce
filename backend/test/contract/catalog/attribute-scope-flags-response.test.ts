import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAttributeResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163 (T095b) — the admin attribute response carries `channelScoped` and
 * `languageScoped`, on create, update, read by key and list, so the attribute editor's
 * scope flags show what is stored. Without them the editor read both as `false` on a
 * real server and the scope-flag UI never appeared.
 */
describe('Admin attribute response — scope flags (spec 163, T095b)', () => {
  let h: BackendServerHandle;
  const key = `scope_flags_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/attributes/${key}`, ...admin });
    await teardownBackendServer(h);
  });

  // Feature 170 (R15): one flag, and the scope set it derives with the value type.
  function flagsOf(body: unknown): { scopable: boolean | undefined; scopeLevels: string[] | undefined } {
    const data = adminAttributeResponseSchema.parse((body as { data: unknown }).data);
    return { scopable: data.scopable, scopeLevels: data.scopeLevels };
  }

  it('create, read, list and update answer the stored flags', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      ...admin,
      payload: {
        key,
        label: { 'en-US': key },
        labelDefault: key,
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        scopable: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(flagsOf(created.json())).toEqual({ scopable: true, scopeLevels: ['G', 'C', 'CL'] });

    const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/attributes/${key}`, ...admin });
    expect(read.statusCode).toBe(200);
    expect(flagsOf(read.json())).toEqual({ scopable: true, scopeLevels: ['G', 'C', 'CL'] });

    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/catalog/attributes', ...admin });
    expect(list.statusCode).toBe(200);
    const row = (list.json() as { data: Array<{ key: string }> }).data.find((a) => a.key === key);
    expect(flagsOf({ data: row })).toEqual({ scopable: true, scopeLevels: ['G', 'C', 'CL'] });

    const updated = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${key}`,
      ...admin,
      payload: { scopable: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(flagsOf(updated.json())).toEqual({ scopable: false, scopeLevels: ['G'] });
  });
});
