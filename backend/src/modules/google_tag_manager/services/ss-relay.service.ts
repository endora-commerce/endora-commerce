import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Processor, Queue } from 'bullmq';
import { GOOGLE_TAG_MANAGER_SETTING_CODES, type GtmCollectRequest } from '@endora-commerce/contracts';
import type { SettingsReadPort } from '../../../kernel/ports/settings.js';
import type { GtmIngestContext, GtmRelayJobData } from './ss-relay-queue.js';
import type { SgtmClient, SgtmEvent } from './sgtm-client.js';

/**
 * Server-side relay orchestration (feature 066, US3).
 *
 * - `makeEnqueuer` returns the producer used by the `/collect` route: it
 *   assigns one uuid `eventId` per event (the idempotency key and the BullMQ
 *   `jobId`) and enqueues one relay job each. Pure producer — no outbound call
 *   happens in the shopper's request (Principle X / FR-029).
 * - `makeProcessor` returns the BullMQ processor: it resolves the channel's
 *   server container address from Settings, drops the visitor's IP and user
 *   agent unless consent was granted (FR-030), and forwards through the sGTM
 *   client, letting a failure throw so BullMQ retries.
 */
export function makeEnqueuer(queue: Queue<GtmRelayJobData>) {
  return async (
    salesChannelId: string,
    request: GtmCollectRequest,
    context: GtmIngestContext,
  ): Promise<number> => {
    // One timestamp for the whole batch: it is when the visitor acted, not when
    // a retry happened to reach the destination.
    const occurredAt = new Date().toISOString();
    let accepted = 0;
    for (const event of request.events) {
      const eventId = randomUUID();
      await queue.add(
        'relay',
        {
          eventId,
          salesChannelId,
          clientId: request.clientId,
          // `gtm_event_id` travels in the params so the operator's container
          // can deduplicate a retried delivery.
          event: { name: event.name, params: { ...event.params, gtm_event_id: eventId } },
          consent: request.consent,
          page: request.page,
          ...(context.ip ? { ip: context.ip } : {}),
          ...(context.userAgent ? { userAgent: context.userAgent } : {}),
          occurredAt,
        },
        { jobId: eventId },
      );
      accepted += 1;
    }
    return accepted;
  };
}

export interface GtmRelayProcessorDeps {
  settings: SettingsReadPort;
  client: SgtmClient;
}

export function makeProcessor(deps: GtmRelayProcessorDeps): Processor<GtmRelayJobData> {
  return async (job) => {
    const { salesChannelId } = job.data;
    const baseUrl = await read(
      deps.settings,
      GOOGLE_TAG_MANAGER_SETTING_CODES.SERVER_CONTAINER_URL,
      salesChannelId,
    );
    if (!baseUrl.trim()) {
      // The operator cleared the address between enqueue and delivery. That is
      // a permanent no-op, not a transient failure — returning rather than
      // throwing keeps it from burning eight retries.
      return;
    }
    const ingestPath = await read(
      deps.settings,
      GOOGLE_TAG_MANAGER_SETTING_CODES.SERVER_INGEST_PATH,
      salesChannelId,
    );

    const granted = job.data.consent.analyticsStorage === 'granted';
    const event: SgtmEvent = {
      eventId: job.data.eventId,
      clientId: job.data.clientId,
      name: job.data.event.name,
      params: job.data.event.params,
      consent: job.data.consent,
      page: job.data.page,
      // FR-030 — the visitor's IP and user agent travel only with consent.
      ...(granted && job.data.ip ? { ip: job.data.ip } : {}),
      ...(granted && job.data.userAgent ? { userAgent: job.data.userAgent } : {}),
    };

    await deps.client.send({ baseUrl, ingestPath }, event);
  };
}

/** A destination read must never fail the job on an unregistered setting. */
async function read(
  settings: SettingsReadPort,
  code: string,
  salesChannelId: string,
): Promise<string> {
  try {
    return await settings.get(code, salesChannelId, z.string());
  } catch {
    return '';
  }
}
