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
 * A product that is archived and at once restored is in the search index at the
 * end.
 *
 * `catalog` emits `product.archived.v1` when the Archive action archives a product
 * (spec 163, FR-019 — a status write never does), and `search` removes the product
 * from every channel index on it. Restore is its reactivation.
 * Emitted outside an event scope the bus does not wait for that removal, so the
 * write returned while it was still on its way — and a reactivation that
 * followed re-indexed the product *before* the removal landed, which then took
 * an **active** product out of the index until somebody edited it again.
 *
 * The removal here is the composed subscriber's own, held back for a moment so
 * that the order is the test's rather than the machine's: what is asserted is
 * that the archiving write does not return before its removal has finished.
 */
describe('search — archiving then restoring a product leaves it indexed', () => {
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
        name: `Archive probe ${sku}`,
        description: 'desc',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    // Creation indexes the product through the default-channel binding's
    // `sales_channels.membership_changed` (issue #240), but nothing waits for
    // that subscriber. The audited update does wait for its own, so the
    // product is certainly indexed when this returns — the control for
    // everything below.
    const touched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: ADMIN,
      payload: { name: `Archive probe ${sku}, indexed` },
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

  const post = async (id: string, action: 'archive' | 'restore'): Promise<void> => {
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${id}/${action}`,
      cookies: ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
  };

  it('through the admin API: archive, restore at once — the product is indexed', async () => {
    const id = await createActiveProduct();
    removals.length = 0;

    await post(id, 'archive');
    await post(id, 'restore');
    await Promise.all(removals);

    expect(removals, 'the Archive action announced product.archived.v1 to search').toHaveLength(1);
    expect(await inIndex(id)).toBe(true);
  }, 60_000);

  it('through the service, outside a request: archive, restore at once — the product is indexed', async () => {
    const id = await createActiveProduct();
    removals.length = 0;
    const service = h.container.resolve<CatalogAdminService>('catalogAdminService');
    const run = (action: 'archive' | 'restore') =>
      withSystemScope('search archive test — worker-style archive', () =>
        action === 'archive' ? service.archiveProduct(id) : service.restoreProduct(id),
      );

    await run('archive');
    await run('restore');
    await Promise.all(removals);

    expect(removals).toHaveLength(1);
    expect(await inIndex(id)).toBe(true);
    // And it stays: nothing that was still in flight removes it afterwards.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await inIndex(id)).toBe(true);
  }, 60_000);

  it('an archived product that stays archived is not indexed', async () => {
    const id = await createActiveProduct();
    await post(id, 'archive');
    expect(await inIndex(id)).toBe(false);
  }, 60_000);

  it('a global inactive leaves the index through product.updated.v1 alone (spec 163, FR-010)', async () => {
    const id = await createActiveProduct();
    removals.length = 0;
    const response = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      cookies: ADMIN,
      payload: { status: 'inactive' },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(removals, 'switching off is not archiving').toHaveLength(0);
    expect(await inIndex(id)).toBe(false);
  }, 60_000);
});
