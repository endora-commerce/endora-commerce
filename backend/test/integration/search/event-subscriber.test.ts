import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { EventBus } from '../../../src/events/bus.js';
import { SearchIndexer, indexUidFor } from '../../../src/modules/search/services/search-indexer.js';
import { SearchEventSubscriber } from '../../../src/modules/search/services/search-event-subscriber.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { findAttributeExtensionByKey } from '../../helpers/seed-catalog.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Meilisearch } from 'meilisearch';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';

/**
 * T067 — incremental subscriber.
 *
 * Wires a fresh EventBus + SearchEventSubscriber against the test-server's
 * Postgres state and live Meilisearch. Emits product / attribute events
 * via `eventBus.run(...)` so dispatch awaits handler completion before the
 * test continues, then asserts the Meilisearch index reflects the change.
 */

const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

describe('SearchEventSubscriber — incremental index updates', () => {
  let h: BackendServerHandle;
  let eventBus: EventBus<never>;
  let indexer: SearchIndexer;
  let subscriber: SearchEventSubscriber;
  let teardown: () => void;
  let client: Meilisearch;
  let publicChannel: SalesChannel;

  beforeAll(async () => {
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;

    h = await setupBackendServer();

    indexer = new SearchIndexer({
      meilisearchHost,
      meilisearchApiKey: meilisearchKey,
      attributeRead: h.catalogAttributeRead,
      ...searchIndexerNeighbourPorts(h),
    });
    eventBus = new EventBus();
    subscriber = new SearchEventSubscriber({
      emFactory: h.em,
      indexer,
    });
    // The module's own registrations live in `search/backend.ts` and go through
    // `ctx.subscribe`, so they are gated and attached to the composed bus. This
    // test drives a bus of its own, so it wires the three handlers it exercises
    // itself — the mapping under test here is handler → Meilisearch.
    const offs = [
      eventBus.on('product.created.v1' as never, ((p: { productId: string }) =>
        subscriber.onProductUpserted(p.productId, 'product.created.v1')) as never),
      eventBus.on('product.archived.v1' as never, ((p: { productId: string }) =>
        subscriber.onProductRemoved(p.productId, 'product.archived.v1')) as never),
      eventBus.on('attribute.updated.v1' as never, (() =>
        subscriber.onAttributeUpdated()) as never),
    ];
    teardown = () => offs.forEach((off) => off());

    client = new Meilisearch({ host: meilisearchHost, apiKey: meilisearchKey });
    const channel = await h.em().findOneOrFail(SalesChannel, { isPublic: true });
    publicChannel = channel;
    // Reindex once so the wipe + add settle the index for this test run.
    await indexer.reindexChannel(h.em(), channel);
  }, 60_000);

  afterAll(async () => {
    teardown();
    await teardownBackendServer(h);
  });

  it('product.created.v1 upserts the document into the public channel index', async () => {
    const em = h.em();
    const newProduct = em.create(Product, {
      sku: 'EVT-CREATED-001',
      slug: 'evt-created-001',
      type: 'simple',
      status: 'active',
      visibility: 'public',
      name: { 'en-US': 'Event-created widget' },
      description: { 'en-US': 'Widget produced by the integration test.' },
      attributeValues: { defaultPrice: 42.5 },
    });
    await em.persistAndFlush(newProduct);
    await em.getConnection().execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`,
      [publicChannel.id, newProduct.id],
    );

    await (eventBus as EventBus<never>).run(async () => {
      // The bus is generic; cast through to bypass the per-test typed schema.
      (eventBus as unknown as {
        emit: (n: string, p: { eventId: string; occurredAt: string; productId: string; sku: string }) => void;
      }).emit('product.created.v1', {
        eventId: 'evt-test-created',
        occurredAt: new Date().toISOString(),
        productId: newProduct.id,
        sku: newProduct.sku,
      });
    });

    const index = client.index<{ id: string; sku: string }>(indexUidFor(publicChannel));
    const result = await index.search('Event-created', { limit: 5 });
    const skus = result.hits.map((h) => h.sku);
    expect(skus).toContain('EVT-CREATED-001');
  }, 30_000);

  it('product.archived.v1 removes the document from every channel index', async () => {
    const em = h.em();
    const product = await em.findOneOrFail(Product, { sku: 'EVT-CREATED-001' });
    product.status = 'inactive';
    product.archivedAt = new Date();
    await em.flush();

    await (eventBus as EventBus<never>).run(async () => {
      (eventBus as unknown as {
        emit: (n: string, p: { eventId: string; occurredAt: string; productId: string }) => void;
      }).emit('product.archived.v1', {
        eventId: 'evt-test-archived',
        occurredAt: new Date().toISOString(),
        productId: product.id,
      });
    });

    const index = client.index<{ id: string; sku: string }>(indexUidFor(publicChannel));
    const result = await index.search('Event-created', { limit: 5 });
    const skus = result.hits.map((h) => h.sku);
    expect(skus).not.toContain('EVT-CREATED-001');
  }, 30_000);

  it('attribute.updated.v1 re-applies filterable + searchable settings', async () => {
    const em = h.em();
    // Toggle `internal_sku_notes` from "searchable but not filterable" to filterable.
    const attr = (await findAttributeExtensionByKey(em, 'internal_sku_notes'))!;
    attr.isFilterable = true;
    await em.flush();

    await (eventBus as EventBus<never>).run(async () => {
      (eventBus as unknown as {
        emit: (
          n: string,
          p: {
            eventId: string;
            occurredAt: string;
            key: string;
            isSearchable: boolean;
            isFilterable: boolean;
          },
        ) => void;
      }).emit('attribute.updated.v1', {
        eventId: 'evt-test-attr',
        occurredAt: new Date().toISOString(),
        key: 'internal_sku_notes',
        isSearchable: attr.isSearchable,
        isFilterable: attr.isFilterable,
      });
    });

    const index = client.index(indexUidFor(publicChannel));
    const filterable = await index.getFilterableAttributes();
    expect(filterable).toContain('attributes.internal_sku_notes');

    // Restore so subsequent runs don't drift the seed expectation.
    attr.isFilterable = false;
    await em.flush();
  }, 30_000);
});
