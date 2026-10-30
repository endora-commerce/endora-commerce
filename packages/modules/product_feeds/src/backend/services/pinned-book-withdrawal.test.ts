import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PinnedPriceBookPublishability } from '@endora-commerce/contracts';
import { ModuleDisabledError, SalesChannel } from '@endora-commerce/platform/kernel';
import { FeedTemplate } from '../entities/feed-template.entity.js';
import { ProductFeed } from '../entities/product-feed.entity.js';
import { FeedGenerationService } from './feed-generation.service.js';

/**
 * Feature 160 (FR-029), owner ruling 2026-10-23 — a run that finds the feed's
 * pinned price book not publishable **withdraws** the published file instead of
 * walking the catalogue: the run ends `withdrawn` with the publishability
 * reason, produces no artefact, raises no failed-run notification, and asks
 * for the cached public answer to be dropped. It is not a failed run, so
 * FR-035/FR-038's "keep the last good file" does not apply to it — and a
 * genuine failure still does, which the second half of this file holds.
 *
 * The pointer itself is `FeedRunService.finish`'s, against a real database:
 * `backend/test/integration/product_feeds/pinned-book-withdrawal.test.ts`.
 */

interface Finished {
  status: string;
  failureCode: string | null;
  withdrawalReason: string | null;
  artefactId: string | null;
}

function generationFor(options: {
  priceListId: string | null;
  publishability: () => Promise<PinnedPriceBookPublishability>;
  /** `unreachable` (default) refuses every write; `honest` takes the bytes. */
  storage?: 'unreachable' | 'honest';
}) {
  const finished: Finished[] = [];
  const notified: unknown[] = [];
  const withdrawn: string[] = [];
  const asked: unknown[] = [];
  const puts: unknown[] = [];
  /** The catalogue walks the run asked for — none of them yields a product. */
  const walks: unknown[] = [];

  const feed = {
    id: 'feed-1',
    feedTemplateId: 'template-1',
    salesChannelId: 'channel-1',
    languageCode: 'en-US',
    currencyCode: 'PLN',
    priceListId: options.priceListId,
    pricePresentation: 'net',
    taxCountry: null,
    selectionRule: { kind: 'all' },
    name: 'Feed',
  };
  const em = {
    findOneOrFail: async (entity: unknown) => {
      if (entity === ProductFeed) return feed;
      if (entity === FeedTemplate) return { id: 'template-1', providerCode: 'custom', outputFormat: 'csv', itemGranularity: 'product' };
      throw new Error('unexpected findOneOrFail');
    },
    find: async () => [],
    findOne: async (entity: unknown) =>
      entity === SalesChannel ? { id: 'channel-1', code: 'web', active: true, defaultCurrency: 'PLN', name: {} } : null,
    getConnection: () => ({ execute: async () => undefined }),
    getTransactionContext: () => undefined,
    create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'artefact-1234', ...data }),
    persistAndFlush: async () => undefined,
  } as unknown as EntityManager;

  const service = new FeedGenerationService({
    emFactory: () => em,
    selection: {
      validateRule: async () => undefined,
      iterateProductIds: async function* (scope: unknown) {
        walks.push(scope);
      },
    } as never,
    runs: {
      claim: async () => ({ acquired: true, skipReason: null }),
      finish: async (input: {
        status: string;
        failureCode?: string | null;
        withdrawalReason?: string | null;
        artefactId?: string | null;
      }) => {
        finished.push({
          status: input.status,
          failureCode: input.failureCode ?? null,
          withdrawalReason: input.withdrawalReason ?? null,
          artefactId: input.artefactId ?? null,
        });
        return {} as never;
      },
      recordIssue: () => true,
    } as never,
    settings: {
      getNumber: async (_code: string, fallback: number) => fallback,
      getStringForChannel: async () => 'https://shop.example',
    },
    artefactStore: {
      newLocator: () => 'product-feeds/ar/te/artefact-1234.csv',
      put: async (input: { locator: string; stream: AsyncIterable<unknown> }) => {
        puts.push(input);
        if ((options.storage ?? 'unreachable') === 'unreachable') throw new Error('the bucket is unreachable');
        for await (const _chunk of input.stream) {
          // An honest store consumes the stream, which is what walks the catalogue.
        }
        return { backend: 'local', locator: input.locator };
      },
      open: async () => {
        throw new Error('unused');
      },
      delete: async () => undefined,
    },
    notifyFailedRun: async (input: unknown) => {
      notified.push(input);
    },
    onPublicationWithdrawn: async (feedId: string) => {
      withdrawn.push(feedId);
    },
    pinnedPriceBookPublishability: async (input: unknown) => {
      asked.push(input);
      return options.publishability();
    },
    listActiveLanguages: async () => [],
  } as never);

  return { service, finished, notified, withdrawn, asked, puts, walks };
}

describe('product_feeds generation — a pinned book that does not apply withdraws the file', () => {
  it('ends the run `withdrawn` with the reason, without walking the catalogue or notifying', async () => {
    const g = generationFor({
      priceListId: 'book-1',
      publishability: async () => ({ publishable: false, reason: 'outside_schedule' }),
    });

    await g.service.generateNow('feed-1', { trigger: 'scheduled', runId: 'run-1' });

    expect(g.asked).toEqual([{ priceListId: 'book-1', currencyCode: 'PLN', salesChannelId: 'channel-1' }]);
    expect(g.finished).toEqual([
      { status: 'withdrawn', failureCode: null, withdrawalReason: 'outside_schedule', artefactId: null },
    ]);
    expect(g.puts).toEqual([]);
    expect(g.notified).toEqual([]);
    expect(g.withdrawn).toEqual(['feed-1']);
  });

  it('lets a switched-off `price_lists` reach the caller rather than withdrawing (Principle XVII)', async () => {
    const g = generationFor({
      priceListId: 'book-1',
      publishability: async () => {
        throw new ModuleDisabledError('price_lists');
      },
    });

    await expect(g.service.generateNow('feed-1', { trigger: 'manual', runId: 'run-1' })).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
    expect(g.finished).toEqual([]);
    expect(g.withdrawn).toEqual([]);
  });

  it('records an ordinary error of the publishability read as a failure, which withdraws nothing', async () => {
    const g = generationFor({
      priceListId: 'book-1',
      publishability: async () => {
        throw new Error('connection reset');
      },
    });

    await g.service.generateNow('feed-1', { trigger: 'manual', runId: 'run-1' });

    expect(g.finished).toEqual([
      { status: 'failed', failureCode: 'internal_error', withdrawalReason: null, artefactId: null },
    ]);
    expect(g.withdrawn).toEqual([]);
    expect(g.notified).toHaveLength(1);
  });

  it('asks nothing of an unpinned feed, and a genuine failure stays a failure (FR-035)', async () => {
    const g = generationFor({
      priceListId: null,
      publishability: async () => ({ publishable: false, reason: 'not_found' }),
    });

    await g.service.generateNow('feed-1', { trigger: 'manual', runId: 'run-1' });

    expect(g.asked).toEqual([]);
    expect(g.finished).toEqual([
      { status: 'failed', failureCode: 'storage_unavailable', withdrawalReason: null, artefactId: null },
    ]);
    expect(g.withdrawn).toEqual([]);
    expect(g.notified).toHaveLength(1);
  });

  it('walks a pinned feed whose book publishes', async () => {
    const g = generationFor({
      priceListId: 'book-1',
      publishability: async () => ({ publishable: true }),
      storage: 'honest',
    });

    await g.service.generateNow('feed-1', { trigger: 'manual', runId: 'run-1' });

    expect(g.asked).toHaveLength(1);
    expect(g.walks).toHaveLength(1);
    expect(g.puts).toHaveLength(1);
    // The fake catalogue is empty, so the walk ends `empty` — neither withdrawn nor failed.
    expect(g.finished.map((f) => [f.status, f.withdrawalReason])).toEqual([['empty', null]]);
    expect(g.withdrawn).toEqual([]);
    expect(g.notified).toEqual([]);
  });
});
