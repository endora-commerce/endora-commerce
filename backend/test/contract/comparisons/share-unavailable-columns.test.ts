import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { clearProductScopes, setChannelAudience, setChannelStatus } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, owner decision CMP-1 = A (2026-10-26; FR-002, FR-004,
 * `contracts/consumers.md` row 12) — a comparison column whose product is not available
 * at the viewer's (channel, language) is the owner's own history and nobody else's:
 *
 * - the owner keeps the column as it was, with `available: false`;
 * - any other reader (a share-link recipient) gets the existing `(removed product)`
 *   column shape — no name, SKU, slug, price, image or compared values — so a removed
 *   product and an unavailable one cannot be told apart, and `hiddenProductCount`
 *   does not move. The column carries an opaque per-view key, not the product's id
 *   (final security review S-L1a).
 *
 * Owner decision SEC-2 = A (2026-10-27) — the owner keeps the history column only for a
 * lifecycle reason. A product the channel's effective audience no longer admits the
 * owner's organization to collapses to the `(removed product)` column for the owner
 * too (`/me`, the share link read by its owner; `/me/pdf` renders the same view),
 * counted nowhere; the operator's audit view keeps every column.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN = { b2b_session: 'stub-admin-session' };
const REMOVED = {
  sku: '',
  name: '(removed product)',
  slug: '',
  primaryAssetUrl: null,
  price: null,
  available: false,
};

const BUYER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

interface Column {
  id: string;
  sku: string;
  name: string;
  slug: string;
  primaryAssetUrl: string | null;
  price: unknown;
  available: boolean;
}
interface View {
  id: string;
  shareToken: string;
  products: Column[];
  comparableAttributes: Array<{ values: unknown[] }>;
  hiddenProductCount: number;
}

describe('163 CMP-1 — an unavailable column is shown only to the owner [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channels: string[] = [];
  let on: MinimumProductFixture;
  let off: MinimumProductFixture;
  let aud: MinimumProductFixture;
  let shareToken: string;

  const clearComparisons = () =>
    h
      .em()
      .getConnection()
      .execute(`delete from "comparisons" where "customer_account_id" = ?`, [TEST_CUSTOMER_ID]);

  const share = (cookies?: Record<string, string>) =>
    h.app.inject({
      method: 'GET',
      url: `/api/v1/comparisons/share/${shareToken}`,
      headers: CHANNEL,
      ...(cookies ? { cookies } : {}),
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channels = await buyerChannelIds(em);
    on = await createMinimumProduct(em, { sku: `S163-CMP1-ON-${RUN}`, nameEn: 'Shown', namePl: 'Widoczny', channelIds: channels });
    off = await createMinimumProduct(em, { sku: `S163-CMP1-OFF-${RUN}`, nameEn: 'Gone off', namePl: 'Wyłączony', channelIds: channels });
    aud = await createMinimumProduct(em, { sku: `S163-CMP1-AUD-${RUN}`, nameEn: 'Audience gone', namePl: 'Poza odbiorcami', channelIds: channels });
    await clearComparisons();
    for (const productId of [on.id, off.id, aud.id]) {
      const added = await h.app.inject({
        method: 'POST',
        url: '/api/v1/comparisons/me/products',
        cookies: BUYER,
        headers: { ...CHANNEL, 'content-type': 'application/json' },
        payload: { productId },
      });
      expect(added.statusCode, added.body).toBe(200);
      shareToken = (added.json() as { data: View }).data.shareToken;
    }
    await setChannelStatus(em, off.id, channels, 'inactive');
    // SEC-2 — the buyer channels' audience now admits another organization only.
    await setChannelAudience(em, aud.id, channels, {
      visibility: 'organization_restricted',
      allowedOrganizationIds: [OTHER_TEST_ORGANIZATION_ID],
    });
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await clearComparisons();
    await clearProductScopes(h.em(), [on.id, off.id, aud.id]);
    await teardownBackendServer(h);
  });

  it('the owner keeps the column, marked unavailable', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/comparisons/me', cookies: BUYER, headers: CHANNEL });
    expect(res.statusCode, res.body).toBe(200);
    const column = (res.json() as { data: View }).data.products.find((p) => p.id === off.id);
    expect(column).toMatchObject({ sku: off.sku, available: false });
    expect(column!.name).not.toBe('(removed product)');

    const own = await share(BUYER);
    const body = own.json() as { data: View; meta: { viewerIsOwner: boolean } };
    expect(body.meta.viewerIsOwner).toBe(true);
    expect(body.data.products.find((p) => p.id === off.id)).toMatchObject({ sku: off.sku, available: false });
  });

  it('a recipient gets the removed-product shape for it, and the available column as usual', async () => {
    const res = await share();
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: View; meta: { viewerIsOwner: boolean } };
    expect(body.meta.viewerIsOwner).toBe(false);
    // Columns keep the order they were added in: ON, OFF, AUD.
    const index = 1;
    expect(body.data.products[index]).toEqual(expect.objectContaining(REMOVED));
    for (const row of body.data.comparableAttributes) expect(row.values[index]).toBeNull();
    expect(body.data.products.find((p) => p.id === on.id)).toMatchObject({ sku: on.sku, available: true });
    expect(body.data.hiddenProductCount).toBe(0);
  });

  it('a recipient’s removed-product column names no product id (S-L1a)', async () => {
    const first = (await share()).json() as { data: View };
    const second = (await share()).json() as { data: View };
    const ids = first.data.products.map((p) => p.id);
    expect(ids).not.toContain(off.id);
    expect(ids).not.toContain(aud.id);
    for (const index of [1, 2]) {
      expect(first.data.products[index]!.id).toMatch(UUID);
      expect(first.data.products[index]!.id).not.toBe(second.data.products[index]!.id);
    }
  });

  it('the owner’s column of a product the channel audience no longer admits them to collapses (SEC-2)', async () => {
    const me = await h.app.inject({ method: 'GET', url: '/api/v1/comparisons/me', cookies: BUYER, headers: CHANNEL });
    expect(me.statusCode, me.body).toBe(200);
    const view = (me.json() as { data: View }).data;
    expect(view.products.map((p) => p.id)).toEqual([on.id, off.id, aud.id]);
    expect(view.products[2]).toEqual(expect.objectContaining(REMOVED));
    for (const row of view.comparableAttributes) expect(row.values[2]).toBeNull();
    expect(view.hiddenProductCount).toBe(0);
    // A lifecycle reason still keeps the owner's history column.
    expect(view.products[1]).toMatchObject({ sku: off.sku, available: false });

    const own = (await share(BUYER)).json() as { data: View; meta: { viewerIsOwner: boolean } };
    expect(own.meta.viewerIsOwner).toBe(true);
    const { id: _ownId, ...ownColumn } = own.data.products[2]!;
    const { id: _recipientId, ...recipientColumn } = ((await share()).json() as { data: View }).data.products[2]!;
    expect(ownColumn).toEqual(recipientColumn);
    expect(own.data.hiddenProductCount).toBe(0);
  });

  // Final QA Q-L6 — the owner's own PDF renders the view `/me` answers: the history
  // column kept, the audience-refused one collapsed (the renderer is spied on, as in
  // `pdf-template-export.test.ts`: PDF bytes are compressed).
  it('the owner’s PDF renders exactly the view /me answers (CMP-1, SEC-2)', async () => {
    const renderer = h.container.resolve('documentRenderer') as { buildDefinition: (input: unknown) => Promise<unknown> };
    const spy = vi.spyOn(renderer, 'buildDefinition');
    try {
      const pdf = await h.app.inject({ method: 'GET', url: '/api/v1/comparisons/me/pdf', cookies: BUYER, headers: CHANNEL });
      expect(pdf.statusCode, pdf.body).toBe(200);
      const call = spy.mock.calls[0]?.[0] as { data: { view: View } } | undefined;
      const me = await h.app.inject({ method: 'GET', url: '/api/v1/comparisons/me', cookies: BUYER, headers: CHANNEL });
      expect(call?.data.view).toEqual((me.json() as { data: View }).data);
      expect(call?.data.view.products[1]).toMatchObject({ id: off.id, sku: off.sku, available: false });
      expect(call?.data.view.products[2]).toEqual(expect.objectContaining(REMOVED));
    } finally {
      spy.mockRestore();
    }
  });

  it('the operator’s audit view keeps every column (SEC-2 does not reach it)', async () => {
    const me = (
      (await h.app.inject({ method: 'GET', url: '/api/v1/comparisons/me', cookies: BUYER, headers: CHANNEL })).json() as {
        data: View;
      }
    ).data;
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/comparisons/${me.id}`, cookies: ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    const products = (res.json() as { data: { products: Column[] } }).data.products;
    expect(products.find((p) => p.id === aud.id)).toMatchObject({ sku: aud.sku, available: false });
    // CMP-1 (Q-L6) — and the column gone off, as the owner keeps it.
    expect(products.find((p) => p.id === off.id)).toMatchObject({ sku: off.sku, available: false });
  });

  it('the owner still removes the collapsed column by the product id', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/comparisons/me/products/${aud.id}`,
      cookies: BUYER,
      headers: CHANNEL,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: View }).data.products.map((p) => p.id)).toEqual([on.id, off.id]);
  });
});
