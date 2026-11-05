import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SearchIndexer, type SearchIndexerOptions } from './search-indexer.js';

/**
 * Feature 174 (code review, note 5) — the option labels of the searchable select attributes are
 * read once per indexing run, not once per language per channel. A full reindex over two channels
 * that share two languages used to read the attribute set four times; it reads it once, and each
 * channel's documents still carry the labels of their own language.
 */

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const channels = [
  { id: '00000000-0000-4000-8000-000000000001', code: 'pl_retail', defaultLanguage: 'pl-PL', languages: ['pl-PL', 'en-US'] },
  { id: '00000000-0000-4000-8000-000000000002', code: 'pl_b2b_vip', defaultLanguage: 'pl-PL', languages: ['pl-PL', 'en-US'] },
];

let server: Server;
let port = 0;
let taskUid = 0;
const pushed: Array<{ url: string; body: unknown }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      const url = req.url ?? '';
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && url.startsWith('/tasks/')) {
        const uid = Number(url.split('/')[2]);
        res.writeHead(200);
        res.end(JSON.stringify({ uid, taskUid: uid, status: 'succeeded', type: 'documentAdditionOrUpdate', enqueuedAt: new Date().toISOString() }));
        return;
      }
      if (req.method === 'GET' && url.startsWith('/indexes/')) {
        res.writeHead(200);
        res.end(JSON.stringify({ uid: url.split('/')[2], primaryKey: 'id', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
        return;
      }
      if (req.method === 'POST' && url.includes('/documents')) pushed.push({ url, body: raw ? JSON.parse(raw) : null });
      taskUid += 1;
      res.writeHead(202);
      res.end(JSON.stringify({ taskUid, indexUid: url.split('/')[2], status: 'enqueued', type: 'x', enqueuedAt: new Date().toISOString() }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

beforeEach(() => {
  pushed.length = 0;
});

function indexer(loads: { listByFlag: number }): SearchIndexer {
  const colour = {
    key: 'colour',
    valueType: 'select',
    isSearchable: true,
    isFilterable: false,
    scopeLevels: [],
    options: [{ value: 'red', label: { 'pl-PL': 'czerwony', 'en-US': 'red' }, labelDefault: 'red' }],
  };
  const product = {
    id: PRODUCT_ID,
    sku: 'DRILL',
    type: 'simple',
    status: 'active',
    slug: 'drill',
    name: 'Drill',
    description: null,
    attributeValues: { colour: 'red' },
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const options = {
    meilisearchHost: `http://127.0.0.1:${port}`,
    meilisearchApiKey: '',
    attributeRead: {
      listByFlag: async () => {
        loads.listByFlag += 1;
        return [colour];
      },
      listAll: async () => [colour],
    },
    products: {
      findByIds: async () => [product],
      findById: async () => product,
      listValueOverridesByProductIds: async () => [],
    },
    categories: {
      listAssignmentsForProducts: async () => [],
      listProductIdsInSubtree: async () => [PRODUCT_ID, PRODUCT_ID, PRODUCT_ID],
    },
    channelMembership: {
      listEntityIdsForChannel: async () => ({ entityIds: [PRODUCT_ID], total: 1 }),
      listChannelsForEntity: async () => channels.map((c) => ({ id: c.id })),
    },
    availability: {
      describeChannelAvailability: async () =>
        new Map([
          [
            PRODUCT_ID,
            {
              liveLanguages: ['pl-PL', 'en-US'],
              window: { from: null, until: null },
              audience: { visibility: 'all', allowedOrganizationIds: [] },
            },
          ],
        ]),
    },
    resolveTaskTimeoutMs: async () => 2_000,
  } as unknown as SearchIndexerOptions;
  return new SearchIndexer(options);
}

const em = { find: async () => channels } as unknown as EntityManager;

describe('SearchIndexer — option labels per indexing run', () => {
  it('a full reindex of two channels with two languages reads the option labels once', async () => {
    const loads = { listByFlag: 0 };
    const results = await indexer(loads).reindexAllChannels(em);

    expect(results.map((r) => r.documentCount)).toEqual([1, 1]);
    expect(loads.listByFlag).toBe(1);
    // The cache is keyed by language: every channel's document carries each language's own label.
    expect(pushed).toHaveLength(2);
    for (const push of pushed) {
      const [doc] = push.body as Array<{ texts: Record<string, { options: string[] }> }>;
      expect(doc!.texts['pl-PL']!.options).toEqual(['czerwony']);
      expect(doc!.texts['en-US']!.options).toEqual(['red']);
    }
  });

  it('a later run reads them again, so a relabelled option reaches the next reindex', async () => {
    const loads = { listByFlag: 0 };
    const subject = indexer(loads);
    await subject.reindexAllChannels(em);
    await subject.reindexAllChannels(em);
    expect(loads.listByFlag).toBe(2);
  });

  it('an incremental upsert reads them once for every channel language', async () => {
    const loads = { listByFlag: 0 };
    await indexer(loads).upsertProduct(em, PRODUCT_ID);
    expect(loads.listByFlag).toBe(1);
  });

  it('a category-subtree reindex of three products reads them once', async () => {
    const loads = { listByFlag: 0 };
    expect(await indexer(loads).reindexCategorySubtree(em, 'category')).toBe(3);
    expect(loads.listByFlag).toBe(1);
  });
});
