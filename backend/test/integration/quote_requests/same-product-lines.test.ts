import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const QR = '/api/v1/admin/quote-requests';

interface Line {
  id: string;
  productId: string;
  quantity: number;
  agreedUnitPrice: number | null;
}

/**
 * `specs/192-quote-request-draft-share/` T032 (FR-011, research R-16) — one
 * product on two lines at two prices stays two lines with their own prices:
 * through the draft's create and edit, the share, the customer's read and
 * acceptance, and a revision after the share that re-sends the lines without
 * their ids (`pairLines`). Draft and share never merge them.
 */
describe('one product on several lines, through draft and share', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const pairsOf = (lines: Line[]) =>
    lines.map((line) => [line.productId, line.quantity, line.agreedUnitPrice]).sort((a, b) => Number(a[1]) - Number(b[1]));

  it('keeps two lines with their own prices throughout', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: QR,
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 10, agreedUnitPrice: 9 },
          { productId: SEED_PRODUCT_101_ID, quantity: 50, agreedUnitPrice: 7.5 },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const draft = (created.json() as { data: { id: string; version: number; items: Line[] } }).data;
    expect(pairsOf(draft.items)).toEqual([
      [SEED_PRODUCT_101_ID, 10, 9],
      [SEED_PRODUCT_101_ID, 50, 7.5],
    ]);

    // Edited while a draft: each line by its id.
    const [small, large] = [...draft.items].sort((a, b) => a.quantity - b.quantity);
    const edited = await h.app.inject({
      method: 'PATCH',
      url: `${QR}/${draft.id}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${draft.version}"` },
      payload: {
        items: [
          { id: small!.id, productId: SEED_PRODUCT_101_ID, quantity: 12, agreedUnitPrice: 8.8 },
          { id: large!.id, productId: SEED_PRODUCT_101_ID, quantity: 50, agreedUnitPrice: 7.25 },
        ],
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(pairsOf((edited.json() as { data: { items: Line[] } }).data.items)).toEqual([
      [SEED_PRODUCT_101_ID, 12, 8.8],
      [SEED_PRODUCT_101_ID, 50, 7.25],
    ]);

    const shared = await h.app.inject({ method: 'POST', url: `${QR}/${draft.id}/share`, cookies: ADMIN });
    expect(shared.statusCode, shared.body).toBe(200);
    const afterShare = (shared.json() as { data: { version: number; items: Line[] } }).data;
    expect(pairsOf(afterShare.items)).toEqual([
      [SEED_PRODUCT_101_ID, 12, 8.8],
      [SEED_PRODUCT_101_ID, 50, 7.25],
    ]);

    // A revision after the share, the lines re-sent without their ids.
    const revised = await h.app.inject({
      method: 'PATCH',
      url: `${QR}/${draft.id}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${afterShare.version}"` },
      payload: {
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 12, agreedUnitPrice: 8.5 },
          { productId: SEED_PRODUCT_101_ID, quantity: 50, agreedUnitPrice: 7 },
        ],
      },
    });
    expect(revised.statusCode, revised.body).toBe(200);

    const read = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${draft.id}`, cookies: CUSTOMER });
    expect(read.statusCode, read.body).toBe(200);
    const customerView = (read.json() as { data: { currentRevisionNumber: number; items: Line[] } }).data;
    expect(pairsOf(customerView.items)).toEqual([
      [SEED_PRODUCT_101_ID, 12, 8.5],
      [SEED_PRODUCT_101_ID, 50, 7],
    ]);

    const accepted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${draft.id}/accept-revision`,
      cookies: CUSTOMER,
      payload: { expectedRevisionNumber: customerView.currentRevisionNumber },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const final = (accepted.json() as { data: { status: string; items: Line[] } }).data;
    expect(final.status).toBe('Approved');
    expect(pairsOf(final.items)).toEqual([
      [SEED_PRODUCT_101_ID, 12, 8.5],
      [SEED_PRODUCT_101_ID, 50, 7],
    ]);
  });
});
