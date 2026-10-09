import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Processor } from 'bullmq';
import type { Queue } from 'bullmq';
import { GOOGLE_ANALYTICS_SETTING_CODES, type GaCollectRequest } from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import type { GaDeliveryJobData } from './ss-delivery-queue.js';
import type { Ga4MpClient } from './ga4-mp-client.js';

/**
 * Server-side delivery orchestration (feature 049, US4).
 *
 * - `makeEnqueuer` returns the producer used by the `/collect` route: it assigns
 *   an `eventId` per event (idempotency key) and enqueues one delivery job each.
 *   Pure producer — no forwarding here (Principle X). It enqueues nothing, and
 *   accepts zero, for a channel whose server-side delivery is not configured —
 *   a queue exists on every instance with Redis, so its presence is not that
 *   answer.
 * - `makeProcessor` returns the BullMQ processor: it resolves the channel's
 *   Measurement ID + endpoint + decrypted API secret from Settings and forwards
 *   via the MP client, throwing on failure so BullMQ retries. Idempotent w.r.t.
 *   retry (the destination call carries the stable `eventId` in params).
 */
export function makeEnqueuer(
  queue: Queue<GaDeliveryJobData>,
  /**
   * Whether the channel delivers at all: the master switch and the server-side
   * switch are on **and** a Measurement ID is set — `GaStorefrontConfig.serverSide`,
   * the same answer the storefront is given. Required rather than defaulted,
   * because the default would be "deliver for everybody", which is the
   * behaviour this exists to stop.
   */
  isServerSideOn: (salesChannelId: string) => Promise<boolean>,
) {
  return async (salesChannelId: string, request: GaCollectRequest): Promise<number> => {
    // A storefront that honours its config never posts here for such a channel;
    // one holding a stale config, or a crafted request, does. Nothing is
    // delivered either way, so the only thing a job would add is work for this
    // instance's own Redis. The processor keeps its check: the Measurement ID
    // can still be cleared between enqueue and delivery.
    if (!(await isServerSideOn(salesChannelId))) return 0;
    const occurredAt = new Date().toISOString();
    let accepted = 0;
    for (const event of request.events) {
      const eventId = randomUUID();
      await queue.add(
        'deliver',
        {
          eventId,
          salesChannelId,
          clientId: request.clientId,
          event: { name: event.name, params: { ...event.params, ga_event_id: eventId } },
          consent: request.consent,
          occurredAt,
        },
        { jobId: eventId },
      );
      accepted += 1;
    }
    return accepted;
  };
}

export interface ProcessorDeps {
  settings: SettingsReadPort;
  client: Ga4MpClient;
}

export function makeProcessor(deps: ProcessorDeps): Processor<GaDeliveryJobData> {
  return async (job) => {
    const { salesChannelId } = job.data;
    const measurementId = await deps.settings.get(
      GOOGLE_ANALYTICS_SETTING_CODES.MEASUREMENT_ID,
      salesChannelId,
      z.string(),
    );
    if (!measurementId.trim()) {
      // Channel untracked — drop silently (do not retry a permanent no-op).
      return;
    }
    const apiSecret = await deps.settings.get(
      GOOGLE_ANALYTICS_SETTING_CODES.SERVER_SIDE_API_SECRET,
      salesChannelId,
      z.string(),
    );
    const endpoint = await deps.settings.get(
      GOOGLE_ANALYTICS_SETTING_CODES.SERVER_SIDE_ENDPOINT,
      salesChannelId,
      z.string(),
    );

    await deps.client.send(
      { endpoint, measurementId, apiSecret },
      {
        clientId: job.data.clientId,
        name: job.data.event.name,
        params: job.data.event.params,
        consent: job.data.consent,
      },
    );
  };
}
