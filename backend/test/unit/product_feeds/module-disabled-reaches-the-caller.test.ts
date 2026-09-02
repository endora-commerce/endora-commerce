import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { productFeedsSettingsAccess } from '../../../../packages/modules/product_feeds/src/backend/plugin.js';
import { DeliveryService } from '../../../../packages/modules/product_feeds/src/backend/services/delivery/delivery.service.js';
import type { DeliveryConfigService } from '../../../../packages/modules/product_feeds/src/backend/services/delivery/delivery-config.service.js';
import { FeedGenerationService } from '../../../../packages/modules/product_feeds/src/backend/services/feed-generation.service.js';
import { TaxonomyRefreshService } from '../../../../packages/modules/product_feeds/src/backend/services/taxonomy-refresh.service.js';

/**
 * Composition checklist item 7 — a `catch` around a gated port must not absorb
 * the presence answer.
 *
 * Every case below raises `ModuleDisabledError` from where the port really is,
 * and asserts twice: that the presence answer reaches the caller, and — the
 * control that keeps the first assertion meaningful — that an ordinary failure
 * is still absorbed exactly as it was. A repair that deleted the tolerance
 * outright would pass the first assertion and fail the second, and it would be
 * the wrong repair: each of these `catch` blocks exists for a stated reason
 * (FR-103, FR-036, FR-093, a setting the reconciler has not written yet).
 */

const ORDINARY = new Error('the transport is having a bad day');

// ---------------------------------------------------------------------------
// plugin.ts — the module's four settings readers, over `settingsReadPort`
// ---------------------------------------------------------------------------

describe('product_feeds settings access — a switched-off `settings` reaches the caller', () => {
  const readerThatThrows = (error: unknown) =>
    productFeedsSettingsAccess({
      get: async () => {
        throw error;
      },
    });

  it('re-throws `ModuleDisabledError` from all four readers', async () => {
    const settings = readerThatThrows(new ModuleDisabledError('settings'));

    await expect(settings.getNumber('a', 7)).rejects.toBeInstanceOf(ModuleDisabledError);
    await expect(settings.getString('b', 'fallback')).rejects.toBeInstanceOf(ModuleDisabledError);
    await expect(settings.getBoolean('c', true)).rejects.toBeInstanceOf(ModuleDisabledError);
    await expect(settings.getStringForChannel('d', 'channel', 'fallback')).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
  });

  it('still answers the manifest default for an unwritten or unreadable setting', async () => {
    const settings = readerThatThrows(ORDINARY);

    await expect(settings.getNumber('a', 7)).resolves.toBe(7);
    await expect(settings.getString('b', 'fallback')).resolves.toBe('fallback');
    await expect(settings.getBoolean('c', true)).resolves.toBe(true);
    await expect(settings.getStringForChannel('d', 'channel', 'fallback')).resolves.toBe(
      'fallback',
    );
  });
});

// ---------------------------------------------------------------------------
// delivery.service.ts — `credentialsService`, through the delivery config
// ---------------------------------------------------------------------------

function deliveryOver(config: Partial<DeliveryConfigService>): DeliveryService {
  return new DeliveryService({
    emFactory: () => ({}) as EntityManager,
    config: config as DeliveryConfigService,
    artefactStore: {
      newLocator: () => 'unused',
      put: async () => ({ backend: 'local', locator: 'unused' }),
      open: async () => {
        throw new Error('unreachable in this test');
      },
      delete: async () => undefined,
    },
    adapters: new Map(),
  });
}

const REQUEST = { feedId: 'feed-1', runId: null, artefactId: 'artefact-1', attempt: 1, maxAttempts: 3 };

describe('product_feeds delivery — a switched-off `credentials` reaches the caller', () => {
  it('re-throws the presence answer raised while the target is resolved', async () => {
    const service = deliveryOver({
      find: async () => {
        throw new ModuleDisabledError('credentials');
      },
    });

    await expect(service.deliver(REQUEST)).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('still reports an ordinary failure as an outcome rather than throwing (FR-103)', async () => {
    const service = deliveryOver({
      find: async () => {
        throw ORDINARY;
      },
    });

    await expect(service.deliver(REQUEST)).resolves.toMatchObject({
      status: 'failed',
      failureReason: 'internal_error',
    });
  });
});

// ---------------------------------------------------------------------------
// taxonomy-refresh.service.ts — `adminNotificationRecordPort`, two catches deep
// ---------------------------------------------------------------------------

/**
 * `raiseNotFound`'s own `catch` and `runCheck`'s belt-to-the-braces `catch` are
 * on one path, so a presence answer has to survive both to reach the caller.
 */
function taxonomyOver(notifyNotFound: () => Promise<unknown>): TaxonomyRefreshService {
  const em = {
    findOne: async () => ({ id: 'check-1', providerCode: 'google_merchant' }),
    persistAndFlush: async () => undefined,
    getTransactionContext: () => undefined,
    getConnection: () => ({ execute: async () => undefined }),
  } as unknown as EntityManager;

  return new TaxonomyRefreshService({
    emFactory: () => em,
    fetcher: {
      fetchFile: async () => ({
        ok: false as const,
        outcome: 'failed' as const,
        reason: 'not_found' as const,
        detail: 'The provider answered 404.',
        httpStatus: 404,
        bytesRead: 0,
      }),
    },
    reconciler: {
      installRevision: async () => {
        throw new Error('unreachable in this test');
      },
    },
    retention: { enforce: async () => 0 },
    settings: {
      enabled: async () => true,
      sourceUrl: async () => 'https://taxonomy.example/file.txt',
    },
    notifyNotFound,
  });
}

describe('product_feeds taxonomy check — a switched-off `admin_notifications` reaches the caller', () => {
  it('re-throws the presence answer through both catches', async () => {
    const service = taxonomyOver(async () => {
      throw new ModuleDisabledError('admin_notifications');
    });

    await expect(
      service.runCheck({ providerCode: 'google_merchant', trigger: 'manual', checkId: 'check-1' }),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('still records the not-found check when the notification itself fails (FR-093)', async () => {
    const service = taxonomyOver(async () => {
      throw ORDINARY;
    });

    await expect(
      service.runCheck({ providerCode: 'google_merchant', trigger: 'manual', checkId: 'check-1' }),
    ).resolves.toMatchObject({ outcome: 'failed', reason: 'not_found' });
  });
});

// ---------------------------------------------------------------------------
// feed-generation.service.ts — the run body's catch-all
// ---------------------------------------------------------------------------

/**
 * The run body absorbs everything and records it as a `FeedRunFailureCode`, so
 * that a run always ends in a row an operator can read (FR-036). The presence
 * answer has no honest code among them: the run did not fail, the platform
 * declined to assemble it — and `internal_error`, which is what it used to get,
 * reports a defect in this module for a capability the operator withdrew.
 *
 * The error is raised from `prepare`'s first read, which is the earliest point
 * inside the `try` a stub can reach. See the report accompanying this change for
 * the path this does **not** cover: `resolveAvailability` runs inside the
 * artefact stream, where `LocalFsStorageAdapter.put` wraps whatever the source
 * threw in a `BackendUnavailableError` before this `catch` ever sees it.
 */
function generationOver(error: unknown): {
  service: FeedGenerationService;
  finished: Array<{ status: string; failureCode?: string | null }>;
} {
  const finished: Array<{ status: string; failureCode?: string | null }> = [];
  const em = {
    findOneOrFail: async () => {
      throw error;
    },
  } as unknown as EntityManager;

  const service = new FeedGenerationService({
    emFactory: () => em,
    runs: {
      claim: async () => ({ acquired: true }),
      finish: async (input: { status: string; failureCode?: string | null }) => {
        finished.push({ status: input.status, failureCode: input.failureCode ?? null });
        return {} as never;
      },
      recordIssue: () => true,
    } as never,
    settings: { getNumber: async (_code: string, fallback: number) => fallback } as never,
  } as never);

  return { service, finished };
}

describe('product_feeds generation — a presence answer is not a run failure code', () => {
  it('re-throws `ModuleDisabledError` instead of finishing the run', async () => {
    const { service, finished } = generationOver(new ModuleDisabledError('inventory'));

    await expect(
      service.generateNow('feed-1', { trigger: 'manual', runId: 'run-1' }),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(finished).toEqual([]);
  });

  it('still records an ordinary failure as `internal_error` (FR-036)', async () => {
    const { service, finished } = generationOver(ORDINARY);

    await service.generateNow('feed-1', { trigger: 'manual', runId: 'run-1' });

    expect(finished).toEqual([{ status: 'failed', failureCode: 'internal_error' }]);
  });
});
