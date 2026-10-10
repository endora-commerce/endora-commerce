import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Meilisearch } from 'meilisearch';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { indexUidFor } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';
import type { CatalogAdminService } from '../../../../packages/modules/catalog/src/backend/services/catalog-admin.service.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

/**
 * A product that is archived and at once reactivated is in the search index at
 * the end.
 *
 * `catalog` emits `product.archived.v1` when a product's status moves to
 * `inactive`, and `search` removes the product from every channel index on it.
 * Emitted outside an event scope the bus does not wait for that removal, so the
 * write returned while it was still on its way — and a reactivation that
 * followed re-indexed the product *before* the removal landed, which then took
 * an **active** product out of the index until somebody edited it again.
 *
 * The removal here is the composed subscriber's own, held back for a moment so
 * that the order is the test's rather than the machine's: what is asserted is
 * that the archiving write does not return before its removal has finished.
 */
describe('search — archiving then reactivating a product leaves it indexed', () => {
  let h: BackendServerHandle;
  let client: Meilisearch;
  let indexUid: string;
  let removals: Array<Promise<void>>;
  let restore: () => void;

  const inIndex = async (productId: string): Promise<boolean> => {
    try {
      await client.index(indexUid).getDocument(productId);
      return true;
    } catch {
      return false;
    }
  };

  const createActiveProduct = async (): Promise<string> => {
    const sku = `ARCH-${randomUUID().slice(0, 12)}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: ADMIN,
      payload: {
        sku,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Archive probe ${sku}` },
        description: { 'en-US': 'desc' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    // A product is bound to the default channel *after* its create Command has
    // dispatched `product.created.v1`, so the indexer meets it unlinked and
    // leaves it out; the first update is what indexes it. The audited update
    // waits for its subscribers, so the product is indexed when this returns —
    // the control for everything below.
    const touched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: ADMIN,
      payload: { name: { 'en-US': `Archive probe ${sku}, indexed` } },
    });
    expect(touched.statusCode, touched.body).toBe(200);
    expect(await inIndex(id), 'an active product on the default channel is indexed').toBe(true);
    return id;
  };

  beforeAll(async () => {
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;
    h = await setupBackendServer();
    client = new Meilisearch({ host: meilisearchHost, apiKey: meilisearchKey });
    indexUid = indexUidFor(await h.em().findOneOrFail(SalesChannel, { code: 'default' }));

    // Hold the composed subscriber's removal back, and keep hold of each one.
    const subscriber = (
      h.container.cradle as unknown as {
        search: { handle: { subscriber: { onProductRemoved(productId: string, eventName: string): Promise<void> } } };
      }
    ).search.handle.subscriber;
    const original = subscriber.onProductRemoved.bind(subscriber);
    removals = [];
    subscriber.onProductRemoved = (productId, eventName) => {
      const removal = new Promise<void>((resolve) => setTimeout(resolve, 1_500)).then(() =>
        original(productId, eventName),
      );
      removals.push(removal);
      return removal;
    };
    restore = () => {
      subscriber.onProductRemoved = original;
    };
  }, 120_000);

  afterAll(async () => {
    restore?.();
    await teardownBackendServer(h);
  });

  const patch = async (id: string, status: 'active' | 'inactive'): Promise<void> => {
    const response = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: ADMIN,
      payload: { status },
    });
    expect(response.statusCode, response.body).toBe(200);
  };

  it('through the admin API: archive, reactivate at once — the product is indexed', async () => {
    const id = await createActiveProduct();
    removals.length = 0;

    await patch(id, 'inactive');
    await patch(id, 'active');
    await Promise.all(removals);

    expect(removals, 'the archiving write announced product.archived.v1 to search').toHaveLength(1);
    expect(await inIndex(id)).toBe(true);
  }, 60_000);

  it('through the unaudited update path: archive, reactivate at once — the product is indexed', async () => {
    const id = await createActiveProduct();
    removals.length = 0;
    const service = h.container.resolve<CatalogAdminService>('catalogAdminService');
    const update = (status: 'active' | 'inactive') =>
      withSystemScope('search archive test — worker-style update', () => service.updateProduct(id, { status }));

    await update('inactive');
    await update('active');
    await Promise.all(removals);
    // The reactivation's own re-index is not awaited by this path; give it time.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !(await inIndex(id))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(removals).toHaveLength(1);
    expect(await inIndex(id)).toBe(true);
    // And it stays: nothing that was still in flight removes it afterwards.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await inIndex(id)).toBe(true);
  }, 60_000);

  it('an archived product that stays archived is not indexed', async () => {
    const id = await createActiveProduct();
    await patch(id, 'inactive');
    expect(await inIndex(id)).toBe(false);
  }, 60_000);
});
