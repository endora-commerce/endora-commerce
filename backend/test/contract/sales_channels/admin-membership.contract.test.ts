import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ChannelMemberIdListResponseSchema,
  ERROR_CODES,
  EntityMembershipListResponseSchema,
} from '@endora-commerce/contracts';
import { randomUUID } from 'crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Product, type ProductRow } from '../../helpers/package-entities.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

/** A key the entity-side list carries that the contract does not declare fails (issue #599 §6). */
const strictEntitySide = deepStrict(EntityMembershipListResponseSchema);
/** The channel-side list of member ids, parsed just as strictly (issue #1160). */
const strictChannelSide = deepStrict(ChannelMemberIdListResponseSchema);

/**
 * Phase 5b — Bidirectional membership HTTP contract.
 *
 * Exercises the channel-side (`/admin/sales-channels/:code/:T/...`)
 * and the entity-side aggregated read
 * (`/admin/sales-channels/by-entity/:T/:id`) against a real Postgres.
 * Product is the representative entity type; the other 8 share the
 * exact same code path through `SalesChannelMembershipService` and
 * are exercised by T043 at the service layer.
 */
describe('admin membership routes (Phase 5b)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    const em = h.em();
    for (const c of await em.find(SalesChannel, { systemDefault: false })) em.remove(c);
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
  });

  async function createChannel(code: string): Promise<SalesChannel> {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/sales-channels',
      cookies: adminCookie,
      payload: {
        code,
        name: { 'en-US': code },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
      },
    });
    expect(r.statusCode).toBe(201);
    return h.em().findOneOrFail(SalesChannel, { code });
  }

  async function createProduct(slug: string): Promise<ProductRow> {
    const em = h.em();
    const product = em.create(Product, {
      sku: `5B-${slug.toUpperCase()}-${randomUUID().slice(0, 4)}`,
      slug,
      type: 'simple',
      status: 'inactive',
      name: slug,
      description: 'fixture',
      visibility: 'public',
      attributeValues: {},
      allowedOrganizationIds: [],
    });
    await em.persistAndFlush(product);
    return product;
  }

  it('PUT adds membership and lists it from both sides', async () => {
    const channel = await createChannel('p5b-add');
    const product = await createProduct('5b-add-prod');

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/sales-channels/${channel.code}/product/${product.id}`,
      cookies: adminCookie,
      payload: {},
    });
    expect(put.statusCode).toBe(201);
    expect(put.json()).toMatchObject({ changed: true, entityType: 'product' });

    // Idempotent re-add → 200, changed=false.
    const reAdd = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/sales-channels/${channel.code}/product/${product.id}`,
      cookies: adminCookie,
      payload: {},
    });
    expect(reAdd.statusCode).toBe(200);
    expect(reAdd.json()).toMatchObject({ changed: false });

    // Channel-side list returns the entity id.
    const channelSide = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/sales-channels/${channel.code}/product`,
      cookies: adminCookie,
    });
    expect(channelSide.statusCode).toBe(200);
    expect((channelSide.json() as { entityIds: string[] }).entityIds).toContain(product.id);
    expect(disagreements(strictChannelSide, channelSide.json())).toEqual([]);
    expect(channelSide.json()).toMatchObject({
      salesChannelCode: channel.code,
      entityType: 'product',
      page: 0,
      pageSize: 100,
      total: 1,
    });

    // Entity-side list returns the channel.
    const entitySide = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/sales-channels/by-entity/product/${product.id}`,
      cookies: adminCookie,
    });
    expect(entitySide.statusCode).toBe(200);
    const codes = (entitySide.json() as { channels: Array<{ code: string }> }).channels.map(
      (c) => c.code,
    );
    expect(codes).toContain(channel.code);
    expect(disagreements(strictEntitySide, entitySide.json())).toEqual([]);
  });

  it('GET channel-side list echoes ?page=&pageSize= (issue #1160)', async () => {
    const channel = await createChannel('p5b-page');
    for (const slug of ['5b-page-a', '5b-page-b', '5b-page-c']) {
      const product = await createProduct(slug);
      const put = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/sales-channels/${channel.code}/product/${product.id}`,
        cookies: adminCookie,
        payload: {},
      });
      expect(put.statusCode).toBe(201);
    }

    const r = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/sales-channels/${channel.code}/product?page=1&pageSize=2`,
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    expect(disagreements(strictChannelSide, r.json())).toEqual([]);
    const body = ChannelMemberIdListResponseSchema.parse(r.json());
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
    expect(body.total).toBe(3);
    expect(body.entityIds).toHaveLength(1);
  });

  it('DELETE refuses last-channel removal without fallbackToDefault', async () => {
    const channel = await createChannel('p5b-fr8');
    const product = await createProduct('5b-fr8-prod');

    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/sales-channels/${channel.code}/product/${product.id}`,
      cookies: adminCookie,
      payload: {},
    });

    const refused = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sales-channels/${channel.code}/product/${product.id}`,
      cookies: adminCookie,
    });
    expect(refused.statusCode).toBe(422);
    expect((refused.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS,
    );
  });

  it('DELETE with fallbackToDefault rebinds the entity to Default', async () => {
    const channel = await createChannel('p5b-fb');
    const product = await createProduct('5b-fb-prod');

    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/sales-channels/${channel.code}/product/${product.id}`,
      cookies: adminCookie,
      payload: {},
    });

    const ok = await h.app.inject({
      method: 'DELETE',
      url:
        `/api/v1/admin/sales-channels/${channel.code}/product/${product.id}` +
        `?fallbackToDefault=true`,
      cookies: adminCookie,
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { fallbackAppliedToDefault: boolean }).fallbackAppliedToDefault).toBe(
      true,
    );

    // Now bound to Default only.
    const entitySide = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/sales-channels/by-entity/product/${product.id}`,
      cookies: adminCookie,
    });
    const codes = (entitySide.json() as { channels: Array<{ code: string }> }).channels.map(
      (c) => c.code,
    );
    expect(codes).toEqual(['default']);
  });

  it('PUT rejects unknown entity type with 404', async () => {
    const channel = await createChannel('p5b-bad');
    const r = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/sales-channels/${channel.code}/widget/${randomUUID()}`,
      cookies: adminCookie,
      payload: {},
    });
    expect(r.statusCode).toBe(404);
  });

  it('PUT rejects unknown channel code with UNKNOWN_SALES_CHANNEL', async () => {
    const r = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/sales-channels/does-not-exist/product/${randomUUID()}`,
      cookies: adminCookie,
      payload: {},
    });
    expect(r.statusCode).toBe(404);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.UNKNOWN_SALES_CHANNEL,
    );
  });

  it('GET without admin cookie → 401', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/sales-channels/default/product',
    });
    expect(r.statusCode).toBe(401);
  });
});
