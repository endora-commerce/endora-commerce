import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Webhook } from '../../../src/modules/webhooks/entities/webhook.entity.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';
import type { WebhookService } from '../../../src/modules/webhooks/services/webhook-service.js';

/**
 * Feature 072 wave 1 (T098) — gate the bridge, not the subscriptions.
 *
 * A webhook subscription is a database row an operator creates at runtime, so
 * there is no per-subscription registration seam to wrap and the literal
 * reading of Constitution XVII has nothing to attach to. What the module does
 * own is **two** EventBus subscriptions, one per bridged event type, and every
 * delivery on the platform passes through them. Gating those stops all of it at
 * one seam.
 *
 * The assertion is deliberately about the *lookup*, not about the queue. A test
 * that only checked "no job was enqueued" would pass just as well if the module
 * had read every subscription row, resolved every URL and then dropped the
 * result — which is not absence, it is wasted work with the same observable
 * output. Counting lookups proves the handler never ran at all.
 *
 * Off is not uninstall: the row survives, and bridging resumes on re-enable.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);

describe('webhooks — the bridge is the gate [integration]', () => {
  let h: BackendServerHandle;
  let lookups: number;
  let restore: () => void;

  beforeAll(async () => {
    h = await setupBackendServer();

    const em = h.em();
    em.create(Webhook, {
      name: 'Off-state bridge probe',
      url: 'https://example.invalid/hook',
      secret: 'shhh',
      eventTypes: ['order.created.v1'],
      status: 'active',
    } as Parameters<typeof em.create<Webhook>>[1]);
    await em.flush();

    // Count lookups through the live service the bridge actually resolves.
    const service = (h.container.cradle as unknown as { webhookService: WebhookService })
      .webhookService;
    const original = service.findActiveByEventType.bind(service);
    lookups = 0;
    (service as unknown as Record<string, unknown>)['findActiveByEventType'] = async (
      ...args: Parameters<WebhookService['findActiveByEventType']>
    ) => {
      lookups += 1;
      return original(...args);
    };
    restore = () => {
      (service as unknown as Record<string, unknown>)['findActiveByEventType'] = original;
    };
  }, 60_000);

  afterAll(async () => {
    restore?.();
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  async function emitOrderCreated(): Promise<void> {
    h.eventBus.emit('order.created.v1', {
      eventId: randomUUID(),
      organizationId: null,
      orderId: randomUUID(),
    });
    // The bus dispatches asynchronously; give the handler a turn to run.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('consults subscriptions while the module is on', async () => {
    const before = lookups;
    await emitOrderCreated();
    expect(lookups).toBeGreaterThan(before);
  });

  it('does not reach the subscription lookup at all while deactivated', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['webhooks'] });
    const before = lookups;
    await emitOrderCreated();
    expect(lookups).toBe(before);
  });

  it('does not reach it while the platform axis has it removed either', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'webhooks'));
    const before = lookups;
    await emitOrderCreated();
    expect(lookups).toBe(before);
  });

  it('resumes bridging when switched back on, with the subscription intact', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    const before = lookups;
    await emitOrderCreated();
    expect(lookups).toBeGreaterThan(before);

    const rows = await h.em().find(Webhook, { url: 'https://example.invalid/hook' });
    expect(rows).toHaveLength(1);
  });
});
