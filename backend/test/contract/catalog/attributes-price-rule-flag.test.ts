import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `isPriceRule` — the attribute flag deciding whether an attribute may be used
 * as a price-building rule in a Price List. A sibling of `isPromoRule`, so it
 * is held to the same admin contract: accepted on create, defaulting to
 * `false`, hot-toggled through PATCH, and offered by the by-flag picker
 * endpoint only while it is on.
 */
describe('Admin Attributes contract — isPriceRule flag', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  const createPayload = (key: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    key,
    label: { 'en-US': key },
    labelDefault: key,
    type: 'input',
    isSearchable: false,
    isFilterable: false,
    isVariantAxis: false,
    ...extra,
  });

  async function pickerKeys(): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attributes/by-flag?flag=isPriceRule',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { items: Array<{ key: string }> } };
    return body.data.items.map((i) => i.key);
  }

  it('POST defaults the flag to false when it is omitted', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: createPayload('price_rule_off'),
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data['isPriceRule']).toBe(false);
  });

  it('POST round-trips the flag when it is set', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      payload: createPayload('price_rule_on', { isPriceRule: true }),
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data['isPriceRule']).toBe(true);
  });

  it('GET /:idOrKey and the list both carry the flag', async () => {
    const one = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attributes/price_rule_on',
      cookies: adminCookie,
    });
    expect(one.statusCode).toBe(200);
    expect((one.json() as { data: Record<string, unknown> }).data['isPriceRule']).toBe(true);

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attributes',
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { data: Array<Record<string, unknown>> }).data;
    const byKey = new Map(rows.map((r) => [r['key'], r['isPriceRule']]));
    expect(byKey.get('price_rule_on')).toBe(true);
    expect(byKey.get('price_rule_off')).toBe(false);
  });

  it('GET /by-flag offers only the attributes carrying the flag', async () => {
    const keys = await pickerKeys();
    expect(keys).toContain('price_rule_on');
    expect(keys).not.toContain('price_rule_off');
  });

  it('PATCH toggles the flag, and the picker follows', async () => {
    const on = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/price_rule_off',
      payload: { isPriceRule: true },
      cookies: adminCookie,
    });
    expect(on.statusCode).toBe(200);
    expect((on.json() as { data: Record<string, unknown> }).data['isPriceRule']).toBe(true);
    expect(await pickerKeys()).toContain('price_rule_off');

    const off = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/price_rule_off',
      payload: { isPriceRule: false },
      cookies: adminCookie,
    });
    expect(off.statusCode).toBe(200);
    expect((off.json() as { data: Record<string, unknown> }).data['isPriceRule']).toBe(false);
    expect(await pickerKeys()).not.toContain('price_rule_off');
  });

  it('PATCH of another flag leaves isPriceRule untouched', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/price_rule_on',
      payload: { isComparable: true },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: Record<string, unknown> }).data['isPriceRule']).toBe(true);
  });
});
