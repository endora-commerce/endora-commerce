import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { inputSurfaceFieldsResponseSchema } from '@endora-commerce/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/175-buyer-input-custom-fields/contracts/input-surface-read.md` (FR-029,
 * FR-030; research R-7) — the anonymous read of the fields open on an input
 * surface: reachable on a store closed to anonymous visitors, answering a
 * definition change on the next read, and dropping the storefront's cached copy
 * through its revalidation tag when a definition of a type that declares a
 * surface changes [real DB].
 *
 * `fetch` is the seam the revalidator crosses; the harness serves requests
 * through `app.inject`, which never touches it (the
 * `integration/cms/storefront-revalidation.test.ts` precedent).
 */

const SURFACE = 'organization.register';
const READ_URL = `/api/v1/custom-fields/input-surfaces/${SURFACE}`;
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions';
const TAG = `custom-fields:input-surface:${SURFACE}`;
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const CLOSED = 'cf175-closed';

const STOREFRONT = 'http://storefront.test:3010';
const REVALIDATE_URL = `${STOREFRONT}/api/revalidate`;
const ORIGINAL_ENV = {
  url: process.env['STOREFRONT_BASE_URL'],
  secret: process.env['REVALIDATE_SECRET'],
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('Custom Fields — the public read of an input surface [contract]', () => {
  let h: BackendServerHandle;
  let posted: string[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env['STOREFRONT_BASE_URL'] = STOREFRONT;
    process.env['REVALIDATE_SECRET'] = 'sekret';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) !== REVALIDATE_URL) return realFetch(input as never, init);
      posted.push(...(JSON.parse(String(init?.body)) as { tags: string[] }).tags);
      return new Response(JSON.stringify({ revalidated: true }), { status: 200 });
    });

    h = await setupBackendServer();
    const em = h.em();
    em.create(SalesChannel, {
      code: CLOSED,
      name: { 'en-US': CLOSED },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      anonymousAccess: false,
    });
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
  });

  afterEach(() => {
    posted = [];
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    restoreEnv('STOREFRONT_BASE_URL', ORIGINAL_ENV.url);
    restoreEnv('REVALIDATE_SECRET', ORIGINAL_ENV.secret);
    await teardownBackendServer(h);
  });

  async function read(headers: Record<string, string> = {}) {
    const res = await h.app.inject({ method: 'GET', url: READ_URL, headers });
    expect(res.statusCode, res.body).toBe(200);
    return inputSurfaceFieldsResponseSchema.parse(res.json()).data;
  }

  async function createDefinition(payload: Record<string, unknown>): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: DEFINITIONS_URL,
      ...ADMIN,
      payload: {
        label: {},
        valueType: 'text',
        required: false,
        audience: 'customer',
        sortOrder: 0,
        config: {},
        carryTo: [],
        options: [],
        ...payload,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json().data as { id: string }).id;
  }

  it('is reachable anonymously on a store closed to anonymous visitors', async () => {
    const data = await read({ 'x-sales-channel': CLOSED });
    expect(data.surface).toBe(SURFACE);
  });

  it('answers a definition change on the next read', async () => {
    const id = await createDefinition({
      entityType: 'customer',
      key: 'cf175_read_phone',
      labelDefault: 'Phone',
      customerInput: [SURFACE],
    });
    expect((await read()).entities.customer?.map((f) => f.key)).toContain('cf175_read_phone');

    const closed = await h.app.inject({
      method: 'PATCH',
      url: `${DEFINITIONS_URL}/${id}`,
      ...ADMIN,
      payload: { customerInput: [] },
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await read()).entities.customer?.map((f) => f.key) ?? []).not.toContain('cf175_read_phone');
  });

  it('revalidates the storefront tag when a definition or option of organization or customer changes', async () => {
    const id = await createDefinition({
      entityType: 'organization',
      key: 'cf175_read_source',
      labelDefault: 'Source',
      valueType: 'select',
      customerInput: [SURFACE],
      options: [{ value: 'web', label: {}, labelDefault: 'Web', isDefault: false, sortOrder: 0 }],
    });
    await vi.waitFor(() => expect(posted).toContain(TAG));

    posted = [];
    const option = await h.app.inject({
      method: 'POST',
      url: `${DEFINITIONS_URL}/${id}/options`,
      ...ADMIN,
      payload: { value: 'trade_fair', label: {}, labelDefault: 'Trade fair', isDefault: false, sortOrder: 1 },
    });
    expect(option.statusCode, option.body).toBe(201);
    await vi.waitFor(() => expect(posted).toContain(TAG));
  });

  it('does not revalidate it for a type that declares no surface', async () => {
    await createDefinition({ entityType: 'order', key: 'cf175_read_order', labelDefault: 'Order field' });
    // Give a fire-and-forget call the time it would take, then assert it never came.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posted).not.toContain(TAG);
  });
});
