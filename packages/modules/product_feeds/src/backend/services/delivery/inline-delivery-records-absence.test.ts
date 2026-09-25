import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import type { FeedDelivery } from '../../entities/feed-delivery.entity.js';
import type { FeedDeliveryAdapter } from './delivery-adapter.interface.js';
import type { DeliveryConfigService } from './delivery-config.service.js';
import { DeliveryService } from './delivery.service.js';

/**
 * The inline delivery path — a deployment with no Redis delivers right after
 * the run publishes — records a switched-off dependency as an attempt instead
 * of dropping it (feature 134 D18, the `deliverArtefact` ledger entry's drain).
 *
 * The run is finished and its artefact published before delivery starts, so
 * the presence answer must not fail the run; but discarding it left the
 * operator a published feed, no attempt row and no reason. The queued path is
 * untouched: `deliver` still throws there, and the job fails where an operator
 * can see it.
 */

interface Written {
  readonly entity: unknown;
  readonly data: Record<string, unknown>;
}

function harness(config: Partial<DeliveryConfigService>): {
  service: DeliveryService;
  written: Written[];
} {
  const written: Written[] = [];
  const em = {
    create: (entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `attempt-${written.length + 1}`, ...data };
      written.push({ entity, data: row });
      return row;
    },
    persistAndFlush: async () => undefined,
    getConnection: () => ({ execute: async () => undefined }),
    getTransactionContext: () => undefined,
  } as unknown as EntityManager;
  const service = new DeliveryService({
    emFactory: () => em,
    config: config as DeliveryConfigService,
    artefactStore: {
      newLocator: () => 'unused',
      put: async () => ({ backend: 'local', locator: 'unused' }),
      open: async () => {
        throw new Error('unreachable in this test');
      },
      delete: async () => undefined,
    },
    // An adapter for the protocol, so the attempt reaches the target
    // resolution — where the credential is read — rather than stopping at "no
    // transport".
    adapters: new Map([['sftp', { protocol: 'sftp' } as unknown as FeedDeliveryAdapter]]),
  });
  return { service, written };
}

const DELIVERY = { productFeedId: 'feed-1', enabled: true, protocol: 'sftp' } as FeedDelivery;
const REQUEST = { feedId: 'feed-1', runId: 'run-1', artefactId: 'artefact-1', attempt: 1, maxAttempts: 1 };

describe('DeliveryService.deliverInline', () => {
  it('records a switched-off `credentials` as a failed attempt naming the module', async () => {
    const { service, written } = harness({
      find: async () => DELIVERY,
      resolveTarget: async () => {
        throw new ModuleDisabledError('credentials');
      },
    });

    const outcome = await service.deliverInline(REQUEST);

    expect(outcome).toMatchObject({
      status: 'failed',
      failureReason: 'not_configured',
      retryable: false,
      attemptId: 'attempt-1',
    });
    expect(outcome.failureDetail).toContain('"credentials"');
    expect(written).toHaveLength(1);
    expect(written[0]?.data).toMatchObject({
      productFeedId: 'feed-1',
      feedRunId: 'run-1',
      feedArtefactId: 'artefact-1',
      protocol: 'sftp',
      status: 'failed',
      failureReason: 'not_configured',
      isTest: false,
    });
    expect(String(written[0]?.data['failureDetail'])).toContain('"credentials"');
  });

  it('records nothing when the feed has no enabled delivery to refuse', async () => {
    const { service, written } = harness({
      find: async () => ({ ...DELIVERY, enabled: false }) as FeedDelivery,
      resolveTarget: async () => {
        throw new ModuleDisabledError('credentials');
      },
    });

    await expect(service.deliverInline(REQUEST)).resolves.toMatchObject({ status: 'skipped' });
    expect(written).toHaveLength(0);
  });

  it('answers exactly what `deliver` answers when nothing is switched off', async () => {
    const { service } = harness({ find: async () => null });

    await expect(service.deliverInline(REQUEST)).resolves.toMatchObject({
      status: 'skipped',
      attemptId: null,
    });
  });

  it('leaves `deliver` itself throwing, so the queued path still fails its job', async () => {
    const { service } = harness({
      find: async () => DELIVERY,
      resolveTarget: async () => {
        throw new ModuleDisabledError('credentials');
      },
    });

    await expect(service.deliver(REQUEST)).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});
