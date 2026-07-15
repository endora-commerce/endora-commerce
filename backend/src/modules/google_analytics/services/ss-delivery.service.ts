import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { Processor } from 'bullmq';
import type { Queue } from 'bullmq';
import { GOOGLE_ANALYTICS_SETTING_CODES, type GaCollectRequest } from '@b2b/contracts';
import type { SettingsService } from '../../settings/services/settings.service.js';
import type { GaDeliveryJobData } from './ss-delivery-queue.js';
import type { Ga4MpClient } from './ga4-mp-client.js';

/**
 * Server-side delivery orchestration (feature 049, US4).
 *
 * - `makeEnqueuer` returns the producer used by the `/collect` route: it assigns
 *   an `eventId` per event (idempotency key) and enqueues one delivery job each.
 *   Pure producer — no forwarding here (Principle X).
 * - `makeProcessor` returns the BullMQ processor: it resolves the channel's
 *   Measurement ID + endpoint + decrypted API secret from Settings and forwards
 *   via the MP client, throwing on failure so BullMQ retries. Idempotent w.r.t.
 *   retry (the destination call carries the stable `eventId` in params).
 */
export function makeEnqueuer(queue: Queue<GaDeliveryJobData>) {
  return async (salesChannelId: string, request: GaCollectRequest): Promise<number> => {
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
  settings: SettingsService;
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
