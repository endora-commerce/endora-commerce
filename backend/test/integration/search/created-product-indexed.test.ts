import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Meilisearch } from 'meilisearch';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { indexUidFor } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

/**
 * Issue #240 — a created product is searchable in its channels as soon as its
 * creation has committed, without a first edit.
 *
 * `catalog`'s create Command dispatches `product.created.v1` on commit, and only
 * then binds the product to the default sales channel — outside the Command,
 * because the membership service writes on an EntityManager of its own. The
 * search subscriber indexes per channel membership, met a product with none and
 * indexed nothing; the product appeared once a later `product.updated.v1`
 * reindexed it. Reproduced against a running instance: a product created
 * through the admin API was absent from its channel index twenty seconds
 * later, and present a second after one edit.
 *
 * `search` now also reindexes a product on `sales_channels.membership_changed`,
 * which the binding emits once the membership exists — so the product reaches
 * the index from the binding, and so does any later change to its channels.
 *
 * That event is emitted outside an event scope, so nothing waits for its
 * subscriber: the index is polled, with a bound, rather than read once.
 */
describe('search — a newly created product is indexed without a first edit', () => {
  let h: BackendServerHandle;
  let client: Meilisearch;
  let indexUid: string;

  const inIndex = async (productId: string): Promise<boolean> => {
    try {
      await client.index(indexUid).getDocument(productId);
      return true;
    } catch {
      return false;
    }
  };

  /** True as soon as the document is there; false if it is not within `ms`. */
  const appearsWithin = async (productId: string, ms: number): Promise<boolean> => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await inIndex(productId)) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  beforeAll(async () => {
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;
    h = await setupBackendServer();
    client = new Meilisearch({ host: meilisearchHost, apiKey: meilisearchKey });
    indexUid = indexUidFor(await h.em().findOneOrFail(SalesChannel, { code: 'default' }));
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('an active, public product created through the admin API is in its channel index', async () => {
    const sku = `IDX-${randomUUID().slice(0, 12)}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: ADMIN,
      payload: {
        sku,
        type: 'simple',
        status: 'active',
        name: `Index probe ${sku}`,
        description: 'desc',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;

    expect(
      await appearsWithin(id, 10_000),
      'a created product reached the index only after its first edit (issue #240)',
    ).toBe(true);
  }, 60_000);
});
