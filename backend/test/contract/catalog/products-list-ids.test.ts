import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, PRODUCT_LIST_MAX_IDS } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Product } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  CHANNEL_AMOUNT,
  ORG_A_AMOUNT,
  ORG_A_BUYER,
  ORG_B_AMOUNT,
  ORG_B_BUYER,
  RETAIL_CHANNEL,
  seedViewerPricedFixture,
  VIEWER_PRICED_PRODUCT_ID,
  VIEWER_PRICED_SKU,
  VIEWER_PRICED_SOURCE_ID,
} from '../../helpers/viewer-priced-fixture.js';

/**
 * Issue #590 — `GET /api/v1/catalog/products?ids=` reads a hand-picked set of
 * products (a blog post's related products) as **a listing**: the same
 * availability condition, the same projection and the same batched price
 * resolution for the viewer as every other listing page. Nothing about it is a
 * second path, and these tests hold that:
 *
 *  - **identity** — an entry read by id is the entry the text listing answers
 *    for the same product and the same viewer, field for field;
 *  - **the viewer's price** — three viewers, three prices (the reason for three
 *    is in `viewer-priced-listing.test.ts`), and a signed-in answer is private;
 *  - **availability** — an id the viewer may not see, out of the channel,
 *    deleted or unknown is simply absent, and an allow-listed product appears
 *    for its organisation only;
 *  - **validation** — not a uuid, or more than `PRODUCT_LIST_MAX_IDS`, is a 400.
 */

interface Entry {
  id: string;
  sku: string;
  price: { amount: number; currency: string } | null;
}

const RUN = `ids590_${randomUUID().slice(0, 8)}`;
const SKU = (key: string): string => `IDS590-${RUN}-${key}`.toUpperCase();

describe('GET /api/v1/catalog/products?ids= (issue #590)', () => {
  let h: BackendServerHandle;
  const ids = { offChannel: '', deleted: '', restricted: '' };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await seedViewerPricedFixture(em);
    const retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });

    const fixtures: Array<{
      key: keyof typeof ids;
      inChannel: boolean;
      visibility: 'public' | 'organization_restricted';
      allowedOrganizationIds: string[];
    }> = [
      { key: 'offChannel', inChannel: false, visibility: 'public', allowedOrganizationIds: [] },
      { key: 'deleted', inChannel: true, visibility: 'public', allowedOrganizationIds: [] },
      {
        key: 'restricted',
        inChannel: true,
        visibility: 'organization_restricted',
        allowedOrganizationIds: [TEST_ORGANIZATION_ID],
      },
    ];
    for (const fixture of fixtures) {
      const sku = SKU(fixture.key);
      const product = em.create(Product, {
        sku,
        slug: sku.toLowerCase().replace(/_/g, '-'),
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Ids probe ${fixture.key}` },
        description: { 'en-US': '' },
        visibility: fixture.visibility,
        allowedOrganizationIds: fixture.allowedOrganizationIds,
        attributeValues: {},
      });
      await em.persistAndFlush(product);
      ids[fixture.key] = product.id;
      if (fixture.inChannel) {
        await em
          .getConnection()
          .execute('insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)', [
            retail.id,
            product.id,
          ]);
      }
    }
    await em.getConnection().execute('update products set deleted_at = now() where id = ?', [ids.deleted]);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function byIds(
    list: readonly string[],
    cookies?: Record<string, string>,
    extra = '',
  ): Promise<{ status: number; entries: Entry[]; cacheControl: string | undefined; backend: string | undefined }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?ids=${list.join(',')}${extra}`,
      headers: RETAIL_CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    const body = res.json() as { data?: Entry[] };
    return {
      status: res.statusCode,
      entries: body.data ?? [],
      cacheControl: res.headers['cache-control'] as string | undefined,
      backend: res.headers['x-search-backend'] as string | undefined,
    };
  }

  it('answers an entry identical to the text listing’s, for every viewer', async () => {
    for (const cookies of [undefined, ORG_A_BUYER, ORG_B_BUYER]) {
      const listing = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=${VIEWER_PRICED_SKU}`,
        headers: RETAIL_CHANNEL,
        ...(cookies ? { cookies } : {}),
      });
      expect(listing.statusCode, listing.body).toBe(200);
      const fromListing = (listing.json() as { data: Entry[] }).data.find((e) => e.id === VIEWER_PRICED_PRODUCT_ID);
      const { status, entries } = await byIds([VIEWER_PRICED_PRODUCT_ID], cookies);
      expect(status).toBe(200);
      expect(fromListing).toBeDefined();
      expect(entries).toEqual([fromListing]);
    }
  });

  it('prices each product for the viewer, and keeps a buyer’s answer private', async () => {
    const anonymous = await byIds([VIEWER_PRICED_PRODUCT_ID]);
    const orgA = await byIds([VIEWER_PRICED_PRODUCT_ID], ORG_A_BUYER);
    const orgB = await byIds([VIEWER_PRICED_PRODUCT_ID], ORG_B_BUYER);
    expect(anonymous.entries[0]?.price).toEqual({ amount: CHANNEL_AMOUNT, currency: 'PLN' });
    expect(orgA.entries[0]?.price).toEqual({ amount: ORG_A_AMOUNT, currency: 'PLN' });
    expect(orgB.entries[0]?.price).toEqual({ amount: ORG_B_AMOUNT, currency: 'PLN' });
    expect(orgA.cacheControl).toContain('no-store');
    expect(orgB.cacheControl).toContain('no-store');
  });

  it('answers only the named products, and leaves out every one the viewer may not see', async () => {
    const unknown = randomUUID();
    const named = [unknown, ids.deleted, VIEWER_PRICED_SOURCE_ID, ids.offChannel, ids.restricted, VIEWER_PRICED_PRODUCT_ID];
    const anonymous = await byIds(named);
    expect(anonymous.status).toBe(200);
    expect(anonymous.entries.map((e) => e.id).sort()).toEqual([VIEWER_PRICED_PRODUCT_ID, VIEWER_PRICED_SOURCE_ID].sort());
    const allowed = await byIds(named, ORG_A_BUYER);
    expect(allowed.entries.map((e) => e.id).sort()).toEqual(
      [VIEWER_PRICED_PRODUCT_ID, VIEWER_PRICED_SOURCE_ID, ids.restricted].sort(),
    );
    const other = await byIds(named, ORG_B_BUYER);
    expect(other.entries.map((e) => e.id)).not.toContain(ids.restricted);
  });

  it('narrows the other filters rather than replacing them, and stays on Postgres', async () => {
    // `q=VIEWER-PRICED` matches both fixture SKUs; `ids` keeps both, and the
    // search index — which cannot express an id filter — is not asked.
    const both = await byIds([VIEWER_PRICED_PRODUCT_ID, VIEWER_PRICED_SOURCE_ID], undefined, '&q=VIEWER-PRICED');
    expect(both.status).toBe(200);
    expect(both.entries.map((e) => e.id).sort()).toEqual([VIEWER_PRICED_PRODUCT_ID, VIEWER_PRICED_SOURCE_ID].sort());
    expect(both.backend).toBe('postgres');
    // `q` naming only the priced SKU narrows the two ids to one.
    const narrowed = await byIds([VIEWER_PRICED_PRODUCT_ID, VIEWER_PRICED_SOURCE_ID], undefined, `&q=${VIEWER_PRICED_SKU}`);
    expect(narrowed.entries.map((e) => e.id)).toEqual([VIEWER_PRICED_PRODUCT_ID]);
  });

  it('refuses an id that is not a uuid, and more than the cap', async () => {
    const malformed = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?ids=${VIEWER_PRICED_PRODUCT_ID},nope`,
      headers: RETAIL_CHANNEL,
    });
    expect(malformed.statusCode).toBe(400);
    expect((malformed.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);

    const tooMany = Array.from({ length: PRODUCT_LIST_MAX_IDS + 1 }, () => randomUUID());
    const refused = await byIds(tooMany);
    expect(refused.status).toBe(400);

    const atCap = await byIds([...tooMany.slice(0, PRODUCT_LIST_MAX_IDS - 1), VIEWER_PRICED_PRODUCT_ID]);
    expect(atCap.status).toBe(200);
    expect(atCap.entries.map((e) => e.id)).toEqual([VIEWER_PRICED_PRODUCT_ID]);
  });
});
