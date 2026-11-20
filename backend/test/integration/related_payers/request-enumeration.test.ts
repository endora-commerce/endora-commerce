import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, makeOrganization, makeOrganizationWithAdmin } from './fixtures.js';

/**
 * `specs/182-related-payers/` T070 (FR-041, FR-046, SC-002) — a request's reply says nothing
 * about the tax ID: an eligible Organization, an ineligible one, several, none — the same status,
 * the same body shape, no header that varies by outcome; and the daily-limit refusal is checked
 * before the lookup, so it, too, is one reply whatever the tax ID.
 *
 * "Several" is not reachable here: in the default (global) tax-ID scope a tax ID is unique, and
 * the per-tree-root scope that allows a shared one is installation-wide (`specs/177-tax-id-scope/`),
 * which a parallel file must not switch. Its routing is `request-routing.test.ts`'s; its reply
 * goes through the same single `create` path asserted here.
 */
describe('related_payers — requests do not enumerate tax IDs', () => {
  let h: BackendServerHandle;
  let sender: Awaited<ReturnType<typeof makeOrganizationWithAdmin>>;
  const taxIds: Record<string, string> = {};
  const requestIds: string[] = [];

  const send = (taxId: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/account/related-payers/requests',
      cookies: sender.cookie,
      payload: { taxId, contactEmail: 'contact@example.com' },
    });

  /** Everything a sender could compare: status, body shape, and headers other than the volatile. */
  const fingerprint = (res: Awaited<ReturnType<typeof send>>) => {
    const body = res.json() as { data?: { id: string; state: string }; error?: { code: string } };
    const headers = Object.keys(res.headers)
      .filter((k) => !['date', 'x-request-id', 'content-length', 'set-cookie'].includes(k))
      .sort()
      .map((k) => `${k}=${k === 'content-type' ? res.headers[k] : '·'}`);
    return {
      status: res.statusCode,
      shape: body.data ? { keys: Object.keys(body.data).sort(), state: body.data.state } : { error: body.error?.code },
      headers,
    };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const enabled = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/related_payers.enabled/value',
      cookies: ADMIN,
      payload: { scope: 'all', value: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    const limit = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/related_payers.daily_request_limit/value',
      cookies: ADMIN,
      payload: { scope: 'all', value: 3 },
    });
    expect(limit.statusCode, limit.body).toBe(200);
    sender = await makeOrganizationWithAdmin(h.em(), 'Enumerating buyer');
    taxIds['eligible'] = (await makeOrganizationWithAdmin(h.em(), 'Eligible payer')).taxId;
    const blocked = await makeOrganization(h.em(), 'Blocked payer', { status: 'blocked' });
    taxIds['ineligible'] = ((await h.em().getConnection().execute('select tax_id from organizations where id = ?', [blocked])) as Array<{ tax_id: string }>)[0]!.tax_id;
    taxIds['unknown'] = 'PL9999999999';
  }, 120_000);

  afterAll(async () => {
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/related_payers.daily_request_limit/value',
      cookies: ADMIN,
      payload: { scope: 'all', value: 20 },
    });
    await teardownBackendServer(h);
  });

  it('eligible, ineligible and unknown tax IDs answer identically', async () => {
    const prints = [];
    for (const kind of ['eligible', 'ineligible', 'unknown']) {
      const res = await send(taxIds[kind]!);
      prints.push(fingerprint(res));
      requestIds.push(res.json().data.id as string);
    }
    expect(prints[0]).toMatchObject({ status: 202, shape: { keys: ['id', 'state'], state: 'pending' } });
    for (const print of prints) expect(print).toEqual(prints[0]);
  });

  it('every outcome leaves the same after-commit work behind: the routing is decided by the outbox, not the reply', async () => {
    const rows = (await h.em().getConnection().execute(
      `select object_id, hook_module, hook_id, status from command_outbox
        where action = 'related_payers.request.create' and object_id in (?, ?, ?) order by hook_id`,
      requestIds,
    )) as Array<{ object_id: string; hook_module: string; hook_id: string; status: string }>;
    const per = requestIds.map((id) => rows.filter((r) => r.object_id === id).map((r) => `${r.hook_module}/${r.hook_id}/${r.status}`));
    expect(per[0]!.length).toBeGreaterThan(0);
    for (const one of per) expect(one).toEqual(per[0]);
  });

  it('the sender\'s list shows one `pending` per request, never the counterparty or routing', async () => {
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/account/related-payers/requests', cookies: sender.cookie });
    expect(list.statusCode, list.body).toBe(200);
    const rows = list.json().data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row['state']).toBe('pending');
      for (const hidden of ['counterpartyOrganizationId', 'routing', 'operatorReason', 'candidates']) expect(row).not.toHaveProperty(hidden);
    }
  });

  it('past the daily limit every tax ID is refused alike, before any lookup (FR-046)', async () => {
    const prints = [];
    for (const kind of ['eligible', 'ineligible', 'unknown']) prints.push(fingerprint(await send(taxIds[kind]!)));
    expect(prints[0]).toMatchObject({ status: 429, shape: { error: 'RELATED_PAYER_REQUEST_LIMIT' } });
    for (const print of prints) expect(print).toEqual(prints[0]);
  });
});
