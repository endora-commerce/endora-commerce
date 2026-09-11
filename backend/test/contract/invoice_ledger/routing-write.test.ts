import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoiceLedgerRoutingDtoSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const ROUTING_URL = '/api/v1/admin/invoice-ledger/routing';

describe('invoice_ledger — routing write [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses a numbering mode change without confirm: true and leaves the mode unchanged', async () => {
    const before = await h.app.inject({ method: 'GET', url: ROUTING_URL, ...ADMIN });
    expect(before.statusCode, before.body).toBe(200);
    const beforeData = (before.json() as { data: { numberingMode: 'endora' | 'vendor' } }).data;
    expect(invoiceLedgerRoutingDtoSchema.safeParse(beforeData).success, before.body).toBe(true);
    const nextMode = beforeData.numberingMode === 'endora' ? 'vendor' : 'endora';

    const refused = await h.app.inject({
      method: 'PUT',
      url: ROUTING_URL,
      ...ADMIN,
      payload: { numberingMode: nextMode },
    });
    expect(refused.statusCode, refused.body).toBe(400);

    const still = await h.app.inject({ method: 'GET', url: ROUTING_URL, ...ADMIN });
    expect((still.json() as { data: { numberingMode: string } }).data.numberingMode).toBe(
      beforeData.numberingMode,
    );
  });

  it('writes numbering mode vendor when confirm: true', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: ROUTING_URL,
      ...ADMIN,
      payload: { numberingMode: 'vendor', confirm: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: unknown }).data;
    expect(invoiceLedgerRoutingDtoSchema.safeParse(data).success, res.body).toBe(true);
    expect(data).toMatchObject({ numberingMode: 'vendor' });

    const read = await h.app.inject({ method: 'GET', url: ROUTING_URL, ...ADMIN });
    expect((read.json() as { data: { numberingMode: string } }).data.numberingMode).toBe('vendor');
  });

  it('writes KSeF routing without confirm because numbering did not change', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: ROUTING_URL,
      ...ADMIN,
      payload: { ksefRouting: 'vendor' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { ksefRouting: string } }).data.ksefRouting).toBe('vendor');
  });
});
