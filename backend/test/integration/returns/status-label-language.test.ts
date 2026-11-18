import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

/**
 * The buyer reads a case's status in the request's language: `statusLabel` on the
 * customer list and detail is the status's localized `name` — the exact language,
 * then its primary subtag — and its `defaultName` when the status has no label in
 * that language. The admin endpoints keep `defaultName`.
 */
describe('returns — the customer status label is in the request language', () => {
  let h: BackendServerHandle;
  let caseId: string;

  type Summary = { id: string; statusLabel: string };
  const read = async (path: string, language: string) => {
    const res = await h.app.inject({
      method: 'GET',
      url: path,
      cookies: CUSTOMER_COOKIE,
      headers: { 'accept-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: unknown }).data;
  };
  const detailLabel = async (language: string) => ((await read(`/api/v1/returns/${caseId}`, language)) as Summary).statusLabel;
  const listLabel = async (language: string) =>
    ((await read('/api/v1/returns', language)) as Summary[]).find((c) => c.id === caseId)!.statusLabel;
  const renameNew = async (name: Record<string, string>) => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/returns/statuses/new',
      cookies: ADMIN_COOKIE,
      payload: { name, defaultName: 'New' },
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  // Every label written here reads 'New' in English, so a file running beside this one
  // and reading the shared graph sees what it always did.
  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'complaint', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: await anyReasonId(h.em()) }] },
    });
    expect(created.statusCode, created.body).toBe(201);
    caseId = (created.json() as { data: { id: string } }).data.id;
  });
  afterAll(async () => {
    await resetReturnGraph(h.em());
    await teardownBackendServer(h);
  });

  it('answers the Polish label on a Polish request, on the detail and the list', async () => {
    await renameNew({ en: 'New', pl: 'Nowe' });
    expect(await detailLabel('pl-PL')).toBe('Nowe');
    expect(await listLabel('pl-PL')).toBe('Nowe');
    expect(await detailLabel('en-US')).toBe('New');
  });

  it('falls back to defaultName when the status has no label in the request language', async () => {
    await renameNew({ pl: 'Nowe' });
    expect(await detailLabel('en-US')).toBe('New');
    expect(await listLabel('en-US')).toBe('New');
  });

  it('keeps defaultName on the admin detail, whatever the request language', async () => {
    await renameNew({ en: 'New', pl: 'Nowe' });
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/returns/${caseId}`,
      cookies: ADMIN_COOKIE,
      headers: { 'accept-language': 'pl-PL' },
    });
    expect((res.json() as { data: Summary }).data.statusLabel).toBe('New');
  });
});
